#!/usr/bin/env node
/**
 * migrate-to-agentmemory.mjs
 *
 * Migrates all Claude Code memory files and CLAUDE.md files into
 * agentmemory's REST API at http://localhost:3111.
 *
 * Usage:
 *   node migrate-to-agentmemory.mjs           # live run
 *   node migrate-to-agentmemory.mjs --dry-run # preview without writing
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const DRY_RUN = process.argv.includes('--dry-run');
const BASE_URL = 'http://localhost:3111';
const REMEMBER_URL = `${BASE_URL}/agentmemory/remember`;
const SEARCH_URL = `${BASE_URL}/agentmemory/search`;
const MEMORIES_URL = `${BASE_URL}/agentmemory/memories`;

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

// Add absolute paths to project-level CLAUDE.md files you want to migrate
// into agentmemory. Example:
//   path.join(os.homedir(), 'Projects', 'my-app', 'CLAUDE.md'),
const CLAUDE_MD_PATHS = [];

// Files to skip - logs directories and files with no meaningful content
const SKIP_PATTERNS = [
  /[/\\]logs[/\\]/,
  /precompact_snapshot\.md$/,
];

// Memory types valid in agentmemory. Map from our types to accepted values.
const TYPE_MAP = {
  user: 'preference',
  feedback: 'preference',
  project: 'fact',
  reference: 'fact',
};

// Fallback type for files without frontmatter or unknown type values
const DEFAULT_TYPE = 'fact';

let stats = {
  total: 0,
  succeeded: 0,
  skipped: 0,
  failed: 0,
  alreadyExists: 0,
};

// --------------------------------------------------------------------------
// Frontmatter parser
// --------------------------------------------------------------------------

function parseFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { frontmatter: {}, body: raw.trim() };
  }

  const closeIndex = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIndex === -1) {
    return { frontmatter: {}, body: raw.trim() };
  }

  const yamlLines = lines.slice(1, closeIndex);
  const body = lines.slice(closeIndex + 1).join('\n').trim();

  const frontmatter = {};
  for (const line of yamlLines) {
    const colonPos = line.indexOf(':');
    if (colonPos === -1) continue;
    const key = line.slice(0, colonPos).trim();
    const value = line.slice(colonPos + 1).trim().replace(/^["']|["']$/g, '');
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// --------------------------------------------------------------------------
// API helpers
// --------------------------------------------------------------------------

async function searchByContent(content) {
  // Use the first 120 chars of content as the search query to find duplicates
  const query = content.slice(0, 120);
  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 10 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || [];
    // Check if any result has the same content (memory-level search)
    return results;
  } catch {
    return [];
  }
}

async function getAllMemories() {
  try {
    const res = await fetch(`${MEMORIES_URL}?limit=1000`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.memories || [];
  } catch {
    return [];
  }
}

async function rememberMemory(payload) {
  const res = await fetch(REMEMBER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// --------------------------------------------------------------------------
// File collection
// --------------------------------------------------------------------------

function collectMemoryFiles(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;

  const projectDirs = fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(root, d.name));

  for (const projectDir of projectDirs) {
    const memoryDir = path.join(projectDir, 'memory');
    if (!fs.existsSync(memoryDir)) continue;

    const all = walkDir(memoryDir);
    for (const f of all) {
      if (path.extname(f) !== '.md') continue;
      if (SKIP_PATTERNS.some(p => p.test(f))) continue;
      files.push({ filePath: f, projectDir, source: 'memory' });
    }
  }

  return files;
}

function walkDir(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function collectClaudeMdFiles() {
  return CLAUDE_MD_PATHS
    .filter(p => fs.existsSync(p))
    .map(p => ({ filePath: p, projectDir: path.dirname(p), source: 'claude-md' }));
}

// --------------------------------------------------------------------------
// Derive project name from directory path
// --------------------------------------------------------------------------

function deriveProjectName(filePath, source) {
  if (source === 'claude-md') {
    return path.basename(path.dirname(filePath));
  }
  // Extract from encoded project dir name. Claude Code encodes absolute paths
  // by replacing separators with dashes, e.g.:
  //   C--Users-someone-Projects-my-app  ->  my-app
  //   -Users-someone-Projects-my-app    ->  my-app
  const projectDirName = path.basename(path.dirname(path.dirname(filePath)));
  // Strip leading drive/home path encoding ("C--Users-<name>-" or "-Users-<name>-")
  const cleaned = projectDirName.replace(/^-?[A-Z]?--?Users-[^-]+-/, '');
  if (!cleaned || cleaned === projectDirName) return projectDirName;
  return cleaned || projectDirName;
}

// --------------------------------------------------------------------------
// Build the payload for a single file
// --------------------------------------------------------------------------

function buildPayload(filePath, source, projectDir) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(raw);

  const content = body || raw.trim();
  if (!content) return null;

  const projectName = deriveProjectName(filePath, source);
  const frontmatterType = (frontmatter.type || '').toLowerCase();
  const mappedType = TYPE_MAP[frontmatterType] || DEFAULT_TYPE;

  const concepts = [projectName];
  if (frontmatterType) concepts.push(frontmatterType);

  // Add a source tag so we can distinguish migrated memories
  concepts.push('migration');

  // For CLAUDE.md files, enrich with the "claude-md" concept
  if (source === 'claude-md') concepts.push('claude-md');

  return {
    content,
    type: mappedType,
    concepts: [...new Set(concepts)],
    metadata: {
      source: 'migration',
      originalPath: filePath,
      name: frontmatter.name || path.basename(filePath, '.md'),
      description: frontmatter.description || '',
    },
  };
}

// --------------------------------------------------------------------------
// Idempotency check - use metadata.originalPath stored in memory title/content
// --------------------------------------------------------------------------

function alreadyMigrated(existingMemories, filePath) {
  // We store originalPath in metadata, but the REST API doesn't return metadata.
  // Use content-matching: check if any memory's content starts with the same
  // first 80 chars as the file we're about to insert.
  // This is a best-effort check; the search-based approach below is more reliable.
  return existingMemories.some(m => {
    // The title is set to the first line of content by agentmemory
    // Check if the memory content contains our migration marker and path
    if (m.content && m.content === filePath) return true;
    return false;
  });
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  console.log(`agentmemory migration — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Target: ${BASE_URL}`);
  console.log('');

  // Verify API is reachable
  try {
    await fetch(MEMORIES_URL);
  } catch (err) {
    console.error(`Cannot reach agentmemory at ${BASE_URL}: ${err.message}`);
    process.exit(1);
  }

  // Load all existing memories for idempotency check
  console.log('Loading existing memories for idempotency check...');
  const existingMemories = await getAllMemories();
  console.log(`Found ${existingMemories.length} existing memories in agentmemory.`);

  // Build a set of already-migrated original paths from memory content
  // Since we embed originalPath in metadata (not returned by API), we use content
  // hashing: store a short fingerprint in the concepts list as "path:<hash>"
  // We'll use a simpler approach: search for memories that have concept "migration"
  // and whose content first-line matches our file's first content line.
  const migratedFingerprints = new Set(
    existingMemories
      .filter(m => m.concepts && m.concepts.includes('migration'))
      .map(m => (m.content || '').slice(0, 80))
  );

  console.log(`${migratedFingerprints.size} previously migrated memory fingerprints found.`);
  console.log('');

  // Collect all files
  const memoryFiles = collectMemoryFiles(PROJECTS_ROOT);
  const claudeMdFiles = collectClaudeMdFiles();
  const allFiles = [...memoryFiles, ...claudeMdFiles];

  console.log(`Files to process: ${allFiles.length} (${memoryFiles.length} memory files + ${claudeMdFiles.length} CLAUDE.md files)`);
  console.log('');

  // Process each file
  for (const { filePath, projectDir, source } of allFiles) {
    stats.total++;

    const shortPath = filePath.replace(os.homedir(), '~');

    let payload;
    try {
      payload = buildPayload(filePath, source, projectDir);
    } catch (err) {
      console.error(`  FAIL  ${shortPath}`);
      console.error(`        Read/parse error: ${err.message}`);
      stats.failed++;
      continue;
    }

    if (!payload) {
      console.log(`  SKIP  ${shortPath} (empty content)`);
      stats.skipped++;
      continue;
    }

    // Idempotency: check fingerprint of first 80 chars of content
    const fingerprint = payload.content.slice(0, 80);
    if (migratedFingerprints.has(fingerprint)) {
      console.log(`  EXIST ${shortPath}`);
      stats.alreadyExists++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  DRY   ${shortPath}`);
      console.log(`        type=${payload.type} concepts=[${payload.concepts.join(', ')}]`);
      console.log(`        content preview: ${payload.content.slice(0, 60).replace(/\n/g, ' ')}...`);
      stats.succeeded++;
      continue;
    }

    try {
      await rememberMemory(payload);
      console.log(`  OK    ${shortPath}`);
      stats.succeeded++;
      // Add to fingerprint cache so we don't double-insert in this run
      migratedFingerprints.add(fingerprint);
    } catch (err) {
      console.error(`  FAIL  ${shortPath}`);
      console.error(`        ${err.message}`);
      stats.failed++;
    }
  }

  // Summary
  console.log('');
  console.log('─'.repeat(50));
  console.log('Migration complete');
  console.log(`  Total files scanned : ${stats.total}`);
  console.log(`  Inserted            : ${stats.succeeded}`);
  console.log(`  Already existed     : ${stats.alreadyExists}`);
  console.log(`  Skipped (empty)     : ${stats.skipped}`);
  console.log(`  Failed              : ${stats.failed}`);
  if (DRY_RUN) {
    console.log('');
    console.log('DRY RUN — no data was written. Re-run without --dry-run to migrate.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
