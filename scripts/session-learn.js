#!/usr/bin/env node
/**
 * session-learn.js — SessionEnd hook (v2)
 *
 * Flow:
 * 1. Convert transcript JSONL → markdown → ~/.claude/qmd-sessions/<id>.md
 * 2. Update QMD sessions collection index
 * 3. Query QMD semantically for correction+reasoning pairs in this session
 * 4. OpenAI gpt-4o: propose changes as structured JSON (call 1)
 * 5. OpenAI gpt-4o: validate proposals strictly (call 2, separate system prompt)
 * 6. Write only APPROVED changes to <project>/.claude/rules/lessons-learned.md
 * 7. Log everything to consolidation-v2.log
 *
 * Validation gate: NO fail-open. Every error path returns [] (zero approvals).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CLAUDE_DIR   = path.join(process.env.USERPROFILE || process.env.HOME, '.claude');
// Claude Code stores per-project transcripts under ~/.claude/projects/<slug>/.
// Override PROJECTS_DIR via env var if your slug differs; otherwise the script
// walks every project directory it finds.
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(CLAUDE_DIR, 'projects');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'qmd-sessions');
const LOG_FILE     = path.join(CLAUDE_DIR, 'scripts', 'consolidation-v2.log');

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${ts}  ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

// ─── Project detection ────────────────────────────────────────────────────────

// Map cwd substring -> project metadata (rules dir + QMD collection name).
// See scripts/session-recall.js for the structure. Empty by default.
const PROJECT_MAP = [];

function detectProject() {
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return PROJECT_MAP.find(p => cwd.includes(p.key)) || { id: 'global', rulesDir: path.join(CLAUDE_DIR, 'rules', 'common'), qmd: 'claude-rules' };
}

// ─── Transcript → Markdown conversion ────────────────────────────────────────

function findTranscript(sessionId) {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  const files = fs.readdirSync(PROJECTS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ fp: path.join(PROJECTS_DIR, f), name: f, mtime: fs.statSync(path.join(PROJECTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (sessionId) {
    const match = files.find(f => f.name.includes(sessionId));
    if (match) return match.fp;
  }
  return files.length > 0 ? files[0].fp : null;
}

function transcriptToMarkdown(filePath, sessionId) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  const turns = [];

  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.type === 'user' && e.message?.content) {
        const text = typeof e.message.content === 'string'
          ? e.message.content
          : e.message.content.map(c => c.text || '').join(' ');
        if (text.trim().length > 5) turns.push({ role: 'user', text: text.trim().substring(0, 2000) });
      } else if (e.type === 'assistant' && e.message?.content) {
        const items = Array.isArray(e.message.content) ? e.message.content : [e.message.content];
        const text = items.map(i => typeof i === 'string' ? i : i.text || '').join(' ').trim();
        if (text.length > 10) turns.push({ role: 'assistant', text: text.substring(0, 2000) });
      }
    } catch { /* skip */ }
  }

  if (turns.length === 0) return null;

  const lines_md = [
    `# Session ${sessionId || path.basename(filePath, '.jsonl')}`,
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Turns: ${turns.length}`,
    '',
  ];

  for (const turn of turns) {
    lines_md.push(`## ${turn.role === 'user' ? 'User' : 'Claude'}`);
    lines_md.push(turn.text);
    lines_md.push('');
  }

  return lines_md.join('\n');
}

// ─── QMD query via HTTP MCP ───────────────────────────────────────────────────

function qmdAvailable() {
  try {
    execSync('curl -s http://localhost:8181/health --max-time 1 --silent', { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function qmdQuery(query, collection, limit = 10) {
  if (!qmdAvailable()) return null;
  try {
    const result = execSync(
      `qmd query "${query.replace(/"/g, '\\"')}" ${collection ? `--collection ${collection}` : ''} -n ${limit} --json`,
      { encoding: 'utf8', timeout: 10000 }
    );
    return JSON.parse(result);
  } catch { return null; }
}

// ─── OpenAI API ───────────────────────────────────────────────────────────────

function resolveApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  // Add fallback .env file paths here if you want the hook to load the key
  // from a per-project file when the env var is not set.
  const envPaths = [];
  for (const p of envPaths) {
    try {
      const vars = Object.fromEntries(
        fs.readFileSync(p, 'utf8').split('\n')
          .filter(l => l.includes('=') && !l.startsWith('#'))
          .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
      );
      if (vars.OPENAI_API_KEY) return vars.OPENAI_API_KEY;
    } catch { /* try next */ }
  }
  return null;
}

function openaiCall(apiKey, systemPrompt, userContent) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices?.[0]?.message?.content || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(45000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ─── Propose changes (OpenAI call 1) ──────────────────────────────────────────

const PROPOSE_PROMPT = `You are a memory writer for a Claude Code AI assistant.
Given user corrections from a session, propose changes to the project's lessons-learned.md rule file.

Rules for proposals:
- Only propose if the user gave explicit reasoning ("omdat", "because", "want", "since", "reden")
- One rule per correction, max
- Format: "**[Rule]**: [what to do]. Reden: [why — one sentence, max 120 chars]."
- Do not duplicate existing rules (check the current file content provided)
- Prefer Dutch or English matching the correction's language
- If no explicit reasoning was provided, output []

Output ONLY a JSON array, no prose:
[{ "action": "add", "entry": "**Rule**: ...", "source": "correction [N]" }]
If nothing qualifies: []`;

// ─── Validate proposals (OpenAI call 2) ────────────────────────────────────────

const VALIDATE_PROMPT = `You are a strict memory quality reviewer for an AI coding assistant.
Your job: validate whether proposed rule changes are worth keeping permanently.

REJECT if ANY of these apply:
- Vague or not actionable ("be careful", "check things", "verify output")
- Already covered by an existing rule in the current file (even if differently worded)
- Based on a one-time mistake that won't recur
- The reasoning was INFERRED by the proposer, not explicitly stated by the user
- The rule applies only to a specific task/file, not to future sessions generally

APPROVE only if ALL of these are true:
- User explicitly stated reasoning (search for "omdat", "because", "want", "reden", "since")
- Directly prevents a concrete repeatable mistake
- Actionable without additional context

Output ONLY a JSON array. NEVER auto-approve. If uncertain: REJECT.
[{ "action": "add", "entry": "...", "source": "...", "decision": "APPROVE|REJECT", "reason": "one sentence" }]`;

// ─── Strict validation (NO fail-open) ─────────────────────────────────────────

async function validateProposals(apiKey, proposals, corrections, currentRules) {
  if (!apiKey) {
    log('REJECT ALL: no API key');
    return [];
  }

  const userContent = JSON.stringify({
    proposals,
    originalCorrections: corrections.slice(0, 10),
    currentLessonsLearned: currentRules.substring(0, 2000)
  }, null, 2);

  let response;
  try {
    response = await openaiCall(apiKey, VALIDATE_PROMPT, userContent);
  } catch (e) {
    log(`REJECT ALL: validation API error: ${e.message}`);
    return [];
  }

  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    log('REJECT ALL: validator returned no JSON array');
    return [];
  }

  try {
    const validated = JSON.parse(jsonMatch[0]);
    return validated.filter(v => v.decision === 'APPROVE');
  } catch {
    log('REJECT ALL: validator JSON parse failed');
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let input = '';
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = Buffer.concat(chunks).toString('utf8');
  } catch { /* stdin unavailable */ }

  let sessionInfo = {};
  try { sessionInfo = JSON.parse(input); } catch { /* ok */ }
  const sessionId = sessionInfo.session_id;

  log(`=== session-learn START (session: ${sessionId || 'unknown'}) ===`);

  const project = detectProject();
  log(`Project: ${project.id}`);

  // 1. Find transcript
  const transcriptPath = findTranscript(sessionId);
  if (!transcriptPath) {
    log('No transcript found — done.');
    return;
  }
  log(`Transcript: ${path.basename(transcriptPath)}`);

  // 2. Convert to markdown + write to qmd-sessions
  const md = transcriptToMarkdown(transcriptPath, sessionId);
  if (!md) {
    log('Transcript empty after conversion — done.');
    return;
  }

  const mdFileName = `${sessionId || path.basename(transcriptPath, '.jsonl')}.md`;
  const mdPath = path.join(SESSIONS_DIR, mdFileName);
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(mdPath, md, 'utf8');
  log(`Converted: ${mdFileName} (${md.length} chars)`);

  // 3. Update QMD sessions collection
  try {
    execSync('qmd collection update sessions', { encoding: 'utf8', timeout: 30000 });
    log('QMD sessions collection updated');
  } catch (e) {
    log(`QMD update failed (non-fatal): ${e.message}`);
  }

  // 4. Query QMD for corrections in this session
  const corrections = [];
  const queries = [
    'user corrected Claude wrong approach',
    'nee doe niet verkeerd gebruik',
    'because want omdat reden explanation',
  ];

  for (const q of queries) {
    const results = qmdQuery(q, 'sessions', 8);
    if (results?.results) {
      for (const r of results.results) {
        // Only include hits from this session
        if (r.file && r.file.includes(sessionId || '')) {
          corrections.push({ query: q, passage: r.content?.substring(0, 600), score: r.score });
        }
      }
    }
  }

  log(`QMD corrections found: ${corrections.length}`);

  if (corrections.length === 0) {
    log('No corrections found — done.');
    return;
  }

  // 5. Read current project rules
  const rulesFile = path.join(project.rulesDir, 'lessons-learned.md');
  const currentRules = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, 'utf8') : '# Lessons Learned\n\n';

  // 6. Propose changes
  const apiKey = resolveApiKey();
  if (!apiKey) {
    log('SKIP: no OpenAI API key');
    return;
  }

  let proposals;
  try {
    const proposeContent = JSON.stringify({ corrections, currentLessonsLearned: currentRules.substring(0, 2000) }, null, 2);
    const proposeResponse = await openaiCall(apiKey, PROPOSE_PROMPT, proposeContent);
    const jsonMatch = proposeResponse.match(/\[[\s\S]*\]/);
    proposals = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (e) {
    log(`Propose error: ${e.message} — done.`);
    return;
  }

  log(`Proposals from gpt-4o: ${proposals.length}`);
  if (proposals.length === 0) {
    log('No proposals generated — done.');
    return;
  }

  // 7. Validate (strict, no fail-open)
  const approved = await validateProposals(apiKey, proposals, corrections, currentRules);
  const rejected = proposals.length - approved.length;
  log(`Validation: ${approved.length} approved, ${rejected} rejected`);

  for (const p of proposals.filter(p => !approved.some(a => a.entry === p.entry))) {
    log(`  REJECTED: ${p.entry?.substring(0, 80)}`);
  }

  if (approved.length === 0) {
    log('Nothing approved — done.');
    return;
  }

  // 8. Write approved entries
  let updated = currentRules.trimEnd();
  for (const change of approved) {
    updated += '\n- ' + change.entry;
    log(`  WRITTEN: ${change.entry?.substring(0, 100)}`);
  }
  updated += '\n';

  fs.mkdirSync(project.rulesDir, { recursive: true });
  fs.writeFileSync(rulesFile, updated, 'utf8');
  log(`Updated ${rulesFile}`);

  log(`=== session-learn DONE (${approved.length} rules written) ===`);

  // Output summary to Claude Code
  process.stdout.write(JSON.stringify({
    systemMessage: `session-learn [${project.id}]: ${corrections.length} corrections → ${proposals.length} proposed → ${approved.length} approved, ${rejected} rejected`
  }));
}

main().catch(e => {
  log(`FATAL: ${e.message}\n${e.stack}`);
  process.exit(0); // never block Claude Code
});
