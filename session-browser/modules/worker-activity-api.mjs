import { openSync, readSync, closeSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TAIL_BYTES = 8192
const MAX_TOOLS = 5
const CACHE_TTL_MS = 3000

const cache = new Map()

function actionForTool(name) {
  if (!name) return 'tool'
  if (/error|fail/i.test(name)) return 'error'
  if (['Read', 'Glob', 'Grep'].includes(name)) return 'read'
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return 'write'
  return 'tool'
}

function tailRead(filePath) {
  const fd = openSync(filePath, 'r')
  try {
    const { size } = statSync(filePath)
    const readSize = Math.min(TAIL_BYTES, size)
    const offset = size - readSize
    const buf = Buffer.alloc(readSize)
    readSync(fd, buf, 0, readSize, offset)
    return buf.toString('utf-8')
  } finally {
    closeSync(fd)
  }
}

function parseWorker(session) {
  const { idx, sessionId, projectSlug } = session
  const filePath = join(homedir(), '.claude', 'projects', projectSlug, `${sessionId}.jsonl`)

  if (!existsSync(filePath)) {
    return { idx, sessionId, tools: [], files: [], status: 'idle', lastToolAt: null }
  }

  const raw = tailRead(filePath)
  const lines = raw.split('\n').filter(Boolean)

  const toolBlocks = []

  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry.type !== 'assistant') continue
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type !== 'tool_use') continue
      toolBlocks.push({ block, timestamp: entry.timestamp ?? null })
    }
  }

  const recent = toolBlocks.slice(-MAX_TOOLS)

  const tools = recent.map(({ block, timestamp }) => ({
    name: block.name,
    inputSummary: JSON.stringify(block.input ?? {}).slice(0, 60),
    timestamp,
    action: actionForTool(block.name),
  }))

  const files = recent.slice(-MAX_TOOLS).reduce((acc, { block }) => {
    const p = block.input?.file_path ?? block.input?.path
    if (p) acc.push({ path: p, action: actionForTool(block.name) })
    return acc
  }, [])

  const now = Date.now()
  const lastToolAt = tools.length > 0 ? tools[tools.length - 1].timestamp : null

  let status = 'idle'
  if (lastToolAt) {
    const age = now - new Date(lastToolAt).getTime()
    if (age < 120_000) status = 'active'
  }
  if (tools.length > 0 && tools[tools.length - 1].action === 'error') status = 'error'

  return { idx, sessionId, tools, files, status, lastToolAt }
}

export function getWorkersActivity(activeSessions) {
  const now = Date.now()
  const workers = activeSessions.map(session => {
    const cached = cache.get(session.sessionId)
    if (cached && now - cached.ts < CACHE_TTL_MS) return cached.data
    let result
    try {
      result = parseWorker(session)
    } catch {
      result = { idx: session.idx, sessionId: session.sessionId, tools: [], files: [], status: 'idle', lastToolAt: null }
    }
    cache.set(session.sessionId, { data: result, ts: now })
    return result
  })
  return { workers, cachedAt: now }
}
