import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

const OPENCLAW_DIR = join(homedir(), 'Downloads', 'openclaw-features')
const MANIFEST_PATH = join(OPENCLAW_DIR, 'modules.json')
const SRC_DIR = join(OPENCLAW_DIR, 'src')

let manifestCache = null
let manifestCacheAt = 0
const CACHE_TTL = 30_000

function loadManifest() {
  const now = Date.now()
  if (manifestCache && now - manifestCacheAt < CACHE_TTL) return manifestCache
  if (!existsSync(MANIFEST_PATH)) return null
  try {
    manifestCache = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
    manifestCacheAt = now
    return manifestCache
  } catch { return null }
}

function getSourceStats(entrypoint) {
  const fp = join(SRC_DIR, entrypoint)
  if (!existsSync(fp)) return null
  const stat = statSync(fp)
  const content = readFileSync(fp, 'utf-8')
  const lines = content.split('\n').length
  const exportCount = (content.match(/^export /gm) || []).length
  return { lines, exportCount, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() }
}

export function getModules() {
  const manifest = loadManifest()
  if (!manifest) return { modules: [], categories: {}, available: false, path: OPENCLAW_DIR }

  const enriched = manifest.modules.map(mod => {
    const stats = getSourceStats(mod.entrypoint)
    return { ...mod, source: stats }
  })

  return {
    modules: enriched,
    categories: manifest.categories,
    available: true,
    path: OPENCLAW_DIR,
    version: manifest.version,
  }
}

export function getModuleSource(moduleId) {
  const manifest = loadManifest()
  if (!manifest) return null

  const mod = manifest.modules.find(m => m.id === moduleId)
  if (!mod) return null

  const fp = join(SRC_DIR, mod.entrypoint)
  if (!existsSync(fp)) return null

  const content = readFileSync(fp, 'utf-8')
  const dir = join(SRC_DIR, mod.entrypoint.split('/')[0])
  const files = []

  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue
      const fpath = join(dir, f)
      const stat = statSync(fpath)
      files.push({
        filename: f,
        sizeBytes: stat.size,
        lines: readFileSync(fpath, 'utf-8').split('\n').length,
      })
    }
  }

  return { ...mod, content, files }
}

export function getModuleCategories() {
  const manifest = loadManifest()
  if (!manifest) return {}
  return manifest.categories
}
