import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIGS_PATH = join(homedir(), '.claude', 'scripts', 'session-browser', 'launch-configs.json')

function loadConfigs() {
  if (!existsSync(CONFIGS_PATH)) return {}
  try { return JSON.parse(readFileSync(CONFIGS_PATH, 'utf-8')) } catch { return {} }
}

function saveConfigs(configs) {
  writeFileSync(CONFIGS_PATH, JSON.stringify(configs, null, 2), 'utf-8')
}

export function getConfig(projectLabel) {
  const configs = loadConfigs()
  return configs[projectLabel] || null
}

export function saveConfig(projectLabel, config) {
  const configs = loadConfigs()
  configs[projectLabel] = {
    model: config.model || null,
    agent: config.agent || null,
    skills: config.skills || {},
    memory: config.memory || {},
    subagents: config.subagents || {},
    subSkills: config.subSkills || {},
    modules: config.modules || {},
    moduleSettings: config.moduleSettings || {},
    savedAt: new Date().toISOString(),
  }
  saveConfigs(configs)
  return { ok: true }
}

export function listConfigs() {
  return loadConfigs()
}
