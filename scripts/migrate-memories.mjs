import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'

const REST_URL = 'http://localhost:3111'
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: content }
  const meta = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/)
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return { meta, body: match[2].trim() }
}

function projectFromSlug(slug) {
  const parts = slug.split('-')
  // Filter out common path noise (drive letter, user dir, sync provider names).
  // Add anything specific to your environment here.
  const meaningful = parts.filter(p => !['C', 'Users', '.claude', 'projects', 'Downloads', 'OneDrive'].includes(p))
  return meaningful.join('-') || slug
}

async function remember(content, type, concepts, metadata) {
  const res = await fetch(`${REST_URL}/agentmemory/remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type: type || 'project', concepts, metadata }),
  })
  return res.ok
}

async function migrateMemoryFiles() {
  let ok = 0, fail = 0

  for (const slug of readdirSync(PROJECTS_DIR)) {
    const memDir = join(PROJECTS_DIR, slug, 'memory')
    if (!existsSync(memDir)) continue

    const project = projectFromSlug(slug)
    let files
    try { files = readdirSync(memDir) } catch { continue }

    for (const f of files) {
      if (!f.endsWith('.md') || f === 'MEMORY.md' || f === 'last_dream.md') continue
      const fp = join(memDir, f)
      try {
        const raw = readFileSync(fp, 'utf-8')
        const { meta, body } = parseFrontmatter(raw)
        if (!body || body.length < 10) continue

        const concepts = [project, meta.type || 'unknown'].filter(Boolean)
        if (meta.name) concepts.push(meta.name)

        const success = await remember(body, meta.type || 'project', concepts, {
          source: 'migration',
          originalPath: fp,
          name: meta.name || basename(f, '.md'),
          description: meta.description || '',
          project,
        })

        if (success) {
          ok++
          process.stdout.write(`  [${ok}] ${project}/${f}\n`)
        } else {
          fail++
          process.stderr.write(`  FAIL ${project}/${f}\n`)
        }
      } catch (e) {
        fail++
        process.stderr.write(`  ERROR ${f}: ${e.message}\n`)
      }
    }
  }
  return { ok, fail }
}

async function migrateCLAUDEmd() {
  // Add the absolute paths of any CLAUDE.md files you want to migrate into agentmemory.
  // Example: join(homedir(), 'Projects', 'my-app', 'CLAUDE.md')
  const claudeMdPaths = []

  let ok = 0, fail = 0
  for (const fp of claudeMdPaths) {
    if (!existsSync(fp)) continue
    try {
      const content = readFileSync(fp, 'utf-8')
      const projectName = basename(dirname(fp))
      const success = await remember(
        content.slice(0, 8000),
        'project',
        [projectName, 'claude-md'],
        { source: 'claude-md-migration', originalPath: fp, name: `CLAUDE.md - ${projectName}` }
      )
      if (success) { ok++; console.log(`  CLAUDE.md: ${projectName}`) }
      else { fail++ }
    } catch (e) {
      fail++
      process.stderr.write(`  ERROR CLAUDE.md ${fp}: ${e.message}\n`)
    }
  }
  return { ok, fail }
}

async function main() {
  console.log('Migrating memory files to agentmemory...\n')

  const healthRes = await fetch(`${REST_URL}/agentmemory/health`).catch(() => null)
  if (!healthRes || !healthRes.ok) {
    console.error('agentmemory not running at', REST_URL)
    process.exit(1)
  }

  console.log('--- Memory files ---')
  const mem = await migrateMemoryFiles()

  console.log('\n--- CLAUDE.md files ---')
  const claude = await migrateCLAUDEmd()

  console.log(`\nMigration complete:`)
  console.log(`  Memory files: ${mem.ok} ok, ${mem.fail} failed`)
  console.log(`  CLAUDE.md:    ${claude.ok} ok, ${claude.fail} failed`)
  console.log(`  Total:        ${mem.ok + claude.ok} memories stored`)
}

main().catch(e => { console.error(e); process.exit(1) })
