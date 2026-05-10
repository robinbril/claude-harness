import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const LABELS_PATH = join(homedir(), '.claude', 'scripts', 'session-browser', 'session-labels.json')

function loadLabels() {
  if (!existsSync(LABELS_PATH)) return {}
  try { return JSON.parse(readFileSync(LABELS_PATH, 'utf-8')) } catch { return {} }
}

function saveLabels(labels) {
  writeFileSync(LABELS_PATH, JSON.stringify(labels, null, 2), 'utf-8')
}

// Example rules — adjust to match your projects. Each rule matches against the
// session's derived title, project name, and git branch, and assigns a label.
const KEYWORD_RULES = [
  { pattern: /project-a|projecta/i, label: 'Project A' },
  { pattern: /project-b|projectb/i, label: 'Project B' },
  { pattern: /session.?browser|mission.?control|localhost:7337/i, label: 'session-browser' },
  { pattern: /^config$|set all models|login/i, label: 'config' },
]

export function autoSuggestLabel(session) {
  const text = [
    session.derivedTitle || '',
    session.projectName || '',
    session.gitBranch || '',
  ].join(' ')

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) return rule.label
  }
  return null
}

export function getLabels() {
  return loadLabels()
}

export function setLabel(sessionId, label) {
  const labels = loadLabels()
  if (!label || label.trim() === '') {
    delete labels[sessionId]
  } else {
    labels[sessionId] = { label: label.trim(), setAt: new Date().toISOString() }
  }
  saveLabels(labels)
  return { ok: true }
}

export function bulkSetLabels(entries) {
  const labels = loadLabels()
  for (const { sessionId, label } of entries) {
    if (!label || label.trim() === '') {
      delete labels[sessionId]
    } else {
      labels[sessionId] = { label: label.trim(), setAt: new Date().toISOString() }
    }
  }
  saveLabels(labels)
  return { ok: true, count: entries.length }
}

export function getSuggestionsForSessions(sessions) {
  const labels = loadLabels()
  const suggestions = []

  for (const s of sessions) {
    const existing = labels[s.sessionId]
    if (existing) continue

    const suggested = autoSuggestLabel(s)
    if (suggested) {
      suggestions.push({
        sessionId: s.sessionId,
        title: s.derivedTitle,
        projectName: s.projectName,
        suggestedLabel: suggested,
        userMessages: s.userMessages,
      })
    }
  }

  return suggestions
}

export function getKnownLabels(sessions) {
  const labels = loadLabels()
  const fromSessions = new Set(sessions.map(s => s.projectName).filter(Boolean))
  const fromLabels = new Set(Object.values(labels).map(l => l.label).filter(Boolean))
  return [...new Set([...fromSessions, ...fromLabels])].sort()
}
