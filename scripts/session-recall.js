#!/usr/bin/env node
/**
 * session-recall.js — SessionStart hook (v2)
 *
 * Flow:
 * 1. Detect project from CWD
 * 2. Check QMD availability (http://localhost:8181/health)
 * 3. If QMD available:
 *    - Query 'lessons learned corrections' (collection: <project>, limit: 5)
 *    - Query 'feedback corrections' (collection: sessions, limit: 3)
 * 4. Fallback: read <project>/.claude/rules/lessons-learned.md directly
 * 5. Inject as additionalContext (max 2000 chars)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CLAUDE_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.claude');

// ─── Project detection ────────────────────────────────────────────────────────

// Map cwd substring -> project metadata. Add an entry per project you want
// the recall hook to detect. `rulesDir` is the path to the project's
// `.claude/rules` directory; `qmd` is the QMD collection name to query.
// Example:
//   { key: 'my-app', id: 'my-app',
//     rulesDir: path.join(HOME, 'Projects', 'my-app', '.claude', 'rules'),
//     qmd: 'my-app' },
const PROJECT_MAP = [];

function detectProject() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return PROJECT_MAP.find(p => cwd.includes(p.key)) || {
    id: 'global',
    rulesDir: path.join(CLAUDE_DIR, 'rules', 'common'),
    qmd: 'claude-rules'
  };
}

// ─── QMD ─────────────────────────────────────────────────────────────────────

function qmdAvailable() {
  try {
    execSync('curl -s http://localhost:8181/health --max-time 1 --silent', { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function qmdQuery(query, collection, limit = 5) {
  try {
    const result = execSync(
      `qmd query "${query.replace(/"/g, '\\"')}" --collection ${collection} -n ${limit} --json`,
      { encoding: 'utf8', timeout: 8000 }
    );
    return JSON.parse(result);
  } catch { return null; }
}

// ─── Context building ─────────────────────────────────────────────────────────

function buildContextFromQmd(project) {
  const parts = [];

  // Query project collection for rules/lessons
  const projectResults = qmdQuery('lessons learned corrections rules', project.qmd, 5);
  if (projectResults?.results?.length > 0) {
    parts.push(`## Project Rules (${project.id})`);
    for (const r of projectResults.results.slice(0, 5)) {
      if (r.content) parts.push(r.content.substring(0, 400));
    }
  }

  // Query sessions for recent corrections/feedback
  const sessionResults = qmdQuery('user corrected Claude feedback omdat because', 'sessions', 3);
  if (sessionResults?.results?.length > 0) {
    parts.push('\n## Recent Corrections');
    for (const r of sessionResults.results.slice(0, 3)) {
      if (r.content) parts.push(r.content.substring(0, 300));
    }
  }

  return parts.join('\n\n').substring(0, 2000);
}

function buildContextFromFiles(project) {
  const parts = [];
  const files = ['lessons-learned.md', 'platform-context.md'];

  for (const file of files) {
    const filePath = path.join(project.rulesDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content.length > 20) parts.push(content.substring(0, 800));
    }
  }

  return parts.join('\n\n').substring(0, 2000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const project = detectProject();

  let context = '';

  if (qmdAvailable()) {
    context = buildContextFromQmd(project);
  }

  // Fallback to direct file read if QMD returned nothing
  if (!context || context.length < 50) {
    context = buildContextFromFiles(project);
  }

  if (!context || context.length < 20) {
    process.exit(0);
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[session-recall: ${project.id}]\n\n${context}`
    }
  };

  process.stdout.write(JSON.stringify(output));
}

try {
  main();
} catch (e) {
  // Never block Claude Code
  process.exit(0);
}
