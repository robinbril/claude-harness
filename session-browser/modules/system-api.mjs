import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { readdir, stat as fsStat } from 'fs/promises'
import { join } from 'path'
import { homedir, platform, version as nodeVersion, uptime } from 'os'
import { exec, execSync } from 'child_process'

const HOME = homedir()
const CLAUDE_HOME = join(HOME, '.claude')
const OPENCLAW_CRON = join(HOME, '.openclaw', 'cron', 'jobs.json')

const SERVER_START_TIME = Date.now()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeStat(fp) {
  try { return statSync(fp) } catch { return null }
}

function safeReadJson(fp) {
  try { return JSON.parse(readFileSync(fp, 'utf-8')) } catch { return null }
}

/**
 * Recursively compute total size of a directory in bytes.
 * Returns { totalBytes, subdirs: Map<name, bytes> } for the top-level children.
 */
function dirStats(dirPath, depth = 0) {
  let total = 0
  const children = {}

  if (!existsSync(dirPath)) return { totalBytes: 0, children }

  let entries
  try { entries = readdirSync(dirPath) } catch { return { totalBytes: 0, children } }

  for (const entry of entries) {
    const fp = join(dirPath, entry)
    const s = safeStat(fp)
    if (!s) continue

    if (s.isDirectory()) {
      const sub = dirStats(fp, depth + 1)
      total += sub.totalBytes
      if (depth === 0) children[entry] = sub.totalBytes
    } else {
      total += s.size
      if (depth === 0) {
        // Group loose files under a virtual "(files)" key at root level
        children['(files)'] = (children['(files)'] || 0) + s.size
      }
    }
  }

  return { totalBytes: total, children }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Check whether any claude.exe / claude process is running.
 * Uses tasklist on Windows, ps on other platforms.
 */
function checkClaudeProcesses() {
  try {
    let output
    if (platform() === 'win32') {
      output = execSync('tasklist /FO CSV /NH /FI "IMAGENAME eq claude.exe" 2>NUL', {
        timeout: 5000,
        encoding: 'utf-8',
        windowsHide: true,
      })
    } else {
      output = execSync('pgrep -la claude 2>/dev/null || true', {
        timeout: 5000,
        encoding: 'utf-8',
      })
    }

    const lines = output.trim().split('\n').filter(l => l.trim() && !l.toLowerCase().includes('no tasks'))
    const procs = lines
      .map(line => {
        // CSV format: "claude.exe","18152","Console","1","645,216 K"
        const parts = line.replace(/"/g, '').split(',')
        return {
          name: parts[0] || 'claude',
          pid: parseInt(parts[1]) || 0,
          memKb: parts[4] ? parseInt(parts[4].replace(/\s*K\s*$/, '').replace(/,/g, '')) : 0,
        }
      })
      .filter(p => p.pid > 0)

    return { running: procs.length > 0, count: procs.length, processes: procs }
  } catch {
    return { running: false, count: 0, processes: [] }
  }
}

/**
 * Count JSONL files anywhere under ~/.claude/ and sum their sizes.
 */
function countJsonlFiles() {
  let count = 0
  let totalBytes = 0

  function walk(dir) {
    if (!existsSync(dir)) return
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const fp = join(dir, entry)
      const s = safeStat(fp)
      if (!s) continue
      if (s.isDirectory()) {
        walk(fp)
      } else if (entry.endsWith('.jsonl')) {
        count++
        totalBytes += s.size
      }
    }
  }

  walk(CLAUDE_HOME)
  return { count, totalBytes, formatted: formatBytes(totalBytes) }
}

/**
 * Merge settings.json and settings.local.json into one object (local wins).
 */
function mergeClaudeConfig() {
  const main = safeReadJson(join(CLAUDE_HOME, 'settings.json')) || {}
  const local = safeReadJson(join(CLAUDE_HOME, 'settings.local.json')) || {}

  // Deep-merge permissions: combine allow/deny arrays, local wins on scalars
  const merged = { ...main, ...local }
  if (main.permissions || local.permissions) {
    const mp = main.permissions || {}
    const lp = local.permissions || {}
    merged.permissions = {
      ...mp,
      ...lp,
      allow: [...new Set([...(mp.allow || []), ...(lp.allow || [])])],
      deny: [...new Set([...(mp.deny || []), ...(lp.deny || [])])],
    }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Async variants (non-blocking)
// ---------------------------------------------------------------------------

async function dirStatsAsync(dirPath, depth = 0) {
  let total = 0
  const children = {}
  if (!existsSync(dirPath)) return { totalBytes: 0, children }
  let entries
  try { entries = await readdir(dirPath) } catch { return { totalBytes: 0, children } }
  for (const entry of entries) {
    const fp = join(dirPath, entry)
    let s
    try { s = await fsStat(fp) } catch { continue }
    if (s.isDirectory()) {
      const sub = await dirStatsAsync(fp, depth + 1)
      total += sub.totalBytes
      if (depth === 0) children[entry] = sub.totalBytes
    } else {
      total += s.size
      if (depth === 0) children['(files)'] = (children['(files)'] || 0) + s.size
    }
  }
  return { totalBytes: total, children }
}

async function countJsonlFilesAsync() {
  let count = 0, totalBytes = 0
  async function walk(dir) {
    if (!existsSync(dir)) return
    let entries
    try { entries = await readdir(dir) } catch { return }
    for (const entry of entries) {
      const fp = join(dir, entry)
      let s
      try { s = await fsStat(fp) } catch { continue }
      if (s.isDirectory()) await walk(fp)
      else if (entry.endsWith('.jsonl')) { count++; totalBytes += s.size }
    }
  }
  await walk(CLAUDE_HOME)
  return { count, totalBytes, formatted: formatBytes(totalBytes) }
}

function checkClaudeProcessesAsync() {
  return new Promise(resolve => {
    const cmd = platform() === 'win32'
      ? 'tasklist /FO CSV /NH /FI "IMAGENAME eq claude.exe" 2>NUL'
      : 'pgrep -la claude 2>/dev/null || true'
    exec(cmd, { timeout: 5000, encoding: 'utf-8', windowsHide: true }, (err, output) => {
      if (err) { resolve({ running: false, count: 0, processes: [] }); return }
      const lines = (output || '').trim().split('\n').filter(l => l.trim() && !l.toLowerCase().includes('no tasks'))
      const procs = lines.map(line => {
        const parts = line.replace(/"/g, '').split(',')
        return { name: parts[0] || 'claude', pid: parseInt(parts[1]) || 0, memKb: parts[4] ? parseInt(parts[4].replace(/\s*K\s*$/, '').replace(/,/g, '')) : 0 }
      }).filter(p => p.pid > 0)
      resolve({ running: procs.length > 0, count: procs.length, processes: procs })
    })
  })
}

// ---------------------------------------------------------------------------
// Health cache
// ---------------------------------------------------------------------------

let _healthCache = null
let _healthCacheTime = 0
const HEALTH_CACHE_TTL = 30000
let _healthRefreshing = false

async function _refreshHealth() {
  if (_healthRefreshing) return
  _healthRefreshing = true
  try {
    const [diskResult, jsonlStats, claudeProcs] = await Promise.all([
      dirStatsAsync(CLAUDE_HOME),
      countJsonlFilesAsync(),
      checkClaudeProcessesAsync(),
    ])
    const projectsDir = join(CLAUDE_HOME, 'projects')
    let projectCount = 0
    if (existsSync(projectsDir)) {
      try {
        const entries = await readdir(projectsDir)
        for (const e of entries) {
          try { if ((await fsStat(join(projectsDir, e))).isDirectory()) projectCount++ } catch {}
        }
      } catch {}
    }
    const mem = process.memoryUsage()
    _healthCache = {
      node: { version: process.version, platform: platform(), osUptime: uptime(), serverUptimeMs: Date.now() - SERVER_START_TIME },
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external, rssFmt: formatBytes(mem.rss), heapUsedFmt: formatBytes(mem.heapUsed) },
      disk: { claudeHome: CLAUDE_HOME, totalBytes: diskResult.totalBytes, totalFmt: formatBytes(diskResult.totalBytes), breakdown: Object.entries(diskResult.children).map(([name, bytes]) => ({ name, bytes, formatted: formatBytes(bytes) })).sort((a, b) => b.bytes - a.bytes) },
      sessions: { jsonlCount: jsonlStats.count, jsonlBytes: jsonlStats.totalBytes, jsonlFmt: jsonlStats.formatted },
      projects: { count: projectCount },
      claudeProcesses: claudeProcs,
      capturedAt: new Date().toISOString(),
    }
    _healthCacheTime = Date.now()
  } catch {} finally { _healthRefreshing = false }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getSystemHealth() {
  const now = Date.now()
  if (!_healthCache || (now - _healthCacheTime) > HEALTH_CACHE_TTL) {
    _refreshHealth()
  }
  if (_healthCache) return _healthCache
  const mem = process.memoryUsage()
  return {
    node: { version: process.version, platform: platform(), osUptime: uptime(), serverUptimeMs: Date.now() - SERVER_START_TIME },
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external, rssFmt: formatBytes(mem.rss), heapUsedFmt: formatBytes(mem.heapUsed) },
    disk: { claudeHome: CLAUDE_HOME, totalBytes: 0, totalFmt: 'scanning...', breakdown: [] },
    sessions: { jsonlCount: 0, jsonlBytes: 0, jsonlFmt: 'scanning...' },
    projects: { count: 0 },
    claudeProcesses: { running: false, count: 0, processes: [] },
    capturedAt: new Date().toISOString(),
  }
}

/**
 * Returns the merged Claude Code configuration.
 * Sensitive values (API keys) are redacted if present.
 */
export function getClaudeConfig() {
  const config = mergeClaudeConfig()

  // Redact any keys that look like secrets
  const REDACT_KEYS = new Set(['apiKey', 'api_key', 'token', 'secret', 'password', 'AUTH_SECRET'])
  function redact(obj) {
    if (typeof obj !== 'object' || obj === null) return obj
    if (Array.isArray(obj)) return obj.map(redact)
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = REDACT_KEYS.has(k) ? '***' : redact(v)
    }
    return out
  }

  return {
    config: redact(config),
    sources: {
      main: existsSync(join(CLAUDE_HOME, 'settings.json')),
      local: existsSync(join(CLAUDE_HOME, 'settings.local.json')),
    },
  }
}

/**
 * Returns cron jobs from ~/.openclaw/cron/jobs.json if present.
 * Also checks ~/.claude/ for any schedule-related JSON files.
 */
export function getCronJobs() {
  const jobs = []

  // Primary: openclaw cron
  if (existsSync(OPENCLAW_CRON)) {
    const data = safeReadJson(OPENCLAW_CRON)
    if (Array.isArray(data)) {
      jobs.push(...data)
    } else if (data && Array.isArray(data.jobs)) {
      jobs.push(...data.jobs)
    }
  }

  // Secondary: check for any cron/schedule JSON under ~/.claude/
  const candidatePaths = [
    join(CLAUDE_HOME, 'scheduled_tasks.json'),
    join(CLAUDE_HOME, 'cron.json'),
    join(CLAUDE_HOME, 'schedules.json'),
  ]

  for (const fp of candidatePaths) {
    if (!existsSync(fp)) continue
    const data = safeReadJson(fp)
    if (Array.isArray(data)) {
      jobs.push(...data.map(j => ({ ...j, _source: fp })))
    } else if (data && typeof data === 'object') {
      jobs.push({ _source: fp, ...data })
    }
  }

  // Check scheduled_tasks.lock for lock status metadata
  const lockPath = join(CLAUDE_HOME, 'scheduled_tasks.lock')
  const hasLock = existsSync(lockPath)

  return {
    jobs,
    count: jobs.length,
    sources: {
      openclaw: existsSync(OPENCLAW_CRON),
      lockActive: hasLock,
    },
  }
}

/**
 * For each project directory under ~/.claude/projects/, return stats:
 * name, decoded path, session count, total JSONL size, last modified.
 */
export function getProjectStats() {
  const projectsDir = join(CLAUDE_HOME, 'projects')
  if (!existsSync(projectsDir)) return []

  let dirs
  try { dirs = readdirSync(projectsDir) } catch { return [] }

  return dirs
    .map(dirName => {
      const fullPath = join(projectsDir, dirName)
      const s = safeStat(fullPath)
      if (!s || !s.isDirectory()) return null

      // Decode directory name back to a human path (dashes replaced slashes)
      const decodedPath = dirName.replace(/--/g, '/').replace(/-/g, '/') || dirName

      // Scan for JSONL files within this project dir
      let sessionCount = 0
      let totalBytes = 0
      let lastModified = s.mtime

      let entries
      try { entries = readdirSync(fullPath) } catch { entries = [] }

      for (const entry of entries) {
        if (entry.endsWith('.jsonl') || entry.endsWith('.json')) {
          const fp = join(fullPath, entry)
          const fs2 = safeStat(fp)
          if (!fs2) continue
          if (entry.endsWith('.jsonl')) {
            sessionCount++
            totalBytes += fs2.size
          }
          if (fs2.mtime > lastModified) lastModified = fs2.mtime
        }
      }

      // Also check a sessions subdirectory if present
      const sessionsSubdir = join(fullPath, 'sessions')
      if (existsSync(sessionsSubdir)) {
        let subEntries
        try { subEntries = readdirSync(sessionsSubdir) } catch { subEntries = [] }
        for (const entry of subEntries) {
          if (entry.endsWith('.jsonl')) {
            const fp = join(sessionsSubdir, entry)
            const fs2 = safeStat(fp)
            if (!fs2) continue
            sessionCount++
            totalBytes += fs2.size
            if (fs2.mtime > lastModified) lastModified = fs2.mtime
          }
        }
      }

      return {
        name: dirName,
        decodedPath,
        sessionCount,
        totalBytes,
        totalFmt: formatBytes(totalBytes),
        lastModified: lastModified.toISOString(),
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified))
}
