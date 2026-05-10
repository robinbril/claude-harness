import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'fs'
import { readdir, stat as asyncStat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

const MODEL_PRICING = {
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-opus-4-7': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-haiku-4-5': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
}

const DEFAULT_PRICING = { input: 3 / 1_000_000, output: 15 / 1_000_000 }
const ACTIVE_THRESHOLD_MS = 90 * 60 * 1000
const FUTURE_TOLERANCE_MS = 60 * 1000

const _fileCache = new Map()
let _scanCache = null
let _scanCacheTime = 0
const SCAN_CACHE_TTL = 60000
let _scanRunning = false

const ANSI_RE = /\x1b\[[0-9;]*m/g
const XML_TAG_RE = /<[^>]+>/g
const IMAGE_TAG_RE = /\[Image\s*#?\d*\]/gi
const PASTED_TAG_RE = /\[Pasted text[^\]]*\]/gi
const ARROW_PREFIX_RE = /^[❯>\s]+/

function clampTimestamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const now = Date.now()
  if (ms > now + FUTURE_TOLERANCE_MS) return now
  return ms
}

function cleanTitleText(raw) {
  return raw
    .replace(XML_TAG_RE, '')
    .replace(ANSI_RE, '')
    .replace(IMAGE_TAG_RE, '')
    .replace(PASTED_TAG_RE, '')
    .replace(ARROW_PREFIX_RE, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function looksLikeTitle(text) {
  if (!text || text.length < 5) return false
  const cleaned = text.replace(XML_TAG_RE, '').replace(ARROW_PREFIX_RE, '').trim()
  if (cleaned.length < 5) return false
  if (cleaned.includes('@') && cleaned.includes('.')) return false
  if (/^[A-Z]:\\/.test(cleaned)) return false
  if (/^\/[a-z]\//.test(cleaned)) return false
  if (/^Caveat:/i.test(cleaned)) return false
  if (/^The messages below were/i.test(cleaned)) return false
  if (/^\[Image/i.test(cleaned)) return false
  if (/^\[Pasted text/i.test(cleaned)) return false
  if (/^\[Request interrupted/i.test(cleaned)) return false
  if (/^resume(--[a-f0-9-]+)?$/i.test(cleaned)) return false
  const lineCount = cleaned.split(/[\r\n]/).filter(l => l.trim()).length
  if (lineCount > 3) return false
  return true
}

function deriveProjectName(projectPath, projectSlug) {
  const raw = projectPath
    ? projectPath.replace(/\//g, '\\').replace(/\\$/, '')
    : decodeSlugToPath(projectSlug)

  const homeMatch = raw.match(/^C:\\Users\\[^\\]+/i)
  if (!homeMatch) return raw.split('\\').pop() || 'Global'

  const homeDir = homeMatch[0]
  if (raw.toLowerCase() === homeDir.toLowerCase()) return 'Global'

  let rest = raw.slice(homeDir.length + 1)

  const hivePfx = rest.match(/^OneDrive[^\\]*\\Projects\\Hive\\?/i)
  if (hivePfx) {
    rest = rest.slice(hivePfx[0].length).replace(/^\\/, '')
    if (!rest) return 'Hive'
    const parts = rest.split('\\').filter(Boolean)
    const key = parts.find(p => !['workspace', 'src', 'lib', 'app'].includes(p.toLowerCase()))
    return key || parts[0] || 'Hive'
  }

  const projPfx = rest.match(/^OneDrive[^\\]*\\Projects\\?/i)
  if (projPfx) {
    rest = rest.slice(projPfx[0].length).replace(/^\\/, '')
    if (!rest) return 'Projects'
  }

  const dlPfx = rest.match(/^Downloads\\?/i)
  if (dlPfx) {
    rest = rest.slice(dlPfx[0].length).replace(/^\\/, '')
    if (!rest) return 'Downloads'
  }

  const claudePfx = rest.match(/^\.claude\\?/i)
  if (claudePfx) {
    rest = rest.slice(claudePfx[0].length).replace(/^\\/, '')
    if (!rest) return 'Claude Config'
  }

  const parts = rest.split('\\').filter(Boolean)
  const skip = new Set(['src', 'lib', 'app', 'packages', 'workspace', 'projects'])
  const meaningful = parts.filter(p => !skip.has(p.toLowerCase()))
  if (meaningful.length === 0) return parts[0] || 'Global'
  return meaningful.length <= 2 ? meaningful.join(' / ') : meaningful.slice(-2).join(' / ')
}

function decodeSlugToPath(slug) {
  return slug.replace(/--/g, ':\\').replace(/-/g, '\\')
}

function deriveTitle(aiTitle, firstUserPrompt, sessionId, qmdDir) {
  if (aiTitle) return cleanTitleText(aiTitle)

  const qmdPath = join(qmdDir, `${sessionId}.md`)
  if (existsSync(qmdPath)) {
    try {
      const raw = readFileSync(qmdPath, 'utf-8')
      const lines = raw.split('\n')
      const userLine = lines.findIndex(l => l.trim() === '## User')
      if (userLine >= 0) {
        const content = lines.slice(userLine + 1).find(l => l.trim().length > 10 && !l.startsWith('#'))
        if (content && looksLikeTitle(content)) return cleanTitleText(content)
      }
    } catch { /* ignore */ }
  }

  if (firstUserPrompt && looksLikeTitle(firstUserPrompt)) {
    const cleaned = cleanTitleText(firstUserPrompt)
    if (cleaned.length >= 5) return cleaned
  }

  return `Session ${sessionId.slice(0, 8)}`
}

function readChunk(filePath, offset, length) {
  const buf = Buffer.alloc(length)
  const fd = openSync(filePath, 'r')
  try { readSync(fd, buf, 0, length, offset) }
  finally { closeSync(fd) }
  return buf.toString('utf-8')
}

/**
 * Stream through a large file in chunks, extracting only token usage data.
 * Uses regex pre-filter so we only JSON.parse lines containing "usage".
 */
function scanFullUsage(filePath, size) {
  const CHUNK = 524288
  const fd = openSync(filePath, 'r')
  let input = 0, output = 0, cacheRead = 0, cacheCreate = 0
  let userMsgs = 0, assistantMsgs = 0, tools = 0
  let partial = ''
  let firstTs = null, lastTs = null

  try {
    for (let off = 0; off < size; off += CHUNK) {
      const len = Math.min(CHUNK, size - off)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, off)
      const text = partial + buf.toString('utf-8')
      const lines = text.split('\n')
      partial = lines.pop() || ''

      for (const line of lines) {
        if (!line || line.length < 10) continue
        if (line.includes('"isSidechain":true') || line.includes('"isSidechain": true')) continue

        if (line.includes('"timestamp"')) {
          const m = line.match(/"timestamp"\s*:\s*"([^"]+)"/)
          if (m) {
            if (!firstTs) firstTs = m[1]
            lastTs = m[1]
          }
        }

        if (line.includes('"type":"user"') || line.includes('"type": "user"')) {
          userMsgs++
          continue
        }

        if (!line.includes('"usage"')) continue
        try {
          const entry = JSON.parse(line)
          if (entry.isSidechain) continue
          if (entry.type === 'assistant' && entry.message?.usage) {
            const u = entry.message.usage
            input += (u.input_tokens || 0)
            output += (u.output_tokens || 0)
            cacheRead += (u.cache_read_input_tokens || 0)
            cacheCreate += (u.cache_creation_input_tokens || 0)
            assistantMsgs++
            if (Array.isArray(entry.message.content)) {
              for (const block of entry.message.content) {
                if (block.type === 'tool_use') tools++
              }
            }
          }
        } catch {}
      }
    }
  } finally {
    closeSync(fd)
  }

  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreate, userMessages: userMsgs, assistantMessages: assistantMsgs, toolUses: tools, firstTs, lastTs }
}

function parseSessionFile(filePath, projectSlug, fileMtimeMs) {
  const cached = _fileCache.get(filePath)
  if (cached && cached.mtimeMs === fileMtimeMs) return cached.result

  try {
    const stat = statSync(filePath)
    const size = stat.size
    if (size === 0) return null

    const HEAD_SIZE = 32768
    const TAIL_SIZE = 65536
    const isLargeFile = size > HEAD_SIZE + TAIL_SIZE

    let lines
    if (!isLargeFile) {
      const content = readFileSync(filePath, 'utf-8')
      lines = content.split('\n').filter(Boolean)
    } else {
      const headText = readChunk(filePath, 0, HEAD_SIZE)
      const tailText = readChunk(filePath, size - TAIL_SIZE, TAIL_SIZE)
      const headLines = headText.split('\n').filter(Boolean)
      if (headLines.length > 0) headLines.pop()
      const tailLines = tailText.split('\n').filter(Boolean)
      if (tailLines.length > 0) tailLines.shift()
      lines = [...headLines, ...tailLines]
    }

    if (lines.length === 0) return null

    let sessionId = null
    let model = null
    let gitBranch = null
    let projectPath = null
    let aiTitle = null
    let firstUserPrompt = null
    let userMessages = 0
    let assistantMessages = 0
    let toolUses = 0
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0
    let firstMessageAt = null
    let lastMessageAt = null
    const agentsUsed = new Set()
    const skillsUsed = new Set()
    const toolNames = new Set()

    for (const line of lines) {
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }

      if (!sessionId && entry.sessionId) sessionId = entry.sessionId
      if (!gitBranch && entry.gitBranch && entry.gitBranch !== 'HEAD') gitBranch = entry.gitBranch
      if (!projectPath && entry.cwd) projectPath = entry.cwd

      if (entry.type === 'ai-title' && entry.aiTitle) {
        aiTitle = entry.aiTitle
      }

      if (entry.timestamp) {
        if (!firstMessageAt) firstMessageAt = entry.timestamp
        lastMessageAt = entry.timestamp
      }

      if (entry.isSidechain) continue

      if (entry.type === 'user' && entry.message) {
        userMessages++
        if (!firstUserPrompt) {
          const msg = entry.message
          let raw = ''
          if (typeof msg.content === 'string') raw = msg.content
          else if (Array.isArray(msg.content)) {
            const tb = msg.content.find(b => b && b.type === 'text' && b.text)
            if (tb) raw = tb.text
          }
          if (raw.length > 0 && looksLikeTitle(raw.slice(0, 200))) {
            firstUserPrompt = raw.slice(0, 500)
          }
        }
      }

      if (entry.type === 'assistant' && entry.message) {
        assistantMessages++
        if (entry.message.model) model = entry.message.model

        const usage = entry.message.usage
        if (usage) {
          inputTokens += (usage.input_tokens || 0)
          cacheReadTokens += (usage.cache_read_input_tokens || 0)
          cacheCreationTokens += (usage.cache_creation_input_tokens || 0)
          outputTokens += (usage.output_tokens || 0)
        }

        if (Array.isArray(entry.message.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'tool_use') {
              toolUses++
              if (block.name) toolNames.add(block.name)
              if (block.name === 'Agent' && block.input?.subagent_type) {
                agentsUsed.add(block.input.subagent_type)
              } else if (block.name === 'Skill' && block.input?.skill) {
                skillsUsed.add(block.input.skill)
              }
            }
          }
        }
      }
    }

    if (isLargeFile && sessionId) {
      const fullUsage = scanFullUsage(filePath, size)
      inputTokens = fullUsage.inputTokens
      outputTokens = fullUsage.outputTokens
      cacheReadTokens = fullUsage.cacheReadTokens
      cacheCreationTokens = fullUsage.cacheCreationTokens
      userMessages = Math.max(userMessages, fullUsage.userMessages)
      assistantMessages = Math.max(assistantMessages, fullUsage.assistantMessages)
      toolUses = Math.max(toolUses, fullUsage.toolUses)
      if (fullUsage.firstTs && !firstMessageAt) firstMessageAt = fullUsage.firstTs
      if (fullUsage.lastTs) lastMessageAt = fullUsage.lastTs
    }

    if (!sessionId) return null

    const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING
    const estimatedCost =
      inputTokens * pricing.input +
      cacheReadTokens * pricing.input * 0.1 +
      cacheCreationTokens * pricing.input * 1.25 +
      outputTokens * pricing.output

    const totalInputTokens = inputTokens + cacheReadTokens + cacheCreationTokens

    const parsedFirstMs = firstMessageAt ? clampTimestamp(new Date(firstMessageAt).getTime()) : 0
    const parsedLastMs = lastMessageAt ? clampTimestamp(new Date(lastMessageAt).getTime()) : 0
    const mtimeMs = clampTimestamp(fileMtimeMs)
    const effectiveLastMs = Math.max(parsedLastMs, mtimeMs)
    const effectiveFirstMs = parsedFirstMs || mtimeMs
    const isActive = effectiveLastMs > 0 && (Date.now() - effectiveLastMs) < ACTIVE_THRESHOLD_MS

    const projectName = deriveProjectName(projectPath, projectSlug)

    const result = {
      sessionId,
      projectSlug,
      projectPath,
      projectName,
      aiTitle,
      firstUserPrompt,
      model,
      gitBranch,
      userMessages,
      assistantMessages,
      toolUses,
      inputTokens: totalInputTokens,
      outputTokens,
      estimatedCost: Math.round(estimatedCost * 10000) / 10000,
      firstMessageAt: effectiveFirstMs ? new Date(effectiveFirstMs).toISOString() : null,
      lastMessageAt: effectiveLastMs ? new Date(effectiveLastMs).toISOString() : null,
      isActive,
      agentsUsed: [...agentsUsed],
      skillsUsed: [...skillsUsed],
      toolNames: [...toolNames],
    }
    _fileCache.set(filePath, { mtimeMs: fileMtimeMs, result })
    return result
  } catch {
    return null
  }
}

async function _collectFilesAsync() {
  const claudeHome = join(homedir(), '.claude')
  const projectsDir = join(claudeHome, 'projects')
  const entries = []
  let projectDirs
  try { projectDirs = await readdir(projectsDir) } catch { return entries }
  for (const projectSlug of projectDirs) {
    const projectDir = join(projectsDir, projectSlug)
    try { if (!(await asyncStat(projectDir)).isDirectory()) continue } catch { continue }
    let files
    try { files = (await readdir(projectDir)).filter(f => f.endsWith('.jsonl')) } catch { continue }
    for (const file of files) {
      const filePath = join(projectDir, file)
      try { entries.push({ filePath, projectSlug, mtimeMs: (await asyncStat(filePath)).mtimeMs }) } catch {}
    }
  }
  return entries
}

function _processFile(entry) {
  const qmdDir = join(homedir(), '.claude', 'qmd-sessions')
  const parsed = parseSessionFile(entry.filePath, entry.projectSlug, entry.mtimeMs)
  if (!parsed) return null
  return {
    ...parsed,
    derivedTitle: deriveTitle(parsed.aiTitle, parsed.firstUserPrompt, parsed.sessionId, qmdDir),
    resumeCommand: `claude --resume ${parsed.sessionId}`,
  }
}

const _sortSessions = (arr) => arr.sort((a, b) => {
  const aT = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
  const bT = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
  return bT - aT
})

export function clearCache() {
  _scanCache = null
  _scanCacheTime = 0
  _fileCache.clear()
}

export function scanSessions() {
  const now = Date.now()
  if (_scanCache && (now - _scanCacheTime) < SCAN_CACHE_TTL) return _scanCache
  triggerBackgroundScan()
  return _scanCache || []
}

export function triggerBackgroundScan() {
  if (_scanRunning) return
  _scanRunning = true
  _collectFilesAsync().then(files => {
    const sessions = []
    let idx = 0
    function tick() {
      const start = Date.now()
      while (idx < files.length && (Date.now() - start) < 8) {
        const result = _processFile(files[idx++])
        if (result) sessions.push(result)
      }
      if (idx < files.length) {
        setImmediate(tick)
      } else {
        _scanCache = _sortSessions(sessions)
        _scanCacheTime = Date.now()
        _scanRunning = false
      }
    }
    setImmediate(tick)
  }).catch(() => { _scanRunning = false })
}

function parseTranscriptLine(line) {
  let entry
  try { entry = JSON.parse(line) } catch { return null }
  if (entry.isSidechain) return null
  if (entry.type !== 'user' && entry.type !== 'assistant') return null
  if (!entry.message) return null

  const parts = []
  const msg = entry.message
  const role = msg.role || entry.type

  if (typeof msg.content === 'string' && msg.content.trim()) {
    parts.push({ type: 'text', text: msg.content.trim().slice(0, 4000) })
  } else if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text' && block.text?.trim()) {
        parts.push({ type: 'text', text: block.text.trim().slice(0, 4000) })
      } else if (block.type === 'thinking' && block.thinking) {
        parts.push({ type: 'thinking', thinking: block.thinking.slice(0, 2000) })
      } else if (block.type === 'tool_use') {
        parts.push({ type: 'tool_use', name: block.name || 'unknown', input: JSON.stringify(block.input || {}).slice(0, 300) })
      }
    }
  }

  if (parts.length === 0) return null
  return { role, parts, timestamp: entry.timestamp }
}

function readTailLines(filePath, maxBytes = 512 * 1024) {
  const stat = statSync(filePath)
  const size = stat.size
  if (size === 0) return []
  const readSize = Math.min(size, maxBytes)
  const buf = Buffer.alloc(readSize)
  const fd = openSync(filePath, 'r')
  try {
    readSync(fd, buf, 0, readSize, size - readSize)
  } finally {
    closeSync(fd)
  }
  const text = buf.toString('utf-8')
  const lines = text.split('\n').filter(Boolean)
  if (readSize < size && lines.length > 0) lines.shift()
  return lines
}

export function getTranscript(sessionId, limit = 50, tail = false) {
  const claudeHome = join(homedir(), '.claude')
  const projectsDir = join(claudeHome, 'projects')

  let projectDirs
  try { projectDirs = readdirSync(projectsDir) } catch { return [] }

  for (const projectSlug of projectDirs) {
    const filePath = join(projectsDir, projectSlug, `${sessionId}.jsonl`)
    if (!existsSync(filePath)) continue

    if (tail) {
      const lines = readTailLines(filePath)
      const messages = []
      for (const line of lines) {
        const msg = parseTranscriptLine(line)
        if (msg) messages.push(msg)
      }
      return messages.slice(-limit)
    }

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    const messages = []
    for (const line of lines) {
      const msg = parseTranscriptLine(line)
      if (msg) messages.push(msg)
      if (messages.length >= limit) break
    }
    return messages
  }

  return []
}
