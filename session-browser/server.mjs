import { createServer } from 'http'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname, basename, extname, delimiter as PATH_SEP } from 'path'
import { fileURLToPath } from 'url'
import { homedir, tmpdir } from 'os'
import { exec, execSync } from 'child_process'
import https from 'https'
import { scanSessions, getTranscript, triggerBackgroundScan, clearCache } from './scanner.mjs'
import { getLogFiles, tailLog, searchLog } from './modules/log-viewer-api.mjs'
import { getDocTree, readDoc, writeDoc, searchDocs } from './modules/docs-browser-api.mjs'
import { getAgents, getSkills, getAgentContent, saveAgent, getSkillContent, saveSkill } from './modules/skills-agents-api.mjs'
import { getSystemHealth, getClaudeConfig, getProjectStats } from './modules/system-api.mjs'
import { getProjects, getProjectDoc, saveProjectDoc, deleteProjectDoc } from './modules/projects-api.mjs'
import { getLabels, setLabel, bulkSetLabels, getSuggestionsForSessions, getKnownLabels } from './modules/labels-api.mjs'
import { getConfig, saveConfig, listConfigs } from './modules/launch-configs-api.mjs'
import { getCompanion, processCompanionEvent, getCompanionVisuals } from './modules/companion-api.mjs'
import { getTeamSyncStatus, listSharedMemory, listSharedSkills, readSharedFile, writeSharedFile, pullFromRemote, pushToRemote, syncFile, createProject } from './modules/team-sync-api.mjs'
import { getModules, getModuleSource } from './modules/openclaw-modules-api.mjs'
import { snapshotIfNeeded, DB_AVAILABLE, initDb, upsertAgents, upsertSkills } from './modules/db.mjs'
import { getRelationshipIndex, getSessionGraph, getAgentGraph, getSkillGraph, getProjectGraph, searchAll } from './modules/relationship-index-api.mjs'
import { getMsSkills, getMsSkillCategories, getMsSkillLangs } from './modules/ms-skills.mjs'
import { postEvent, getEvents, sendDirectedMessage, getMessagesForAgent, markMessageDelivered, getMessageHistory, sendHandoff, getHandoffsForAgent, completeHandoff, getSharedTasks, createSharedTask, updateSharedTask, getProjectContext, addListener } from './modules/agent-bus.mjs'
import { getWorkersActivity } from './modules/worker-activity-api.mjs'
import { getWorkerLatestOutput } from './modules/routing-api.mjs'
import { getSuggestions } from './modules/smart-suggestions-api.mjs'
import { createTerminal, sendMessage, getOutput, addOutputListener, removeOutputListener, listTerminals, killTerminal } from './modules/terminal-manager.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.SB_PORT || '7337', 10)
const HOST = '127.0.0.1'
const HOME = homedir()
const CLAUDE_HOME = join(HOME, '.claude')

let _authCache = null

function findMemoryDir() {
  const projectsDir = join(CLAUDE_HOME, 'projects')
  if (!existsSync(projectsDir)) return join(projectsDir, 'default', 'memory')
  const slug = HOME.replace(/[:\\/]/g, '-')
  const exact = join(projectsDir, slug, 'memory')
  if (existsSync(exact)) return exact
  try {
    for (const d of readdirSync(projectsDir).sort()) {
      const memDir = join(projectsDir, d, 'memory')
      if (existsSync(memDir) && statSync(memDir).isDirectory()) return memDir
    }
  } catch {}
  return join(projectsDir, slug, 'memory')
}

const SAFE_DIRS = {
  rules: join(CLAUDE_HOME, 'rules', 'common'),
  commands: join(CLAUDE_HOME, 'commands'),
  agents: join(CLAUDE_HOME, 'agents'),
  memory: findMemoryDir(),
  scripts: join(CLAUDE_HOME, 'scripts'),
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

function htmlResponse(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
  })
}

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

function escForOsa(s) {
  // Escape for AppleScript double-quoted string
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function escForSingleQuoted(s) {
  // Escape for use inside single-quoted shell argument
  return String(s).replace(/'/g, "'\\''")
}

function openTerminalAt(dir) {
  if (IS_WIN) {
    exec(`start wt -d "${dir}"`, (err) => { if (err) exec(`start cmd /K "cd /d ${dir}"`) })
    return
  }
  if (IS_MAC) {
    exec(`open -a Terminal "${dir}"`)
    return
  }
  exec(`x-terminal-emulator --working-directory="${dir}"`, (err) => {
    if (err) exec(`gnome-terminal --working-directory="${dir}"`)
  })
}

function launchInTerminal(dir, scriptPath) {
  if (IS_WIN) {
    const wt = `start wt -d "${dir}" -- powershell -NoExit -ExecutionPolicy Bypass -File "${scriptPath}"`
    exec(wt, (err) => {
      if (err) exec(`start powershell -NoExit -ExecutionPolicy Bypass -File "${scriptPath}"`)
    })
    return
  }
  if (IS_MAC) {
    try { execSync(`chmod +x "${scriptPath}"`) } catch {}
    const osaBody = `tell application "Terminal" to do script "cd \\"${escForOsa(dir)}\\" && bash \\"${escForOsa(scriptPath)}\\""\ntell application "Terminal" to activate`
    exec(`osascript -e '${escForSingleQuoted(osaBody)}'`)
    return
  }
  try { execSync(`chmod +x "${scriptPath}"`) } catch {}
  exec(`x-terminal-emulator -e bash -c 'cd "${dir}" && bash "${scriptPath}"; exec bash'`, (err) => {
    if (err) exec(`gnome-terminal -- bash -c 'cd "${dir}" && bash "${scriptPath}"; exec bash'`)
  })
}

function buildLauncherScript({ promptFile, launcherFile, sessionId, model, sessionName }) {
  const modelFlag = model ? ` --model ${model}` : ''
  const nameFlag = sessionName ? ` --name "${sessionName.replace(/"/g, '\\"')}"` : ''
  const resumeFlag = sessionId ? ` --resume ${sessionId}` : ''
  if (IS_WIN) {
    return [
      `$promptFile = "${promptFile.replace(/\\/g, '\\\\')}"`,
      `$prompt = Get-Content -Raw $promptFile`,
      `& claude${resumeFlag}${modelFlag}${nameFlag} --dangerously-skip-permissions "$prompt"`,
      `Remove-Item $promptFile -ErrorAction SilentlyContinue`,
      `Remove-Item "${launcherFile.replace(/\\/g, '\\\\')}" -ErrorAction SilentlyContinue`,
    ].join('\r\n')
  }
  return [
    `#!/usr/bin/env bash`,
    `set +e`,
    `PROMPT="$(cat "${promptFile}")"`,
    `claude${resumeFlag}${modelFlag}${nameFlag} --dangerously-skip-permissions "$PROMPT"`,
    `STATUS=$?`,
    `rm -f "${promptFile}" "${launcherFile}"`,
    `exit $STATUS`,
  ].join('\n')
}

function launcherFileExt() { return IS_WIN ? '.ps1' : '.sh' }

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  const meta = {}
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0) {
      const key = line.slice(0, sep).trim()
      const val = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '')
      meta[key] = val
    }
  }
  return { meta, body: match[2] }
}

function readMdFiles(dir, bodyLimit = 2000) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = readFileSync(join(dir, f), 'utf-8')
      const { meta, body } = parseFrontmatter(content)
      const stat = statSync(join(dir, f))
      return { filename: f, ...meta, body: body.slice(0, bodyLimit), modifiedAt: stat.mtime.toISOString(), sizeBytes: stat.size }
    })
}

function readFullFile(dir, filename) {
  if (!filename.endsWith('.md') && !filename.endsWith('.js') && !filename.endsWith('.ps1') && !filename.endsWith('.mjs')) return null
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return null
  const fp = join(dir, filename)
  if (!existsSync(fp)) return null
  return readFileSync(fp, 'utf-8')
}

function getHarnessRules() { return readMdFiles(SAFE_DIRS.rules) }

function getHarnessCommands() {
  const dir = SAFE_DIRS.commands
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const content = readFileSync(join(dir, f), 'utf-8')
    const { meta, body } = parseFrontmatter(content)
    const stat = statSync(join(dir, f))
    return { filename: f, name: f.replace('.md', ''), description: meta.description || '', allowedTools: meta['allowed-tools'] || '', body: body.slice(0, 1000), modifiedAt: stat.mtime.toISOString(), sizeBytes: stat.size }
  })
}

function getHarnessAgents() {
  const dir = SAFE_DIRS.agents
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const content = readFileSync(join(dir, f), 'utf-8')
    const { meta, body } = parseFrontmatter(content)
    const stat = statSync(join(dir, f))
    return { filename: f, name: f.replace('.md', ''), ...meta, body: body.slice(0, 1500), modifiedAt: stat.mtime.toISOString() }
  })
}

function getHarnessHooks() {
  const settingsPath = join(CLAUDE_HOME, 'settings.json')
  if (!existsSync(settingsPath)) return { hooks: [], permissions: {}, model: null, plugins: {} }
  const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  const flatHooks = []
  if (settings.hooks) {
    for (const [event, entries] of Object.entries(settings.hooks)) {
      for (const entry of entries) {
        const matcher = entry.matcher || '*'
        for (const h of (entry.hooks || [])) {
          const cmdStr = h.command || ''
          const scriptName = cmdStr.split('/').pop().split('"')[0].split(' ')[0] || cmdStr.slice(0, 60)
          flatHooks.push({ event, matcher, type: h.type || 'command', command: cmdStr, scriptName, timeout: h.timeout, async: h.async || false })
        }
      }
    }
  }
  return { hooks: flatHooks, permissions: settings.permissions || {}, model: settings.model, plugins: settings.enabledPlugins || {}, sandbox: settings.sandbox, effortLevel: settings.effortLevel }
}

function getHarnessScripts() {
  const dir = SAFE_DIRS.scripts
  if (!existsSync(dir)) return []
  return readdirSync(dir).map(f => {
    const fp = join(dir, f)
    const stat = statSync(fp)
    return { name: f, isDirectory: stat.isDirectory(), ext: extname(f), sizeBytes: stat.isDirectory() ? null : stat.size, modifiedAt: stat.mtime.toISOString() }
  })
}

function getMemoryFiles() {
  const dir = SAFE_DIRS.memory
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const content = readFileSync(join(dir, f), 'utf-8')
    const { meta, body } = parseFrontmatter(content)
    const stat = statSync(join(dir, f))
    return { filename: f, name: meta.name || f.replace('.md', ''), description: meta.description || '', type: meta.type || 'unknown', body: body.trim().slice(0, 2000), modifiedAt: stat.mtime.toISOString(), sizeBytes: stat.size }
  })
}

function getMemoryIndex() {
  const indexPath = join(SAFE_DIRS.memory, 'MEMORY.md')
  if (!existsSync(indexPath)) return ''
  return readFileSync(indexPath, 'utf-8')
}

function getLessonsLearned() {
  const fp = join(CLAUDE_HOME, 'rules', 'common', 'lessons-learned.md')
  if (!existsSync(fp)) return { sections: [], raw: '' }
  const raw = readFileSync(fp, 'utf-8')
  const sections = []
  let current = null
  for (const line of raw.split('\n')) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current)
      current = { title: line.slice(3).trim(), items: [] }
    } else if (current && line.startsWith('- **')) {
      const match = line.match(/^- \*\*(.+?)\*\*:?\s*(.*)/)
      if (match) current.items.push({ rule: match[1], detail: match[2] })
    }
  }
  if (current) sections.push(current)
  const count = sections.reduce((n, s) => n + s.items.length, 0)
  return { sections, count, raw }
}

function getLogs() {
  const dir = join(SAFE_DIRS.memory, 'logs')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.log') || f.endsWith('.jsonl') || f.endsWith('.md'))
    .map(f => { const stat = statSync(join(dir, f)); return { name: f, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() } })
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
}

function getHarnessSummary() {
  const rules = getHarnessRules(), commands = getHarnessCommands(), agents = getHarnessAgents()
  const config = getHarnessHooks(), scripts = getHarnessScripts(), memory = getMemoryFiles(), lessons = getLessonsLearned()
  return {
    layers: {
      rules: { count: rules.length, items: rules.map(r => r.filename) },
      commands: { count: commands.length, items: commands.map(c => c.name) },
      agents: { count: agents.length, items: agents.map(a => a.name) },
      hooks: { count: config.hooks.length, events: [...new Set(config.hooks.map(h => h.event))] },
      scripts: { count: scripts.length, items: scripts.map(s => s.name) },
      memory: { count: memory.length, types: [...new Set(memory.map(m => m.type))] },
      lessons: { count: lessons.sections.reduce((n, s) => n + s.items.length, 0), categories: lessons.sections.length },
    },
    model: config.model, plugins: config.plugins,
  }
}

function resolveOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const envPaths = [
    join(HOME, 'OneDrive - Fellowmind Netherlands B.V', 'Projects', 'Hive', 'fellowmind.hiveai.demo.ville', '.env'),
    join(HOME, 'OneDrive - Fellowmind Netherlands B.V', 'Projects', 'Hive', 'fellowmind.hiveai.core', '.env'),
  ]
  for (const p of envPaths) {
    try {
      const vars = Object.fromEntries(
        readFileSync(p, 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
      )
      if (vars.OPENAI_API_KEY) return vars.OPENAI_API_KEY
    } catch { /* next */ }
  }
  return null
}

function openaiChat(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'gpt-4o', messages, temperature: 0.3, max_tokens: 2000 })
    const req = https.request({
      hostname: 'api.openai.com', port: 443, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') { jsonResponse(res, {}); return }

  // === Cache management ===
  if (url.pathname === '/api/sessions/refresh' && req.method === 'POST') {
    clearCache()
    triggerBackgroundScan()
    jsonResponse(res, { ok: true, message: 'Cache cleared, rescan triggered' })
    return
  }

  // === READ endpoints ===
  if (url.pathname === '/api/sessions') {
    const sessions = scanSessions()
    const labels = getLabels()
    for (const s of sessions) {
      const lbl = labels[s.sessionId]
      if (lbl) s.label = lbl.label
    }
    jsonResponse(res, { sessions, scannedAt: new Date().toISOString(), dbAvailable: DB_AVAILABLE })
    if (sessions.length > 0) setImmediate(() => { try { snapshotIfNeeded(sessions) } catch {} })
    return
  }

  const transcriptMatch = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)\/transcript$/)
  if (transcriptMatch) {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
    const tail = url.searchParams.get('tail') === '1'
    jsonResponse(res, { messages: getTranscript(transcriptMatch[1], limit, tail) })
    return
  }

  // === Worker activity, routing, suggestions ===
  if (url.pathname === '/api/workers/activity' && req.method === 'GET') {
    const sessions = scanSessions()
    const cutoff = Date.now() - 3600000
    const active = sessions.filter(s => s.lastMessageAt && new Date(s.lastMessageAt).getTime() > cutoff).slice(0, 4)
      .map((s, i) => ({ idx: i, sessionId: s.sessionId, projectSlug: s.projectSlug }))
    jsonResponse(res, getWorkersActivity(active))
    return
  }

  const latestOutputMatch = url.pathname.match(/^\/api\/workers\/([a-f0-9-]+)\/latest-output$/)
  if (latestOutputMatch && req.method === 'GET') {
    jsonResponse(res, getWorkerLatestOutput(latestOutputMatch[1]))
    return
  }

  if (url.pathname === '/api/route' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const { fromSessionId, toSessionId, toPath } = body
    if (!fromSessionId || !toSessionId) { jsonResponse(res, { error: 'fromSessionId and toSessionId required' }, 400); return }
    const output = getWorkerLatestOutput(fromSessionId)
    if (!output.text) { jsonResponse(res, { error: 'No output found from source worker' }, 404); return }
    const routePrompt = `# Routed context from another agent\n\nThe following is the latest output from a collaborating agent. Use it as context for your current task:\n\n---\n${output.text}\n---\n\nContinue your work, incorporating this context where relevant.`
    jsonResponse(res, { ok: true, routedText: output.text, truncated: output.truncated, prompt: routePrompt })
    return
  }

  if (url.pathname === '/api/suggestions' && req.method === 'GET') {
    const agentFiles = existsSync(SAFE_DIRS.agents) ? readdirSync(SAFE_DIRS.agents).filter(f => f.endsWith('.md')) : []
    jsonResponse(res, getSuggestions(agentFiles))
    return
  }

  if (url.pathname === '/api/harness/summary') { jsonResponse(res, getHarnessSummary()); return }
  if (url.pathname === '/api/harness/rules') { jsonResponse(res, getHarnessRules()); return }
  if (url.pathname === '/api/harness/commands') { jsonResponse(res, getHarnessCommands()); return }
  if (url.pathname === '/api/harness/agents') { jsonResponse(res, getHarnessAgents()); return }
  if (url.pathname === '/api/harness/hooks') { jsonResponse(res, getHarnessHooks()); return }
  if (url.pathname === '/api/harness/scripts') { jsonResponse(res, getHarnessScripts()); return }
  if (url.pathname === '/api/memory') { jsonResponse(res, { files: getMemoryFiles(), index: getMemoryIndex() }); return }
  const memFileMatch = url.pathname.match(/^\/api\/memory\/(.+\.md)$/)
  if (memFileMatch) {
    const filename = decodeURIComponent(memFileMatch[1])
    const fp = join(SAFE_DIRS.memory, filename)
    if (!fp.startsWith(SAFE_DIRS.memory) || !existsSync(fp)) { jsonResponse(res, { error: 'Not found' }, 404); return }
    try { jsonResponse(res, { filename, content: readFileSync(fp, 'utf-8') }) } catch { jsonResponse(res, { error: 'Read failed' }, 500) }
    return
  }
  if (url.pathname === '/api/lessons') { jsonResponse(res, getLessonsLearned()); return }
  if (url.pathname === '/api/logs' && !url.pathname.includes('/api/logs/')) { jsonResponse(res, getLogFiles()); return }

  const logFileMatch = url.pathname.match(/^\/api\/logs\/(.+)$/)
  if (logFileMatch) {
    const filename = decodeURIComponent(logFileMatch[1])
    const lines = parseInt(url.searchParams.get('lines') || '100', 10)
    const search = url.searchParams.get('search')
    if (search) { jsonResponse(res, searchLog(filename, search)); return }
    jsonResponse(res, tailLog(filename, lines)); return
  }

  // === Docs endpoints ===
  if (url.pathname === '/api/docs' && req.method === 'GET') { jsonResponse(res, { tree: await getDocTree() }); return }
  if (url.pathname === '/api/docs/read' && req.method === 'GET') {
    const path = url.searchParams.get('path')
    if (!path) { jsonResponse(res, { error: 'path required' }, 400); return }
    try { jsonResponse(res, await readDoc(path)) } catch (e) { jsonResponse(res, { error: e.message }, 404) }
    return
  }
  if (url.pathname === '/api/docs/write' && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    try { jsonResponse(res, await writeDoc(body.path, body.content)) } catch (e) { jsonResponse(res, { error: e.message }, 403) }
    return
  }
  if (url.pathname === '/api/docs/search' && req.method === 'GET') {
    jsonResponse(res, { results: await searchDocs(url.searchParams.get('q') || '') }); return
  }

  // === Agents & Skills endpoints ===
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const agents = getAgents()
    jsonResponse(res, { agents })
    if (DB_AVAILABLE) setImmediate(() => { try { upsertAgents(agents) } catch {} })
    return
  }
  if (url.pathname === '/api/agents' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const slug = (body.name || 'agent').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
    const filename = slug + '.md'
    const lines = ['---']
    lines.push(`description: ${body.description || body.name}`)
    if (body.model) lines.push(`model: ${body.model}`)
    if (body.tools && body.tools.length) lines.push(`tools: ${body.tools.join(', ')}`)
    lines.push('---', '')
    if (body.systemPrompt) lines.push(body.systemPrompt, '')
    if (body.subagents && body.subagents.length) lines.push('## Subagents', '', body.subagents.map(s => `- ${s}`).join('\n'), '')
    if (body.skills && body.skills.length) lines.push('## Skills', '', body.skills.map(s => `- ${s}`).join('\n'), '')
    if (body.modules && body.modules.length) lines.push('## Modules', '', body.modules.map(m => `- ${m}`).join('\n'), '')
    if (body.memory && body.memory.length) lines.push('## Memory', '', body.memory.map(m => `- ${m}`).join('\n'), '')
    try { saveAgent(filename, lines.join('\n')) } catch (e) { jsonResponse(res, { error: e.message }, 400); return }
    jsonResponse(res, { ok: true, filename }); return
  }
  const agentFileMatch = url.pathname.match(/^\/api\/agents\/(.+\.md)$/)
  if (agentFileMatch && req.method === 'GET') {
    const content = getAgentContent(decodeURIComponent(agentFileMatch[1]))
    if (!content) { jsonResponse(res, { error: 'Not found' }, 404); return }
    jsonResponse(res, { filename: decodeURIComponent(agentFileMatch[1]), content }); return
  }
  if (agentFileMatch && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    try { saveAgent(decodeURIComponent(agentFileMatch[1]), body.content) } catch (e) { jsonResponse(res, { error: e.message }, 400); return }
    jsonResponse(res, { ok: true }); return
  }
  if (url.pathname === '/api/skills' && req.method === 'GET') {
    const skills = getSkills()
    jsonResponse(res, { skills })
    if (DB_AVAILABLE) setImmediate(() => { try { upsertSkills(skills) } catch {} })
    return
  }
  const skillFileMatch = url.pathname.match(/^\/api\/skills\/(.+\.md)$/)
  if (skillFileMatch && req.method === 'GET') {
    const content = getSkillContent(decodeURIComponent(skillFileMatch[1]))
    if (!content) { jsonResponse(res, { error: 'Not found' }, 404); return }
    jsonResponse(res, { filename: decodeURIComponent(skillFileMatch[1]), content }); return
  }
  if (skillFileMatch && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    try { saveSkill(decodeURIComponent(skillFileMatch[1]), body.content) } catch (e) { jsonResponse(res, { error: e.message }, 400); return }
    jsonResponse(res, { ok: true }); return
  }

  // === Projects endpoints ===
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    jsonResponse(res, { projects: getProjects() }); return
  }
  const projectDocMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/docs\/([^/]+\.md)$/)
  if (projectDocMatch && req.method === 'GET') {
    const result = getProjectDoc(decodeURIComponent(projectDocMatch[1]), decodeURIComponent(projectDocMatch[2]))
    jsonResponse(res, result); return
  }
  if (projectDocMatch && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    try {
      const result = saveProjectDoc(decodeURIComponent(projectDocMatch[1]), decodeURIComponent(projectDocMatch[2]), body.content || '')
      jsonResponse(res, result)
    } catch (e) { jsonResponse(res, { error: e.message }, 400) }
    return
  }
  if (projectDocMatch && req.method === 'DELETE') {
    try {
      const result = deleteProjectDoc(decodeURIComponent(projectDocMatch[1]), decodeURIComponent(projectDocMatch[2]))
      jsonResponse(res, result)
    } catch (e) { jsonResponse(res, { error: e.message }, 400) }
    return
  }

  // === Labels endpoints ===
  if (url.pathname === '/api/labels' && req.method === 'GET') {
    jsonResponse(res, { labels: getLabels() }); return
  }
  if (url.pathname === '/api/labels' && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, setLabel(body.sessionId, body.label)); return
  }
  if (url.pathname === '/api/labels/bulk' && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, bulkSetLabels(body.entries || [])); return
  }
  if (url.pathname === '/api/labels/suggest' && req.method === 'GET') {
    const sessions = scanSessions()
    jsonResponse(res, { suggestions: getSuggestionsForSessions(sessions), knownLabels: getKnownLabels(sessions) }); return
  }

  // === Launch Configs endpoints ===
  if (url.pathname === '/api/launch-configs' && req.method === 'GET') {
    jsonResponse(res, { configs: listConfigs() }); return
  }
  const launchConfigMatch = url.pathname.match(/^\/api\/launch-configs\/(.+)$/)
  if (launchConfigMatch && req.method === 'GET') {
    const label = decodeURIComponent(launchConfigMatch[1])
    const config = getConfig(label)
    if (!config) { jsonResponse(res, { config: null }); return }
    jsonResponse(res, { config }); return
  }
  if (launchConfigMatch && req.method === 'PUT') {
    const label = decodeURIComponent(launchConfigMatch[1])
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, saveConfig(label, body)); return
  }

  // === OpenClaw Modules endpoints ===
  if (url.pathname === '/api/modules' && req.method === 'GET') { jsonResponse(res, getModules()); return }
  const modMatch = url.pathname.match(/^\/api\/modules\/([a-z-]+)$/)
  if (modMatch && req.method === 'GET') {
    const result = getModuleSource(modMatch[1])
    if (!result) { jsonResponse(res, { error: 'Module not found' }, 404); return }
    jsonResponse(res, result); return
  }

  // === Companion endpoints ===
  if (url.pathname === '/api/companion' && req.method === 'GET') { jsonResponse(res, getCompanion()); return }
  if (url.pathname === '/api/companion/visuals' && req.method === 'GET') { jsonResponse(res, getCompanionVisuals()); return }
  if (url.pathname === '/api/companion/event' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, processCompanionEvent(body.type || 'idle'))
    return
  }

  // === System endpoints ===
  if (url.pathname === '/api/system/health') { jsonResponse(res, getSystemHealth()); return }
  if (url.pathname === '/api/system/config') { jsonResponse(res, getClaudeConfig()); return }
  if (url.pathname === '/api/system/projects') { jsonResponse(res, { projects: getProjectStats() }); return }

  // === READ full file for editing ===
  const fileReadMatch = url.pathname.match(/^\/api\/file\/(rules|commands|agents|memory|scripts)\/(.+)$/)
  if (req.method === 'GET' && fileReadMatch) {
    const [, category, filename] = fileReadMatch
    const content = readFullFile(SAFE_DIRS[category], decodeURIComponent(filename))
    if (content === null) { jsonResponse(res, { error: 'Not found' }, 404); return }
    jsonResponse(res, { filename: decodeURIComponent(filename), content })
    return
  }

  // === WRITE file ===
  if (req.method === 'PUT' && fileReadMatch) {
    const [, category, filename] = fileReadMatch
    const fname = decodeURIComponent(filename)
    if (fname.includes('..') || fname.includes('/') || fname.includes('\\')) { jsonResponse(res, { error: 'Invalid filename' }, 400); return }
    const dir = SAFE_DIRS[category]
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const body = JSON.parse(await readBody(req))
    writeFileSync(join(dir, fname), body.content, 'utf-8')
    jsonResponse(res, { ok: true, filename: fname, savedAt: new Date().toISOString() })
    return
  }

  // === Claude Code auth status (cached 60s) ===
  if (url.pathname === '/api/claude/status' && req.method === 'GET') {
    const now = Date.now()
    if (_authCache && now - _authCache.ts < 60000) { jsonResponse(res, _authCache.data); return }
    try {
      const claudeBin = join(HOME, '.local', 'bin', 'claude')
      const raw = execSync(`"${claudeBin}" auth status`, { encoding: 'utf-8', timeout: 10000, env: { ...process.env, PATH: process.env.PATH + PATH_SEP + join(HOME, '.local', 'bin') } })
      const data = JSON.parse(raw)
      _authCache = { ts: now, data }
      jsonResponse(res, data)
    } catch (e) {
      const fallback = { loggedIn: false, error: e.message?.split('\n')[0] || 'Could not check auth status' }
      _authCache = { ts: now, data: fallback }
      jsonResponse(res, fallback)
    }
    return
  }

  // === Create new project ===
  if (req.method === 'POST' && url.pathname === '/api/projects/create') {
    const body = JSON.parse(await readBody(req))
    const name = (body.name || '').trim().replace(/[<>:"/\\|?*]/g, '-').replace(/-+/g, '-')
    if (!name || name.length < 2) { jsonResponse(res, { error: 'Project name must be at least 2 characters' }, 400); return }
    if (name.includes('..')) { jsonResponse(res, { error: 'Invalid project name' }, 400); return }

    const downloadsDir = join(HOME, 'Downloads')
    const projectDir = join(downloadsDir, name)
    if (existsSync(projectDir)) { jsonResponse(res, { error: `Folder "${name}" already exists in Downloads` }, 409); return }

    try {
      mkdirSync(projectDir, { recursive: true })
      if (body.initClaudeMd) {
        const claudeMd = `# ${name}\n\n## Project Context\n\nDescribe what this project does.\n\n## Guidelines\n\n- Add project-specific rules here\n`
        writeFileSync(join(projectDir, 'CLAUDE.md'), claudeMd, 'utf-8')
      }
      if (body.initGit) {
        execSync('git init', { cwd: projectDir, encoding: 'utf-8', timeout: 5000 })
        if (body.initClaudeMd) execSync('git add CLAUDE.md', { cwd: projectDir, encoding: 'utf-8', timeout: 5000 })
      }
      jsonResponse(res, { ok: true, path: projectDir, name })
    } catch (e) {
      jsonResponse(res, { error: 'Failed to create project: ' + e.message }, 500)
    }
    return
  }

  // === Import skill from URL ===
  if (req.method === 'POST' && url.pathname === '/api/agents/import-url') {
    const apiKey = resolveOpenAIKey()
    if (!apiKey) { jsonResponse(res, { error: 'No OpenAI API key found' }, 500); return }
    const body = JSON.parse(await readBody(req))
    const inputUrl = (body.url || '').trim()
    if (!inputUrl) { jsonResponse(res, { error: 'No URL provided' }, 400); return }

    try {
      const fetchUrl = (u) => new Promise((resolve, reject) => {
        const mod = u.startsWith('https') ? https : require('http')
        mod.get(u, { headers: { 'User-Agent': 'MissionControl/1.0' } }, (r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
            fetchUrl(r.headers.location).then(resolve).catch(reject); return
          }
          const chunks = []
          r.on('data', c => chunks.push(c))
          r.on('end', () => resolve(Buffer.concat(chunks).toString()))
        }).on('error', reject)
      })

      const content = await fetchUrl(inputUrl)
      if (!content || content.length < 10) throw new Error('Empty response from URL')
      if (content.length > 50000) throw new Error('Content too large (max 50KB)')

      const result = await openaiChat(apiKey, [
        { role: 'system', content: `You convert skill/tool definitions into Claude Code agent markdown files. Return ONLY valid JSON with these fields:
{
  "name": "kebab-case-name",
  "description": "one line description",
  "model": "claude-opus-4-6",
  "tools": ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
  "systemPrompt": "the full system prompt for the agent"
}
Pick relevant tools from: Read, Write, Edit, Bash, Grep, Glob. Write a clear, actionable system prompt that captures the skill's purpose and workflow. Use the skill content as inspiration but write a proper agent prompt.` },
        { role: 'user', content: `Convert this skill/tool definition into a Claude Code agent:\n\nSource URL: ${inputUrl}\n\nContent:\n${content.slice(0, 12000)}` }
      ])

      const msg = result.choices?.[0]?.message?.content
      if (!msg) throw new Error('No response from AI')
      const jsonStr = msg.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      const agent = JSON.parse(jsonStr)
      jsonResponse(res, { ok: true, agent })
    } catch (e) {
      jsonResponse(res, { error: 'Import failed: ' + e.message }, 500)
    }
    return
  }

  // === Terminal actions ===
  if (req.method === 'POST' && url.pathname === '/api/open-terminal') {
    const body = JSON.parse(await readBody(req))
    const dir = body.path || process.env.HOME || process.env.USERPROFILE || HOME
    openTerminalAt(dir)
    jsonResponse(res, { ok: true }); return
  }

  if (req.method === 'POST' && url.pathname === '/api/resume-terminal') {
    const body = JSON.parse(await readBody(req))
    const { sessionId, path: p, prompt, model, name: sessionName } = body
    const dir = p || process.env.HOME || process.env.USERPROFILE || HOME

    if (prompt) {
      const ts = Date.now()
      const promptFile = join(tmpdir(), `mc-prompt-${ts}.md`)
      const launcherFile = join(tmpdir(), `mc-launch-${ts}${launcherFileExt()}`)
      writeFileSync(promptFile, prompt, 'utf-8')
      const script = buildLauncherScript({ promptFile, launcherFile, sessionId, model, sessionName })
      writeFileSync(launcherFile, script, 'utf-8')
      launchInTerminal(dir, launcherFile)
    } else {
      const ts = Date.now()
      const launcherFile = join(tmpdir(), `mc-launch-${ts}${launcherFileExt()}`)
      const promptFile = join(tmpdir(), `mc-prompt-${ts}.md`)
      writeFileSync(promptFile, '', 'utf-8')
      const script = buildLauncherScript({ promptFile, launcherFile, sessionId, model, sessionName })
      // No prompt: replace the prompt-piping line with a plain claude call
      const noPromptScript = IS_WIN
        ? script.replace(/\$prompt = .*\n/, '').replace(/--dangerously-skip-permissions "\$prompt"/, '--dangerously-skip-permissions')
        : script.replace(/PROMPT=.*\n/, '').replace(/--dangerously-skip-permissions "\$PROMPT"/, '--dangerously-skip-permissions')
      writeFileSync(launcherFile, noPromptScript, 'utf-8')
      launchInTerminal(dir, launcherFile)
    }
    jsonResponse(res, { ok: true }); return
  }

  // === Headless terminal API ===
  if (req.method === 'POST' && url.pathname === '/api/terminal/spawn') {
    const body = JSON.parse(await readBody(req))
    const id = createTerminal(body)
    jsonResponse(res, { ok: true, terminalId: id })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/terminal/send') {
    const body = JSON.parse(await readBody(req))
    const { terminalId, message } = body
    if (!terminalId || !message) { jsonResponse(res, { error: 'terminalId and message required' }, 400); return }
    jsonResponse(res, sendMessage(terminalId, message))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/terminal/list') {
    jsonResponse(res, { terminals: listTerminals() })
    return
  }

  const terminalOutputMatch = url.pathname.match(/^\/api\/terminal\/([^/]+)\/output$/)
  if (terminalOutputMatch && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') || '0', 10)
    jsonResponse(res, getOutput(terminalOutputMatch[1], since || undefined))
    return
  }

  const terminalStreamMatch = url.pathname.match(/^\/api\/terminal\/([^/]+)\/stream$/)
  if (terminalStreamMatch && req.method === 'GET') {
    const tid = terminalStreamMatch[1]
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write(`data: ${JSON.stringify({ type: 'connected', terminalId: tid })}\n\n`)
    const onChunk = (chunk) => {
      try { res.write(`data: ${JSON.stringify(chunk)}\n\n`) } catch {}
    }
    if (!addOutputListener(tid, onChunk)) {
      res.write(`data: ${JSON.stringify({ type: 'error', text: 'Terminal not found' })}\n\n`)
      res.end()
      return
    }
    req.on('close', () => removeOutputListener(tid, onChunk))
    return
  }

  const terminalKillMatch = url.pathname.match(/^\/api\/terminal\/([^/]+)\/kill$/)
  if (terminalKillMatch && req.method === 'POST') {
    jsonResponse(res, killTerminal(terminalKillMatch[1]))
    return
  }

  // === Orchestrator prompt composition ===
  if (req.method === 'POST' && url.pathname === '/api/orchestrate') {
    let body
    try { body = JSON.parse(await readBody(req)) } catch (e) { jsonResponse(res, { error: 'Invalid JSON: ' + e.message }, 400); return }
    const { agent: agentFile, project, skills: skillFiles, subagents: subagentFiles, model, memory: memoryFiles, modules: moduleIds, moduleSettings } = body
    const parts = []

    if (agentFile) {
      const content = readFullFile(SAFE_DIRS.agents, agentFile)
      if (content) {
        const { meta, body: agentBody } = parseFrontmatter(content)
        parts.push(`# Orchestrator Agent: ${meta.description || agentFile.replace('.md', '')}`)
        parts.push(agentBody.trim())
      }
    }

    if (project) {
      parts.push(`\n# Project Context`)
      parts.push(`Working directory: ${project.path || 'unknown'}`)
      if (project.name) parts.push(`Project: ${project.name}`)
      if (project.path && !project.path.includes('..')) {
        const claudeMd = join(project.path, 'CLAUDE.md')
        if (existsSync(claudeMd)) {
          try {
            const rules = readFileSync(claudeMd, 'utf-8').trim()
            if (rules.length > 0 && rules.length < 8000) {
              parts.push(`\n## Project Rules (CLAUDE.md)`)
              parts.push(rules)
            }
          } catch {}
        }
      }
    }

    if (skillFiles && skillFiles.length > 0) {
      parts.push(`\n# Available Skills`)
      for (const sf of skillFiles) {
        const content = readFullFile(SAFE_DIRS.commands, sf)
        if (content) {
          const { meta, body: skillBody } = parseFrontmatter(content)
          const name = sf.replace('.md', '')
          parts.push(`\n## /${name}${meta.description ? ': ' + meta.description : ''}`)
          if (meta['allowed-tools']) parts.push(`Allowed tools: ${meta['allowed-tools']}`)
          const trimmed = skillBody.trim().split('\n').slice(0, 40).join('\n')
          if (trimmed) parts.push(trimmed)
        }
      }
    }

    if (subagentFiles && subagentFiles.length > 0) {
      parts.push(`\n# Subagents`)
      for (const sa of subagentFiles) {
        const content = readFullFile(SAFE_DIRS.agents, sa.filename || sa)
        if (content) {
          const { meta, body: saBody } = parseFrontmatter(content)
          const name = (sa.filename || sa).replace('.md', '')
          parts.push(`\n## Subagent: ${name}`)
          if (meta.description) parts.push(`Description: ${meta.description}`)
          if (meta.model) parts.push(`Model: ${meta.model}`)
          if (sa.skills && sa.skills.length > 0) parts.push(`Skills: ${sa.skills.map(s => '/' + s.replace('.md', '')).join(', ')}`)
          const summary = saBody.trim().split('\n').slice(0, 5).join('\n')
          if (summary) parts.push(summary)
        }
      }
    }

    if (memoryFiles && memoryFiles.length > 0) {
      parts.push(`\n# Memory Context`)
      for (const mf of memoryFiles) {
        const content = readFullFile(SAFE_DIRS.memory, mf)
        if (content) {
          const { meta, body: memBody } = parseFrontmatter(content)
          parts.push(`\n## ${meta.name || mf}: ${meta.description || ''}`)
          const summary = memBody.trim().split('\n').slice(0, 8).join('\n')
          if (summary) parts.push(summary)
        }
      }
    }

    if (moduleIds && moduleIds.length > 0) {
      const modData = getModules()
      const pickedMods = moduleIds.map(id => (modData.modules || []).find(m => m.id === id)).filter(Boolean)
      if (pickedMods.length) {
        parts.push(`\n# OpenClaw Modules (openclaw-features)`)
        parts.push(`Install: \`npm i openclaw-features\`\n`)
        for (const m of pickedMods) {
          const importPath = m.id === 'feature-flags' ? 'openclaw-features/flags'
            : m.id === 'coordinator' ? 'openclaw-features/coordinator'
            : m.id === 'cron-scheduler' ? 'openclaw-features/scheduler'
            : m.id === 'memory-store' ? 'openclaw-features/memory'
            : m.id === 'team-memory' ? 'openclaw-features/team-memory'
            : m.id === 'auto-dream' ? 'openclaw-features/dream'
            : m.id === 'companion' ? 'openclaw-features/companion'
            : m.id === 'away-summary' ? 'openclaw-features/away-summary'
            : `openclaw-features`
          parts.push(`## ${m.name}`)
          parts.push(`${m.description}`)
          parts.push(`Import: \`import { ${(m.exports || []).slice(0, 3).join(', ')}${(m.exports || []).length > 3 ? ', ...' : ''} } from '${importPath}'\``)
          if (m.capabilities) parts.push(`Capabilities: ${m.capabilities.join(', ')}`)
          if (m.requires) parts.push(`Requires: ${m.requires.join(', ')}`)
          const settings = []
          if (m.id === 'coordinator' && moduleSettings?.coordinatorMaxWorkers) settings.push(`maxWorkers: ${moduleSettings.coordinatorMaxWorkers}`)
          if (m.id === 'memory-store' && moduleSettings?.memoryTokenBudget) settings.push(`tokenBudget: ${moduleSettings.memoryTokenBudget}`)
          if (m.id === 'away-summary' && moduleSettings?.awayMinMinutes) settings.push(`minAwayMinutes: ${moduleSettings.awayMinMinutes}`)
          if (m.id === 'cron-scheduler' && moduleSettings?.cronTickInterval) settings.push(`tickInterval: ${moduleSettings.cronTickInterval}s`)
          if (settings.length) parts.push(`Config: ${settings.join(', ')}`)
          parts.push('')
        }
      }
    }

    const prompt = parts.join('\n')
    jsonResponse(res, { prompt, length: prompt.length, model: model || null })
    return
  }

  // === AI Improvement Chat ===
  if (req.method === 'POST' && url.pathname === '/api/improve/chat') {
    const apiKey = resolveOpenAIKey()
    if (!apiKey) { jsonResponse(res, { error: 'No OpenAI API key found. Set OPENAI_API_KEY or add it to a Hive .env file.' }, 500); return }

    const body = JSON.parse(await readBody(req))
    const userMessage = body.message
    if (!userMessage) { jsonResponse(res, { error: 'No message provided' }, 400); return }

    const currentLessons = getLessonsLearned()
    const currentMemory = getMemoryFiles()
    const lessonsText = currentLessons.sections.map(s => `## ${s.title}\n${s.items.map(i => `- **${i.rule}**: ${i.detail}`).join('\n')}`).join('\n\n')
    const memoryText = currentMemory.map(m => `[${m.type}] ${m.name}: ${m.description}`).join('\n')

    const systemPrompt = `You are the Harness Improvement Assistant for Robin Bril's Agentic Development Harness for Claude Code.

Your job: analyze input from Robin and determine if it should become a new lesson, memory record, rule update, or nothing.

CURRENT LESSONS (lessons-learned.md):
${lessonsText}

CURRENT MEMORY RECORDS:
${memoryText}

RULES:
1. Check for OVERLAP with existing lessons/memory. If the input is already covered, say so and explain what already exists.
2. If it's genuinely new, propose the exact change as structured output.
3. Validate: is this actionable, specific, and not too broad?
4. Never propose duplicate entries.
5. Respond in Dutch if Robin writes in Dutch, English if English.

Response format (JSON):
{
  "analysis": "Your analysis of the input",
  "action": "add_lesson" | "add_memory" | "update_lesson" | "update_memory" | "none",
  "overlap": ["list of existing items that overlap"],
  "proposal": {
    "type": "lesson" | "memory",
    "category": "for lessons: section name like 'Shell & Azure CLI'",
    "rule": "for lessons: the bold rule name",
    "detail": "for lessons: the explanation after the rule",
    "memoryType": "for memory: user|feedback|project|reference",
    "memoryName": "for memory: filename without .md",
    "memoryTitle": "for memory: human readable name",
    "memoryDescription": "for memory: one-line description",
    "memoryBody": "for memory: the content"
  }
}`

    try {
      const result = await openaiChat(apiKey, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ])
      const reply = result.choices?.[0]?.message?.content || 'No response from AI'
      let parsed = null
      try {
        const jsonMatch = reply.match(/\{[\s\S]*\}/)
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
      } catch { /* return raw text */ }
      jsonResponse(res, { reply, parsed })
    } catch (err) {
      jsonResponse(res, { error: 'AI call failed: ' + err.message }, 500)
    }
    return
  }

  // === Apply AI proposal ===
  if (req.method === 'POST' && url.pathname === '/api/improve/apply') {
    const body = JSON.parse(await readBody(req))
    const { proposal } = body
    if (!proposal) { jsonResponse(res, { error: 'No proposal' }, 400); return }

    if (proposal.type === 'lesson') {
      const fp = join(CLAUDE_HOME, 'rules', 'common', 'lessons-learned.md')
      let raw = existsSync(fp) ? readFileSync(fp, 'utf-8') : '# Lessons Learned\n'
      const sectionHeader = `## ${proposal.category}`
      const newEntry = `- **${proposal.rule}**: ${proposal.detail}`
      if (raw.includes(sectionHeader)) {
        raw = raw.replace(sectionHeader, `${sectionHeader}\n\n${newEntry}`)
      } else {
        raw += `\n${sectionHeader}\n\n${newEntry}\n`
      }
      writeFileSync(fp, raw, 'utf-8')
      jsonResponse(res, { ok: true, type: 'lesson', applied: newEntry })
    } else if (proposal.type === 'memory') {
      const fname = (proposal.memoryName || 'new_memory').replace(/[^a-z0-9_-]/gi, '_') + '.md'
      const content = `---\nname: ${proposal.memoryTitle || proposal.memoryName}\ndescription: ${proposal.memoryDescription || ''}\ntype: ${proposal.memoryType || 'project'}\n---\n\n${proposal.memoryBody || ''}\n`
      writeFileSync(join(SAFE_DIRS.memory, fname), content, 'utf-8')
      jsonResponse(res, { ok: true, type: 'memory', filename: fname })
    } else {
      jsonResponse(res, { error: 'Unknown proposal type' }, 400)
    }
    return
  }

  // === Team Sync endpoints ===
  if (url.pathname === '/api/team-sync/status' && req.method === 'GET') {
    jsonResponse(res, getTeamSyncStatus()); return
  }
  if (url.pathname === '/api/team-sync/memory' && req.method === 'GET') {
    const project = url.searchParams.get('project') || ''
    jsonResponse(res, listSharedMemory(project || undefined)); return
  }
  if (url.pathname === '/api/team-sync/skills' && req.method === 'GET') {
    jsonResponse(res, listSharedSkills()); return
  }
  if (url.pathname === '/api/team-sync/file' && req.method === 'GET') {
    const type = url.searchParams.get('type')
    const project = url.searchParams.get('project')
    const filename = url.searchParams.get('filename')
    jsonResponse(res, readSharedFile(type, project, filename)); return
  }
  if (url.pathname === '/api/team-sync/file' && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, writeSharedFile(body.type, body.project, body.filename, body.content)); return
  }
  if (url.pathname === '/api/team-sync/pull' && req.method === 'POST') {
    jsonResponse(res, pullFromRemote()); return
  }
  if (url.pathname === '/api/team-sync/push' && req.method === 'POST') {
    jsonResponse(res, pushToRemote()); return
  }
  if (url.pathname === '/api/team-sync/sync-file' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, syncFile(body.direction, body.type, body.project, body.filename)); return
  }
  if (url.pathname === '/api/team-sync/projects' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, createProject(body.name)); return
  }

  // === Agent Bus endpoints (Claw3D patterns) ===
  if (url.pathname === '/api/bus/events' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, postEvent(body)); return
  }
  if (url.pathname === '/api/bus/events' && req.method === 'GET') {
    const filter = {
      project: url.searchParams.get('project') || undefined,
      agent: url.searchParams.get('agent') || undefined,
      event: url.searchParams.get('event') || undefined,
      since: url.searchParams.get('since') ? parseInt(url.searchParams.get('since')) : undefined,
      limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')) : undefined,
    }
    jsonResponse(res, getEvents(filter)); return
  }
  if (url.pathname === '/api/bus/messages' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, sendDirectedMessage(body)); return
  }
  const busMessagesMatch = url.pathname.match(/^\/api\/bus\/messages\/(.+)$/)
  if (busMessagesMatch && req.method === 'GET') {
    jsonResponse(res, getMessagesForAgent(decodeURIComponent(busMessagesMatch[1]))); return
  }
  if (url.pathname === '/api/bus/messages/deliver' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const result = markMessageDelivered(body.messageId)
    if (!result) { jsonResponse(res, { error: 'Message not found' }, 404); return }
    jsonResponse(res, result); return
  }
  if (url.pathname === '/api/bus/handoffs' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, sendHandoff(body)); return
  }
  const busHandoffsMatch = url.pathname.match(/^\/api\/bus\/handoffs\/(.+)$/)
  if (busHandoffsMatch && req.method === 'GET') {
    jsonResponse(res, getHandoffsForAgent(decodeURIComponent(busHandoffsMatch[1]))); return
  }
  if (url.pathname === '/api/bus/handoffs/complete' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const result = completeHandoff(body.handoffId, body.result)
    if (!result) { jsonResponse(res, { error: 'Handoff not found' }, 404); return }
    jsonResponse(res, result); return
  }
  if (url.pathname === '/api/bus/tasks' && req.method === 'GET') {
    const project = url.searchParams.get('project') || undefined
    jsonResponse(res, getSharedTasks(project)); return
  }
  if (url.pathname === '/api/bus/tasks' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jsonResponse(res, createSharedTask(body)); return
  }
  if (url.pathname === '/api/bus/tasks/update' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    const result = updateSharedTask(body.taskId, body)
    if (!result) { jsonResponse(res, { error: 'Task not found' }, 404); return }
    jsonResponse(res, result); return
  }
  const busContextMatch = url.pathname.match(/^\/api\/bus\/context\/(.+)$/)
  if (busContextMatch && req.method === 'GET') {
    jsonResponse(res, getProjectContext(decodeURIComponent(busContextMatch[1]))); return
  }
  if (url.pathname === '/api/bus/history' && req.method === 'GET') {
    const filter = {
      project: url.searchParams.get('project') || undefined,
      agent: url.searchParams.get('agent') || undefined,
      limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')) : undefined,
    }
    jsonResponse(res, getMessageHistory(filter)); return
  }
  if (url.pathname === '/api/bus/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write('data: {"type":"connected"}\n\n')
    addListener(res)
    return
  }

  // === Relationship Graph endpoints ===
  if (url.pathname === '/api/graph' && req.method === 'GET') {
    jsonResponse(res, getRelationshipIndex()); return
  }
  const graphSessionMatch = url.pathname.match(/^\/api\/graph\/session\/([a-f0-9-]+)$/)
  if (graphSessionMatch && req.method === 'GET') {
    const result = getSessionGraph(graphSessionMatch[1])
    if (!result) { jsonResponse(res, { error: 'Session not found' }, 404); return }
    jsonResponse(res, result); return
  }
  const graphAgentMatch = url.pathname.match(/^\/api\/graph\/agent\/(.+)$/)
  if (graphAgentMatch && req.method === 'GET') {
    jsonResponse(res, getAgentGraph(decodeURIComponent(graphAgentMatch[1]))); return
  }
  const graphSkillMatch = url.pathname.match(/^\/api\/graph\/skill\/(.+)$/)
  if (graphSkillMatch && req.method === 'GET') {
    jsonResponse(res, getSkillGraph(decodeURIComponent(graphSkillMatch[1]))); return
  }
  const graphProjectMatch = url.pathname.match(/^\/api\/graph\/project\/(.+)$/)
  if (graphProjectMatch && req.method === 'GET') {
    const result = getProjectGraph(decodeURIComponent(graphProjectMatch[1]))
    if (!result) { jsonResponse(res, { error: 'Project not found' }, 404); return }
    jsonResponse(res, result); return
  }
  if (url.pathname === '/api/search' && req.method === 'GET') {
    const q = url.searchParams.get('q') || ''
    jsonResponse(res, searchAll(q)); return
  }

  // === Microsoft Skills catalog ===
  if (url.pathname === '/api/ms-skills') {
    jsonResponse(res, { skills: getMsSkills(), categories: getMsSkillCategories(), langs: getMsSkillLangs() });
    return;
  }

  // === HTML ===
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const appPath = join(__dirname, 'app.html')
    if (existsSync(appPath)) { htmlResponse(res, readFileSync(appPath, 'utf-8')) } else { htmlResponse(res, '<h1>app.html not found</h1>') }
    return
  }

  res.writeHead(404); res.end('Not found')
})

function isPortInUse(port) {
  return new Promise(resolve => {
    const tester = createServer().once('error', () => resolve(true)).once('listening', () => { tester.close(); resolve(false) }).listen(port)
  })
}

async function start() {
  const silent = process.argv.includes('--silent')
  const inUse = await isPortInUse(PORT)
  if (inUse) {
    if (!silent) { console.log(`Port ${PORT} already in use.`); exec(`start "" "http://localhost:${PORT}"`) }
    process.exit(0)
  }
  server.listen(PORT, HOST, () => {
    console.log(`Harness Dashboard: http://localhost:${PORT}`)
    if (!silent) exec(`start "" "http://localhost:${PORT}"`)
    triggerBackgroundScan()
  })
}

start()
