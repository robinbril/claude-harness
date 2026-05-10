import { openSync, readSync, closeSync, statSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const TAIL_BYTES = 16384
const MAX_TEXT_LENGTH = 2000

function tailRead(filePath) {
  const stat = statSync(filePath)
  const size = stat.size
  const readSize = Math.min(TAIL_BYTES, size)
  const buf = Buffer.alloc(readSize)
  const fd = openSync(filePath, 'r')
  try { readSync(fd, buf, 0, readSize, size - readSize) }
  finally { closeSync(fd) }
  return buf.toString('utf-8')
}

function findSessionFile(sessionId) {
  if (!existsSync(PROJECTS_DIR)) return null
  let slugs
  try { slugs = readdirSync(PROJECTS_DIR) } catch { return null }
  for (const slug of slugs) {
    const candidate = join(PROJECTS_DIR, slug, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function getWorkerLatestOutput(sessionId) {
  const empty = { text: null, truncated: false, sessionId }
  try {
    const filePath = findSessionFile(sessionId)
    if (!filePath) return empty

    const raw = tailRead(filePath)
    const lines = raw.split('\n').reverse()

    for (const line of lines) {
      if (!line.trim()) continue
      let entry
      try { entry = JSON.parse(line) } catch { continue }

      if (entry.type !== 'assistant') continue
      const content = entry?.message?.content
      if (!Array.isArray(content)) continue

      const block = content.find(b => b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 20)
      if (!block) continue

      const full = block.text
      const truncated = full.length > MAX_TEXT_LENGTH
      return { text: full.slice(0, MAX_TEXT_LENGTH), truncated, sessionId }
    }

    return empty
  } catch {
    return empty
  }
}
