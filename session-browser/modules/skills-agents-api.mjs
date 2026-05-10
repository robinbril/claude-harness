import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HOME = homedir()
const AGENTS_DIR = join(HOME, '.claude', 'agents')
const COMMANDS_DIR = join(HOME, '.claude', 'commands')

/**
 * Parse YAML frontmatter from markdown content.
 * Handles multi-value "tools" fields that may be comma-separated or space-separated.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
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

/**
 * Parse a tools/allowed-tools string into an array.
 * Handles: "Read, Grep, Bash" or "Read Grep Bash" or "Read,Grep,Bash"
 */
function parseToolsList(raw) {
  if (!raw || typeof raw !== 'string') return []
  return raw.split(/[\s,]+/).map(t => t.trim()).filter(Boolean)
}

/**
 * Validate that a filename is safe (no path traversal, only .md extension).
 */
function isSafeFilename(filename) {
  return (
    filename.endsWith('.md') &&
    !filename.includes('..') &&
    !filename.includes('/') &&
    !filename.includes('\\')
  )
}

/**
 * Scan ~/.claude/agents/ and return one object per .md file.
 * Parses YAML frontmatter for: name, description, model, tools.
 */
export function getAgents() {
  if (!existsSync(AGENTS_DIR)) return []
  return readdirSync(AGENTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filepath = join(AGENTS_DIR, f)
      const content = readFileSync(filepath, 'utf-8')
      const { meta, body } = parseFrontmatter(content)
      const stat = statSync(filepath)
      return {
        filename: f,
        name: meta.name || f.replace('.md', ''),
        description: meta.description || '',
        model: meta.model || null,
        tools: parseToolsList(meta.tools || meta['allowed-tools'] || ''),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        content,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Scan ~/.claude/commands/ and return one object per .md file.
 * Parses YAML frontmatter for: description, allowed-tools.
 */
export function getSkills() {
  if (!existsSync(COMMANDS_DIR)) return []
  return readdirSync(COMMANDS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filepath = join(COMMANDS_DIR, f)
      const content = readFileSync(filepath, 'utf-8')
      const { meta, body } = parseFrontmatter(content)
      const stat = statSync(filepath)
      return {
        filename: f,
        name: meta.name || f.replace('.md', ''),
        description: meta.description || '',
        allowedTools: parseToolsList(meta['allowed-tools'] || meta.tools || ''),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        content,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Read full content of an agent file by filename.
 * Returns null if not found or filename is unsafe.
 */
export function getAgentContent(filename) {
  if (!isSafeFilename(filename)) return null
  const filepath = join(AGENTS_DIR, filename)
  if (!existsSync(filepath)) return null
  return readFileSync(filepath, 'utf-8')
}

/**
 * Write content to an agent file.
 * Creates the agents directory if it does not exist.
 * Returns true on success, throws on error.
 */
export function saveAgent(filename, content) {
  if (!isSafeFilename(filename)) throw new Error('Invalid agent filename')
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true })
  writeFileSync(join(AGENTS_DIR, filename), content, 'utf-8')
  return true
}

/**
 * Read full content of a skill/command file by filename.
 * Returns null if not found or filename is unsafe.
 */
export function getSkillContent(filename) {
  if (!isSafeFilename(filename)) return null
  const filepath = join(COMMANDS_DIR, filename)
  if (!existsSync(filepath)) return null
  return readFileSync(filepath, 'utf-8')
}

/**
 * Write content to a skill/command file.
 * Creates the commands directory if it does not exist.
 * Returns true on success, throws on error.
 */
export function saveSkill(filename, content) {
  if (!isSafeFilename(filename)) throw new Error('Invalid skill filename')
  if (!existsSync(COMMANDS_DIR)) mkdirSync(COMMANDS_DIR, { recursive: true })
  writeFileSync(join(COMMANDS_DIR, filename), content, 'utf-8')
  return true
}
