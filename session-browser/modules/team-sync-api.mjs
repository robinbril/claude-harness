import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, copyFileSync } from 'fs'
import { join, basename, extname } from 'path'
import { execSync } from 'child_process'
import { homedir } from 'os'

const HOME = homedir()
// Override TEAM_SYNC_REPO to point at your own shared team-sync repo
// (e.g. a private git repo with "Shared Mem" and "Shared Skills" subdirectories).
const TEAM_SYNC_REPO = process.env.TEAM_SYNC_REPO || 'team-sync'
const SYNC_ROOT = join(HOME, '.claude', 'team-sync', TEAM_SYNC_REPO)
const SHARED_MEM = join(SYNC_ROOT, 'Shared Mem')
const SHARED_SKILLS = join(SYNC_ROOT, 'Shared Skills')
const LOCAL_MEM = join(HOME, '.claude', 'projects', 'memory')
const LOCAL_SKILLS = join(HOME, '.claude', 'commands')

function git(cmd, opts = {}) {
  return execSync(`git ${cmd}`, {
    cwd: SYNC_ROOT,
    encoding: 'utf-8',
    timeout: 30000,
    ...opts,
  }).trim()
}

export function getTeamSyncStatus() {
  if (!existsSync(SYNC_ROOT)) {
    return { available: false, error: `Repo not cloned. Run: git clone <your-team-sync-url> ${SYNC_ROOT}` }
  }
  try {
    const branch = git('rev-parse --abbrev-ref HEAD')
    const sha = git('rev-parse --short HEAD')
    const dirty = git('status --porcelain').length > 0
    const lastCommit = git('log -1 --format=%ci')
    const remote = git('remote get-url origin')

    let behind = 0
    let ahead = 0
    try {
      git('fetch origin --quiet', { timeout: 15000 })
      const counts = git('rev-list --left-right --count HEAD...origin/main')
      const [a, b] = counts.split('\t').map(Number)
      ahead = a
      behind = b
    } catch {}

    const projects = listProjects()

    return {
      available: true,
      branch,
      sha,
      dirty,
      lastCommit,
      remote,
      ahead,
      behind,
      projects,
    }
  } catch (e) {
    return { available: false, error: e.message?.split('\n')[0] || 'Git error' }
  }
}

function listProjects() {
  if (!existsSync(SHARED_MEM)) return []
  return readdirSync(SHARED_MEM)
    .filter(f => {
      const p = join(SHARED_MEM, f)
      return statSync(p).isDirectory() && f !== '.git'
    })
    .map(name => {
      const dir = join(SHARED_MEM, name)
      const files = readdirSync(dir).filter(f => f.endsWith('.md'))
      return { name, fileCount: files.length }
    })
}

export function listSharedMemory(project) {
  const dir = project ? join(SHARED_MEM, project) : SHARED_MEM
  if (!existsSync(dir)) return { files: [], error: 'Directory not found' }

  if (!project) {
    return { projects: listProjects() }
  }

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = readFileSync(join(dir, f), 'utf-8')
      const meta = parseFrontmatter(content)
      return {
        filename: f,
        name: meta.name || f.replace('.md', ''),
        description: meta.description || '',
        type: meta.type || 'project',
        size: content.length,
      }
    })

  return { project, files }
}

export function listSharedSkills() {
  if (!existsSync(SHARED_SKILLS)) return { files: [] }
  const files = readdirSync(SHARED_SKILLS)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = readFileSync(join(SHARED_SKILLS, f), 'utf-8')
      const meta = parseFrontmatter(content)
      return {
        filename: f,
        name: meta.description || f.replace('.md', ''),
        size: content.length,
      }
    })
  return { files }
}

export function readSharedFile(type, project, filename) {
  let filepath
  if (type === 'memory') {
    if (!project || !filename) return { error: 'Project and filename required' }
    filepath = join(SHARED_MEM, project, filename)
  } else if (type === 'skill') {
    if (!filename) return { error: 'Filename required' }
    filepath = join(SHARED_SKILLS, filename)
  } else {
    return { error: 'Type must be "memory" or "skill"' }
  }

  if (filepath.includes('..')) return { error: 'Invalid path' }
  if (!existsSync(filepath)) return { error: 'File not found' }

  return { content: readFileSync(filepath, 'utf-8'), filename }
}

export function writeSharedFile(type, project, filename, content) {
  if (!filename || !content) return { error: 'Filename and content required' }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return { error: 'Invalid filename' }

  let dir
  if (type === 'memory') {
    if (!project) return { error: 'Project required for memory files' }
    if (project.includes('..')) return { error: 'Invalid project name' }
    dir = join(SHARED_MEM, project)
  } else if (type === 'skill') {
    dir = SHARED_SKILLS
  } else {
    return { error: 'Type must be "memory" or "skill"' }
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, filename), content, 'utf-8')
  return { ok: true, path: join(dir, filename) }
}

export function pullFromRemote() {
  if (!existsSync(SYNC_ROOT)) return { error: 'Repo not cloned' }
  try {
    const output = git('pull origin main')
    return { ok: true, output }
  } catch (e) {
    return { error: 'Pull failed: ' + (e.message?.split('\n')[0] || 'unknown error') }
  }
}

export function pushToRemote() {
  if (!existsSync(SYNC_ROOT)) return { error: 'Repo not cloned' }
  try {
    const dirty = git('status --porcelain')
    if (dirty.length > 0) {
      git('add -A')
      git('commit -m "sync: update shared memory and skills from Mission Control"')
    }
    const output = git('push origin main')
    return { ok: true, output: output || 'Pushed successfully' }
  } catch (e) {
    return { error: 'Push failed: ' + (e.message?.split('\n')[0] || 'unknown error') }
  }
}

export function syncFile(direction, type, project, filename) {
  if (!filename) return { error: 'Filename required' }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return { error: 'Invalid filename' }

  let localDir, sharedDir
  if (type === 'memory') {
    if (!project) return { error: 'Project required for memory' }
    localDir = LOCAL_MEM
    sharedDir = join(SHARED_MEM, project)
  } else if (type === 'skill') {
    localDir = LOCAL_SKILLS
    sharedDir = SHARED_SKILLS
  } else {
    return { error: 'Type must be "memory" or "skill"' }
  }

  if (direction === 'to-shared') {
    const src = join(localDir, filename)
    if (!existsSync(src)) return { error: `Local file not found: ${filename}` }
    if (!existsSync(sharedDir)) mkdirSync(sharedDir, { recursive: true })
    copyFileSync(src, join(sharedDir, filename))
    return { ok: true, direction, filename, from: 'local', to: 'shared' }
  } else if (direction === 'to-local') {
    const src = join(sharedDir, filename)
    if (!existsSync(src)) return { error: `Shared file not found: ${filename}` }
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true })
    copyFileSync(src, join(localDir, filename))
    return { ok: true, direction, filename, from: 'shared', to: 'local' }
  }
  return { error: 'Direction must be "to-shared" or "to-local"' }
}

export function createProject(name) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return { error: 'Invalid project name' }
  }
  const dir = join(SHARED_MEM, name)
  if (existsSync(dir)) return { error: `Project "${name}" already exists` }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.gitkeep'), '', 'utf-8')
  return { ok: true, name, path: dir }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const meta = {}
  for (const line of match[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) {
      meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
    }
  }
  return meta
}
