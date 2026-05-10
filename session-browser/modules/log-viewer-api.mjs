import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

const HOME = homedir()

// Candidate directories to scan for log files.
// Ordered by priority: Claude Code project logs first, then system logs.
const LOG_DIRS = [
  join(HOME, '.claude', 'scripts'),
  join(HOME, '.claude', 'logs'),
  join(HOME, 'AppData', 'Roaming', 'claude', 'logs'),
  join(HOME, 'AppData', 'Local', 'claude-code', 'logs'),
  join(HOME, 'AppData', 'Local', 'AnthropicClaude', 'logs'),
]

// Only expose these extensions via the API
const ALLOWED_EXTENSIONS = new Set(['.log', '.txt'])

function safeStat(fp) {
  try {
    return statSync(fp)
  } catch {
    return null
  }
}

/**
 * Scan all known Claude log directories for readable log files.
 * Returns a sorted list of file descriptors (newest modified first).
 *
 * @returns {{ files: Array<{ name: string, path: string, dir: string, sizeBytes: number, modifiedAt: string }> }}
 */
export function getLogFiles() {
  const seen = new Set()
  const files = []

  for (const dir of LOG_DIRS) {
    if (!existsSync(dir)) continue

    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      const fp = join(dir, entry)
      const lower = entry.toLowerCase()

      // Skip non-log files and already-seen paths
      const isLog = lower.endsWith('.log') || lower.endsWith('.txt')
      if (!isLog || seen.has(fp)) continue
      seen.add(fp)

      const s = safeStat(fp)
      if (!s || !s.isFile()) continue

      files.push({
        name: entry,
        path: fp,
        dir,
        sizeBytes: s.size,
        modifiedAt: s.mtime.toISOString(),
      })
    }
  }

  // Newest modified first
  files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))

  return { files }
}

/**
 * Read the last N lines of a log file.
 * The file is identified by basename; the API resolves the full path from known
 * directories so callers never send raw filesystem paths.
 *
 * @param {string} filename  - Basename of the log file, no directory component
 * @param {number} lines     - How many lines to return (default 100, max 2000)
 * @returns {{ lines: string[], totalLines: number, truncated: boolean, error?: string }}
 */
export function tailLog(filename, lines = 100) {
  const fp = resolveFilePath(filename)
  if (!fp) return { error: 'File not found', lines: [], totalLines: 0, truncated: false }

  const limit = Math.min(Number(lines) || 100, 2000)

  try {
    const content = readFileSync(fp, 'utf-8')
    const all = content.split('\n')
    // Drop the trailing empty entry that split leaves when file ends with \n
    if (all.length > 0 && all[all.length - 1] === '') all.pop()

    const totalLines = all.length
    const truncated = totalLines > limit
    const tail = truncated ? all.slice(-limit) : all

    return { lines: tail, totalLines, truncated }
  } catch (err) {
    return { error: err.message, lines: [], totalLines: 0, truncated: false }
  }
}

/**
 * Search a log file for lines matching a query string (case-insensitive substring).
 * Returns up to 500 matching lines to avoid flooding the UI.
 *
 * @param {string} filename - Basename of the log file
 * @param {string} query    - Search string (plain text, case-insensitive)
 * @returns {{ matches: Array<{ lineNumber: number, text: string }>, totalMatches: number, capped: boolean, error?: string }}
 */
export function searchLog(filename, query) {
  const fp = resolveFilePath(filename)
  if (!fp) return { error: 'File not found', matches: [], totalMatches: 0, capped: false }

  if (!query || !query.trim()) {
    return { error: 'Query is required', matches: [], totalMatches: 0, capped: false }
  }

  const MAX_RESULTS = 500

  try {
    const content = readFileSync(fp, 'utf-8')
    const allLines = content.split('\n')
    const q = query.toLowerCase()

    const matches = []
    let totalMatches = 0

    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i].toLowerCase().includes(q)) {
        totalMatches++
        if (matches.length < MAX_RESULTS) {
          matches.push({ lineNumber: i + 1, text: allLines[i] })
        }
      }
    }

    return { matches, totalMatches, capped: totalMatches > MAX_RESULTS }
  } catch (err) {
    return { error: err.message, matches: [], totalMatches: 0, capped: false }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a bare filename to an absolute path within the allowed directories.
 * Rejects any path traversal attempts.
 */
function resolveFilePath(filename) {
  // Guard: no directory separators or traversal sequences allowed
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return null
  }

  const lower = filename.toLowerCase()
  if (!lower.endsWith('.log') && !lower.endsWith('.txt')) return null

  for (const dir of LOG_DIRS) {
    if (!existsSync(dir)) continue
    const fp = join(dir, filename)
    const s = safeStat(fp)
    if (s && s.isFile()) return fp
  }

  return null
}
