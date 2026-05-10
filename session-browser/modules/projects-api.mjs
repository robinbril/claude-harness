import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HOME = homedir()
const CLAUDE_HOME = join(HOME, '.claude')
const PROJECTS_DIR = join(CLAUDE_HOME, 'projects')

function safeStat(fp) {
  try { return statSync(fp) } catch { return null }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function decodeSlugToPath(slug) {
  return slug.replace(/--/g, ':\\').replace(/-/g, '\\')
}

function deriveProjectName(slug) {
  const raw = decodeSlugToPath(slug)
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

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  const meta = {}
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':')
    if (sep > 0) {
      meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return { meta, body: match[2] }
}

function isSafeFilename(name) {
  return /^[a-zA-Z0-9_-]+\.md$/.test(name) && !name.includes('..')
}

function getProjectDocsDir(slug) {
  return join(PROJECTS_DIR, slug, 'docs')
}

function scanProjectDocs(slug) {
  const docsDir = getProjectDocsDir(slug)
  if (!existsSync(docsDir)) return []
  let entries
  try { entries = readdirSync(docsDir) } catch { return [] }
  return entries
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const fp = join(docsDir, f)
      const s = safeStat(fp)
      if (!s) return null
      const raw = readFileSync(fp, 'utf-8')
      const { meta, body } = parseFrontmatter(raw)
      return {
        filename: f,
        name: meta.name || f.replace('.md', '').replace(/[-_]/g, ' '),
        description: meta.description || '',
        type: meta.type || 'note',
        preview: body.trim().slice(0, 200),
        sizeBytes: s.size,
        modifiedAt: s.mtime.toISOString(),
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
}

export function getProjects() {
  if (!existsSync(PROJECTS_DIR)) return []

  let dirs
  try { dirs = readdirSync(PROJECTS_DIR) } catch { return [] }

  return dirs
    .map(slug => {
      const fullPath = join(PROJECTS_DIR, slug)
      const s = safeStat(fullPath)
      if (!s || !s.isDirectory()) return null

      const sessionIds = []
      let totalBytes = 0
      let lastActivity = s.mtime

      let entries
      try { entries = readdirSync(fullPath) } catch { entries = [] }

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue
        const fp = join(fullPath, entry)
        const fs2 = safeStat(fp)
        if (!fs2) continue
        sessionIds.push(entry.replace('.jsonl', ''))
        totalBytes += fs2.size
        if (fs2.mtime > lastActivity) lastActivity = fs2.mtime
      }

      const docs = scanProjectDocs(slug)

      return {
        slug,
        name: deriveProjectName(slug),
        decodedPath: decodeSlugToPath(slug),
        sessionIds,
        sessionCount: sessionIds.length,
        totalBytes,
        totalFmt: formatBytes(totalBytes),
        lastActivity: lastActivity.toISOString(),
        docs,
        docCount: docs.length,
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
}

export function getProjectDoc(slug, filename) {
  if (!slug || slug.includes('..') || !isSafeFilename(filename)) {
    return { error: 'Invalid slug or filename' }
  }
  const fp = join(getProjectDocsDir(slug), filename)
  if (!existsSync(fp)) return { content: '', exists: false }
  return { content: readFileSync(fp, 'utf-8'), exists: true, filename }
}

export function saveProjectDoc(slug, filename, content) {
  if (!slug || slug.includes('..')) throw new Error('Invalid project slug')
  if (!isSafeFilename(filename)) throw new Error('Invalid filename (use alphanumeric, dashes, underscores, ending in .md)')
  const dir = join(PROJECTS_DIR, slug)
  if (!existsSync(dir)) throw new Error('Project directory does not exist')
  const docsDir = getProjectDocsDir(slug)
  if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true })
  writeFileSync(join(docsDir, filename), content, 'utf-8')
  return { ok: true, filename, savedAt: new Date().toISOString() }
}

export function deleteProjectDoc(slug, filename) {
  if (!slug || slug.includes('..') || !isSafeFilename(filename)) {
    throw new Error('Invalid slug or filename')
  }
  const fp = join(getProjectDocsDir(slug), filename)
  if (!existsSync(fp)) throw new Error('File not found')
  unlinkSync(fp)
  return { ok: true, deleted: filename }
}
