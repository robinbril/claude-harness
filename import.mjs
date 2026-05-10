#!/usr/bin/env node
/**
 * import.mjs
 * Installs the claude-harness-export into a fresh Claude Code setup.
 * Run from the export directory: node import.mjs [--dry-run] [--skip-deps]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_DEPS = args.includes('--skip-deps');

// ---------------------------------------------------------------------------
// Terminal colors
// ---------------------------------------------------------------------------
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function ok(msg) { console.log(`  ${c.green('+')} ${msg}`); }
function skip(msg) { console.log(`  ${c.yellow('~')} ${msg}`); }
function err(msg) { console.log(`  ${c.red('!')} ${msg}`); }
function info(msg) { console.log(`  ${c.cyan('i')} ${msg}`); }
function section(msg) { console.log(`\n${c.bold(msg)}`); }

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
// Use forward slashes everywhere - Claude Code expects them
const HOME_FWD = HOME.replace(/\\/g, '/');
const CLAUDE_DIR = path.join(HOME, '.claude');

function fwd(p) {
  return p.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(dirPath) {
  if (DRY_RUN) {
    info(`[dry] mkdir -p ${fwd(dirPath)}`);
    return;
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  if (DRY_RUN) {
    info(`[dry] copy ${fwd(src)} -> ${fwd(dest)}`);
    return;
  }
  fs.copyFileSync(src, dest);
}

/**
 * Recursively copy all files from srcDir into destDir.
 * Returns { copied, skipped } counts.
 */
function copyDir(srcDir, destDir) {
  let copied = 0;
  let skipped = 0;

  if (!fs.existsSync(srcDir)) {
    skip(`Source not found, skipping: ${fwd(srcDir)}`);
    return { copied, skipped };
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      const sub = copyDir(srcPath, destPath);
      copied += sub.copied;
      skipped += sub.skipped;
    } else {
      const exists = fs.existsSync(destPath);
      copyFile(srcPath, destPath);
      if (exists) {
        skip(`Updated: ${fwd(destPath)}`);
        skipped++;
      } else {
        ok(`Copied: ${fwd(destPath)}`);
        copied++;
      }
    }
  }
  return { copied, skipped };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    err(`Failed to parse ${fwd(filePath)}: ${e.message}`);
    return null;
  }
}

function writeJson(filePath, data) {
  if (DRY_RUN) {
    info(`[dry] write JSON: ${fwd(filePath)}`);
    return;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Deep merge: arrays from incoming are appended (deduped by JSON equality).
 * Objects are merged recursively. Scalars from incoming win.
 */
function deepMerge(base, incoming) {
  if (incoming === null || incoming === undefined) return base;
  if (base === null || base === undefined) return incoming;
  if (Array.isArray(base) && Array.isArray(incoming)) {
    const merged = [...base];
    for (const item of incoming) {
      const itemStr = JSON.stringify(item);
      if (!merged.some((e) => JSON.stringify(e) === itemStr)) {
        merged.push(item);
      }
    }
    return merged;
  }
  if (typeof base === 'object' && typeof incoming === 'object') {
    const result = { ...base };
    for (const key of Object.keys(incoming)) {
      result[key] = deepMerge(base[key], incoming[key]);
    }
    return result;
  }
  return incoming;
}

function getNpmGlobalPath() {
  try {
    const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true });
    if (result.status === 0) {
      return result.stdout.trim().replace(/\\/g, '/');
    }
  } catch (_) {}
  // Fallback per-platform
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
    return fwd(path.join(appData, 'npm', 'node_modules'));
  }
  return fwd(path.join(HOME, '.npm-global', 'lib', 'node_modules'));
}

function runCommand(cmd, opts = {}) {
  if (DRY_RUN) {
    info(`[dry] ${cmd}`);
    return true;
  }
  try {
    execSync(cmd, { stdio: 'inherit', shell: true, ...opts });
    return true;
  } catch (e) {
    err(`Command failed: ${cmd}`);
    if (e.message) err(e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Step tracking
// ---------------------------------------------------------------------------
const results = [];
function record(label, status, detail = '') {
  results.push({ label, status, detail });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(c.bold('\nclaude-harness import'));
  console.log(c.dim(`Source: ${fwd(SCRIPT_DIR)}`));
  console.log(c.dim(`Target: ${fwd(CLAUDE_DIR)}`));
  if (DRY_RUN) console.log(c.yellow('  [DRY RUN - no files will be written]'));
  if (SKIP_DEPS) console.log(c.yellow('  [--skip-deps - npm installs will be skipped]'));

  // -------------------------------------------------------------------------
  // 1. Verify Claude Code is installed
  // -------------------------------------------------------------------------
  section('1. Verifying Claude Code installation');
  try {
    // shell: false avoids the Node.js DEP0190 warning about shell + args
    const result = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: false });
    // On Windows 'claude' might only be resolvable via shell; retry with shell if needed
    const finalResult = (result.error && process.platform === 'win32')
      ? spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true })
      : result;
    if (finalResult.status === 0) {
      ok(`Claude Code found: ${finalResult.stdout.trim()}`);
      record('Claude Code check', 'ok', finalResult.stdout.trim());
    } else {
      err('claude --version returned non-zero. Install Claude Code before running this script.');
      err('See: https://docs.anthropic.com/claude-code');
      record('Claude Code check', 'error', 'not installed or not in PATH');
      // Non-fatal - allow install to continue so files are ready when claude is installed
    }
  } catch (e) {
    err(`Could not run claude: ${e.message}`);
    record('Claude Code check', 'warn', 'could not verify');
  }

  // -------------------------------------------------------------------------
  // 2. Create base directory
  // -------------------------------------------------------------------------
  section('2. Creating ~/.claude directory');
  try {
    ensureDir(CLAUDE_DIR);
    ok(fwd(CLAUDE_DIR));
    record('Create ~/.claude', 'ok');
  } catch (e) {
    err(`Failed to create ${fwd(CLAUDE_DIR)}: ${e.message}`);
    record('Create ~/.claude', 'error', e.message);
  }

  // -------------------------------------------------------------------------
  // 3. Copy directory trees
  // -------------------------------------------------------------------------
  section('3. Copying files');

  const dirMappings = [
    { src: 'rules',          dest: path.join(CLAUDE_DIR, 'rules') },
    { src: 'commands',       dest: path.join(CLAUDE_DIR, 'commands') },
    { src: 'skills',         dest: path.join(CLAUDE_DIR, 'skills') },
    { src: 'agents',         dest: path.join(CLAUDE_DIR, 'agents') },
    { src: 'scripts',        dest: path.join(CLAUDE_DIR, 'scripts') },
    { src: 'session-browser',dest: path.join(CLAUDE_DIR, 'scripts', 'session-browser') },
  ];

  for (const { src, dest } of dirMappings) {
    const srcPath = path.join(SCRIPT_DIR, src);
    if (!fs.existsSync(srcPath) || fs.readdirSync(srcPath).length === 0) {
      skip(`Empty or missing: ${src}/ (skipped)`);
      record(`Copy ${src}/`, 'skip', 'empty or missing');
      continue;
    }
    try {
      const { copied, skipped } = copyDir(srcPath, dest);
      ok(`${src}/ -> ${fwd(dest)} (${copied} copied, ${skipped} updated)`);
      record(`Copy ${src}/`, 'ok', `${copied} copied, ${skipped} updated`);
    } catch (e) {
      err(`Failed to copy ${src}/: ${e.message}`);
      record(`Copy ${src}/`, 'error', e.message);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Handle config/settings.json
  // -------------------------------------------------------------------------
  section('4. Installing settings.json');
  try {
    const templatePath = path.join(SCRIPT_DIR, 'config', 'settings.json');
    const destPath = path.join(CLAUDE_DIR, 'settings.json');

    if (!fs.existsSync(templatePath)) {
      skip('config/settings.json not found in export');
      record('settings.json', 'skip', 'not in export');
    } else {
      const npmGlobal = getNpmGlobalPath();
      info(`Resolved HOME: ${HOME_FWD}`);
      info(`Resolved NPM_GLOBAL: ${npmGlobal}`);

      let raw = fs.readFileSync(templatePath, 'utf8');
      raw = raw.replace(/\{\{HOME\}\}/g, HOME_FWD);
      raw = raw.replace(/\{\{NPM_GLOBAL\}\}/g, npmGlobal);

      let templateData;
      try {
        templateData = JSON.parse(raw);
      } catch (e) {
        err(`settings.json has invalid JSON after placeholder substitution: ${e.message}`);
        record('settings.json', 'error', e.message);
        templateData = null;
      }

      if (templateData) {
        const existing = readJson(destPath);
        if (existing) {
          info('Merging with existing settings.json');
          const merged = deepMerge(existing, templateData);
          writeJson(destPath, merged);
          ok(`Merged settings.json -> ${fwd(destPath)}`);
          record('settings.json', 'ok', 'merged');
        } else {
          writeJson(destPath, templateData);
          ok(`Written settings.json -> ${fwd(destPath)}`);
          record('settings.json', 'ok', 'written');
        }
      }
    }
  } catch (e) {
    err(`settings.json step failed: ${e.message}`);
    record('settings.json', 'error', e.message);
  }

  // -------------------------------------------------------------------------
  // 5. Handle config/mcp.json
  // -------------------------------------------------------------------------
  section('5. Installing .mcp.json');
  try {
    const templatePath = path.join(SCRIPT_DIR, 'config', 'mcp.json');
    const destPath = path.join(CLAUDE_DIR, '.mcp.json');

    if (!fs.existsSync(templatePath)) {
      skip('config/mcp.json not found in export');
      record('.mcp.json', 'skip', 'not in export');
    } else {
      const templateData = readJson(templatePath);
      if (templateData) {
        const existing = readJson(destPath);
        if (existing) {
          info('Merging with existing .mcp.json');
          const merged = deepMerge(existing, templateData);
          writeJson(destPath, merged);
          ok(`Merged .mcp.json -> ${fwd(destPath)}`);
          record('.mcp.json', 'ok', 'merged');
        } else {
          writeJson(destPath, templateData);
          ok(`Written .mcp.json -> ${fwd(destPath)}`);
          record('.mcp.json', 'ok', 'written');
        }
      }
    }
  } catch (e) {
    err(`.mcp.json step failed: ${e.message}`);
    record('.mcp.json', 'error', e.message);
  }

  // -------------------------------------------------------------------------
  // 6. Install dependencies
  // -------------------------------------------------------------------------
  section('6. Installing dependencies');

  if (SKIP_DEPS) {
    skip('--skip-deps flag set, skipping npm installs');
    record('npm installs', 'skip', '--skip-deps');
  } else {
    // 6a. @agentmemory/agentmemory global
    info('Installing @agentmemory/agentmemory globally...');
    const globalInstallOk = runCommand('npm install -g @agentmemory/agentmemory');
    if (globalInstallOk) {
      ok('npm install -g @agentmemory/agentmemory');
      record('npm install -g @agentmemory/agentmemory', 'ok');
    } else {
      record('npm install -g @agentmemory/agentmemory', 'error');
    }

    // 6b. session-browser local deps
    const sbDir = path.join(CLAUDE_DIR, 'scripts', 'session-browser');
    const sbPkg = path.join(sbDir, 'package.json');
    if (fs.existsSync(sbPkg)) {
      info('Installing session-browser dependencies...');
      const sbInstallOk = runCommand(`npm install`, { cwd: sbDir });
      if (sbInstallOk) {
        ok(`npm install in ${fwd(sbDir)}`);
        record('session-browser npm install', 'ok');
      } else {
        record('session-browser npm install', 'error');
      }
    } else {
      skip(`No package.json in ${fwd(sbDir)}, skipping`);
      record('session-browser npm install', 'skip', 'no package.json');
    }
  }

  // -------------------------------------------------------------------------
  // 7. Create memory directory structure
  // -------------------------------------------------------------------------
  section('7. Creating memory directory structure');
  try {
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    ensureDir(projectsDir);
    ok(`Created: ${fwd(projectsDir)}`);

    // Write a MEMORY.md template in projects/ as a reference
    const memoryTemplatePath = path.join(projectsDir, 'MEMORY.md.template');
    const memoryTemplate = [
      '# Session Memory',
      '',
      '## User: <your name>',
      '',
      '### Primary Project',
      '- Repository: `<path>`',
      '- Stack: <language/framework>',
      '',
      '### Key Paths',
      '- Source: `<path>`',
      '',
      '### Preferences',
      '- <preferred communication style>',
      '',
      '## Feedback (learned from sessions)',
      '',
      '- <lesson learned>',
    ].join('\n');

    if (!fs.existsSync(memoryTemplatePath)) {
      if (!DRY_RUN) {
        fs.writeFileSync(memoryTemplatePath, memoryTemplate, 'utf8');
      } else {
        info(`[dry] write MEMORY.md template -> ${fwd(memoryTemplatePath)}`);
      }
      ok(`MEMORY.md template written: ${fwd(memoryTemplatePath)}`);
    } else {
      skip(`MEMORY.md template already exists: ${fwd(memoryTemplatePath)}`);
    }
    record('memory structure', 'ok');
  } catch (e) {
    err(`Memory structure step failed: ${e.message}`);
    record('memory structure', 'error', e.message);
  }

  // -------------------------------------------------------------------------
  // 8. Summary
  // -------------------------------------------------------------------------
  section('Summary');
  console.log('');

  let okCount = 0, skipCount = 0, errCount = 0, warnCount = 0;
  for (const r of results) {
    const icon = r.status === 'ok' ? c.green('+')
               : r.status === 'skip' ? c.yellow('~')
               : r.status === 'warn' ? c.yellow('?')
               : c.red('!');
    const detail = r.detail ? c.dim(` (${r.detail})`) : '';
    console.log(`  ${icon} ${r.label}${detail}`);
    if (r.status === 'ok') okCount++;
    else if (r.status === 'skip') skipCount++;
    else if (r.status === 'warn') warnCount++;
    else errCount++;
  }

  console.log('');
  console.log(
    `  ${c.green(`${okCount} ok`)}  ${c.yellow(`${skipCount} skipped`)}  ${errCount > 0 ? c.red(`${errCount} errors`) : c.dim('0 errors')}`
  );

  if (errCount > 0) {
    console.log(c.red('\n  Some steps failed. Review the errors above.'));
    process.exitCode = 1;
  } else {
    console.log(c.green('\n  Installation complete.'));
    if (!DRY_RUN) {
      console.log(c.dim(`  Restart Claude Code to pick up new settings and hooks.`));
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(c.red(`\nFatal error: ${e.message}`));
  console.error(e.stack);
  process.exit(1);
});
