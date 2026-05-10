#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const hudDir = path.join(os.homedir(), '.claude', 'plugins', 'claude-hud');
const accountFile = path.join(hudDir, 'current-account.json');

try {
  if (!fs.existsSync(hudDir)) fs.mkdirSync(hudDir, { recursive: true });
  const output = execSync('claude auth status', { encoding: 'utf-8', timeout: 5000 });
  const parsed = JSON.parse(output.trim());
  fs.writeFileSync(accountFile, JSON.stringify(parsed, null, 2));
} catch (e) {
  // Silent fail - HUD falls back to single bar
}
