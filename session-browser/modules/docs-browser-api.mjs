import { readdir, readFile, stat, realpath, lstat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join, dirname, sep, resolve, normalize } from 'path'
import { homedir } from 'os'

const HOME = homedir()
const CLAUDE_HOME = join(HOME, '.claude')

// Directories scanned for docs. Each entry: { label, path, recursive }
function buildScanRoots() {
  const roots = []

  // ~/.claude/ root — CLAUDE.md only (non-recursive flat scan)
  roots.push({ label: '.claude', path: CLAUDE_HOME, recursive: false, filter: f => f === 'CLAUDE.md' || f === 'README.md' })

  // ~/.claude/rules/ — fully recursive
  const rulesDir = join(CLAUDE_HOME, 'rules')
  if (existsSync(rulesDir)) roots.push({ label: 'rules', path: rulesDir, recursive: true })

  // ~/.claude/commands/
  const commandsDir = join(CLAUDE_HOME, 'commands')
  if (existsSync(commandsDir)) roots.push({ label: 'commands', path: commandsDir, recursive: true })

  // ~/.claude/agents/
  const agentsDir = join(CLAUDE_HOME, 'agents')
  if (existsSync(agentsDir)) roots.push({ label: 'agents', path: agentsDir, recursive: true })

  // CWD — CLAUDE.md / README.md
  try {
    const cwd = process.cwd()
    roots.push({ label: 'cwd', path: cwd, recursive: false, filter: f => f === 'CLAUDE.md' || f.toLowerCase() === 'readme.md' })
  } catch { /* skip */ }

  // Optional: extra docs root, configurable via env var.
  const extraDocs = process.env.HARNESS_DOCS_ROOT
  if (extraDocs && existsSync(extraDocs)) roots.push({ label: 'extra-docs', path: extraDocs, recursive: true })

  return roots
}

// Path safety: only allow writing inside ~/.claude/
function isWriteAllowed(filepath) {
  const normalized = normalize(resolve(filepath))
  const claudeNorm = normalize(resolve(CLAUDE_HOME))
  return normalized === claudeNorm || normalized.startsWith(claudeNorm + sep)
}

// Prevent symlink escapes on read
async function safeRealpath(filepath) {
  try {
    const st = await lstat(filepath)
    if (st.isSymbolicLink()) throw new Error('Symbolic links are not allowed')
  } catch (err) {
    if (err.message === 'Symbolic links are not allowed') throw err
    // ENOENT — will surface when we try to read
  }
  return filepath
}

function isMarkdown(name) {
  const n = name.toLowerCase()
  return n.endsWith('.md') || n.endsWith('.txt')
}

// Build a tree node for a single directory entry
async function buildNode(fullPath, name, recursive, filter) {
  let st
  try { st = await stat(fullPath) } catch { return null }

  if (st.isDirectory() && recursive) {
    const children = await buildTreeFromDir(fullPath, recursive, filter)
    return {
      name,
      path: fullPath,
      type: 'dir',
      modifiedAt: st.mtime.toISOString(),
      children,
    }
  }

  if (st.isFile() && isMarkdown(name)) {
    if (filter && !filter(name)) return null
    return {
      name,
      path: fullPath,
      type: 'file',
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
    }
  }

  return null
}

async function buildTreeFromDir(dirPath, recursive, filter) {
  let entries
  try { entries = await readdir(dirPath, { withFileTypes: true }) } catch { return [] }

  const nodes = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const fullPath = join(dirPath, entry.name)
    const node = await buildNode(fullPath, entry.name, recursive, filter)
    if (node) nodes.push(node)
  }

  // Dirs first, then files; alphabetical within each group
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * Scan all configured doc directories and return a tree.
 * Returns: Array<{ name, path, type: 'file'|'dir', children?, sizeBytes?, modifiedAt? }>
 */
export async function getDocTree() {
  const roots = buildScanRoots()
  const tree = []

  for (const root of roots) {
    if (!existsSync(root.path)) continue
    let st
    try { st = await stat(root.path) } catch { continue }

    if (st.isDirectory()) {
      const children = await buildTreeFromDir(root.path, root.recursive !== false, root.filter)
      if (children.length === 0) continue
      tree.push({
        name: root.label,
        path: root.path,
        type: 'dir',
        modifiedAt: st.mtime.toISOString(),
        children,
      })
    } else if (st.isFile()) {
      tree.push({
        name: root.label,
        path: root.path,
        type: 'file',
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
      })
    }
  }

  return tree
}

/**
 * Read a markdown file by absolute path.
 * Returns: { content, filename, sizeBytes, modifiedAt }
 */
export async function readDoc(filepath) {
  if (!filepath || typeof filepath !== 'string') throw new Error('filepath required')

  const normalized = normalize(resolve(filepath))
  await safeRealpath(normalized)

  let st
  try { st = await stat(normalized) } catch {
    throw new Error('File not found: ' + filepath)
  }

  if (!st.isFile()) throw new Error('Not a file: ' + filepath)

  const content = await readFile(normalized, 'utf-8')
  return {
    content,
    filename: normalized.split(sep).pop(),
    sizeBytes: st.size,
    modifiedAt: st.mtime.toISOString(),
  }
}

/**
 * Write content back to a file.
 * Only paths inside ~/.claude/ are allowed.
 * Returns: { ok, savedAt }
 */
export async function writeDoc(filepath, content) {
  if (!filepath || typeof filepath !== 'string') throw new Error('filepath required')
  if (typeof content !== 'string') throw new Error('content must be a string')

  const normalized = normalize(resolve(filepath))

  if (!isWriteAllowed(normalized)) {
    throw new Error('Write not allowed outside ~/.claude/ directory')
  }

  const { writeFile } = await import('fs/promises')
  await writeFile(normalized, content, 'utf-8')

  return { ok: true, savedAt: new Date().toISOString() }
}

/**
 * Search across all docs for a query string.
 * Returns: Array<{ path, filename, matches, snippet }>
 * snippet is the first matching line with surrounding context.
 */
export async function searchDocs(query) {
  if (!query || typeof query !== 'string') return []
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []

  const allFiles = []

  function collectFiles(nodes) {
    for (const node of nodes) {
      if (node.type === 'file') {
        allFiles.push(node.path)
      } else if (node.children) {
        collectFiles(node.children)
      }
    }
  }

  const tree = await getDocTree()
  collectFiles(tree)

  const results = []

  for (const filePath of allFiles) {
    try {
      const st = await stat(filePath)
      if (st.size > 1_000_000) continue // skip huge files

      const content = await readFile(filePath, 'utf-8')
      const lower = content.toLowerCase()

      let count = 0
      let idx = lower.indexOf(q)
      let firstIdx = idx
      while (idx !== -1) {
        count++
        idx = lower.indexOf(q, idx + q.length)
      }

      if (count === 0) continue

      // Build a snippet: the line containing the first match + 1 line of context
      const lineStart = content.lastIndexOf('\n', firstIdx) + 1
      const lineEnd = content.indexOf('\n', firstIdx + q.length)
      const matchLine = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
      const snippet = matchLine.length > 200 ? matchLine.slice(0, 200) + '…' : matchLine

      results.push({
        path: filePath,
        filename: filePath.split(sep).pop(),
        matches: count,
        snippet,
      })
    } catch { /* skip unreadable */ }
  }

  return results.sort((a, b) => b.matches - a.matches)
}
