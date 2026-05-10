import { openSync, readSync, closeSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const CACHE_TTL_MS = 30_000

let _cache = null
let _cacheTs = 0

function readTailBytes(filePath, bytes) {
  let fd
  try {
    fd = openSync(filePath, 'r')
    const size = statSync(filePath).size
    const offset = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - offset)
    readSync(fd, buf, 0, buf.length, offset)
    return buf.toString('utf-8')
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch { /* ignore */ }
  }
}

function getRecentSessionFiles(max) {
  try {
    const files = []
    for (const slug of readdirSync(PROJECTS_DIR)) {
      const slugDir = join(PROJECTS_DIR, slug)
      let entries
      try { entries = readdirSync(slugDir) } catch { continue }
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue
        const fp = join(slugDir, entry)
        try { files.push({ fp, mtime: statSync(fp).mtime.getTime() }) } catch { /* skip */ }
      }
    }
    return files.sort((a, b) => b.mtime - a.mtime).slice(0, max).map(f => f.fp)
  } catch { return [] }
}

function parseLines(raw) {
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* skip */ }
  }
  return out
}

function checkUncommittedChanges() {
  try {
    const out = execSync('git status --porcelain', {
      cwd: process.cwd(), timeout: 3000, encoding: 'utf-8', windowsHide: true,
    })
    const n = out.split('\n').filter(l => l.trim()).length
    if (n === 0) return null
    return {
      id: 'uncommitted-changes', icon: '📋',
      label: `${n} uncommitted file${n > 1 ? 's' : ''}`,
      description: 'Review uncommitted changes for issues',
      agentName: 'code-reviewer', model: 'claude-sonnet-4-6',
      prompt: 'Review the uncommitted changes in this repository. Run git diff, analyze each change, check for bugs, security issues, and code quality.',
      priority: 1,
    }
  } catch { return null }
}

function checkBuildErrors(sessionFiles) {
  try {
    const cutoff = Date.now() - 60 * 60 * 1000
    const re = /error TS|failed to compile|Build failed|FAILED/i
    for (const fp of sessionFiles) {
      let raw
      try { raw = readTailBytes(fp, 8192) } catch { continue }
      for (const entry of parseLines(raw)) {
        if (entry.type !== 'assistant') continue
        if ((entry.timestamp ? new Date(entry.timestamp).getTime() : 0) < cutoff) continue
        const parts = entry.message?.content
        const text = Array.isArray(parts)
          ? parts.map(c => (typeof c === 'string' ? c : (c?.text ?? ''))).join(' ')
          : String(parts ?? '')
        if (re.test(text)) return {
          id: 'build-errors', icon: '🔧', label: 'Build errors detected',
          description: 'Recent sessions had build failures',
          agentName: 'build-error-resolver', model: 'claude-sonnet-4-6',
          prompt: 'Build errors were detected in recent work. Run the build command, diagnose all errors, and fix them one by one.',
          priority: 2,
        }
      }
    }
  } catch { /* skip */ }
  return null
}

function checkTestsNotRun(sessionFiles) {
  try {
    if (sessionFiles.length === 0) return null
    const cutoff = Date.now() - 2 * 60 * 60 * 1000
    const re = /\btest\b|pytest|jest|vitest|npm test/i
    for (const fp of sessionFiles) {
      let raw
      try { raw = readTailBytes(fp, 8192) } catch { continue }
      for (const entry of parseLines(raw)) {
        if (entry.type !== 'tool_use' || entry.name !== 'Bash') continue
        if ((entry.timestamp ? new Date(entry.timestamp).getTime() : 0) < cutoff) continue
        if (re.test(String(entry.input?.command ?? ''))) return null
      }
    }
    return {
      id: 'tests-not-run', icon: '🧪', label: 'Tests not run',
      description: 'No test execution detected recently',
      agentName: 'tdd-guide', model: 'claude-sonnet-4-6',
      prompt: 'Run the test suite for this project. Check coverage and fix any failing tests.',
      priority: 3,
    }
  } catch { return null }
}

function validateAgent(s, availableAgents) {
  return availableAgents.includes(s.agentName + '.md') ? s : { ...s, agentName: 'general-purpose' }
}

export function getSuggestions(availableAgents) {
  const now = Date.now()
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache

  const sessionFiles = getRecentSessionFiles(5)
  const hits = [
    checkUncommittedChanges(),
    checkBuildErrors(sessionFiles),
  ].filter(Boolean)

  const raw = hits.length === 0 ? [{
    id: 'start-coding', icon: '⚡', label: 'Start coding',
    description: 'Begin work on this project',
    agentName: 'feature-builder', model: 'claude-sonnet-4-6',
    prompt: 'Survey the project structure and begin implementing. Start by reading key files to understand the codebase.',
    priority: 4,
  }] : hits

  const result = {
    suggestions: raw.map(s => validateAgent(s, availableAgents))
      .sort((a, b) => a.priority - b.priority)
      .slice(0, 3),
    generatedAt: new Date(now).toISOString(),
  }
  _cache = result
  _cacheTs = now
  return result
}
