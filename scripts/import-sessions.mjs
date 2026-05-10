import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const REST_URL = 'http://localhost:3111'

async function importFile(fp, project) {
  const raw = readFileSync(fp, 'utf-8')
  const lines = raw.split('\n').filter(l => l.trim())
  if (lines.length === 0) return { ok: false, reason: 'empty' }

  const sessionId = fp.replace(/.*[/\\]/, '').replace('.jsonl', '')

  try {
    const res = await fetch(`${REST_URL}/agentmemory/replay/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        project,
        lines: lines.slice(0, 500),
      }),
    })
    if (res.ok) return { ok: true }
    const text = await res.text()
    return { ok: false, reason: `${res.status}: ${text.slice(0, 100)}` }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

async function main() {
  let ok = 0, fail = 0, skip = 0

  for (const slug of readdirSync(PROJECTS_DIR)) {
    const slugDir = join(PROJECTS_DIR, slug)
    let entries
    try { entries = readdirSync(slugDir) } catch { continue }

    const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'))
    for (const f of jsonlFiles) {
      const fp = join(slugDir, f)
      const size = statSync(fp).size
      if (size > 10_000_000) { skip++; continue }

      const result = await importFile(fp, slug)
      if (result.ok) {
        ok++
        process.stdout.write(`  [${ok}] ${slug}/${f}\n`)
      } else {
        fail++
        process.stderr.write(`  FAIL ${slug}/${f}: ${result.reason}\n`)
      }
    }
  }

  console.log(`\nImport complete: ${ok} ok, ${fail} failed, ${skip} skipped (>10MB)`)
}

main().catch(e => { console.error(e); process.exit(1) })
