import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

const STORE_DIR = join(homedir(), '.claude', 'agent-bus')
const EVENTS_FILE = join(STORE_DIR, 'events.json')
const TASKS_FILE = join(STORE_DIR, 'tasks.json')
const MESSAGES_FILE = join(STORE_DIR, 'messages.json')

const MAX_EVENTS = 200
const MAX_TASKS = 500
const MAX_MESSAGES = 200
const MAX_TASK_HISTORY = 50

function ensureDir() {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true })
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return fallback }
}

function writeJson(path, data) {
  ensureDir()
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  writeFileSync(path, readFileSync(tmp, 'utf-8'))
  try { require('fs').unlinkSync(tmp) } catch {}
}

// --- Event Bus (Claw3D AgentEvent pattern) ---

export function postEvent(event) {
  const entry = {
    id: randomUUID(),
    ts: Date.now(),
    agent: event.agent || 'unknown',
    project: event.project || '',
    event: event.event || 'heartbeat',
    tool: event.tool || null,
    file: event.file || null,
    message: event.message || null,
  }
  const events = readJson(EVENTS_FILE, [])
  events.unshift(entry)
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  writeJson(EVENTS_FILE, events)
  broadcastToListeners(entry)
  return entry
}

export function getEvents(filter = {}) {
  const events = readJson(EVENTS_FILE, [])
  let result = events
  if (filter.project) result = result.filter(e => e.project === filter.project)
  if (filter.agent) result = result.filter(e => e.agent === filter.agent)
  if (filter.event) result = result.filter(e => e.event === filter.event)
  if (filter.since) result = result.filter(e => e.ts >= filter.since)
  return result.slice(0, filter.limit || 50)
}

// --- Directed Messages (Claw3D agentMessaging pattern) ---

export function sendDirectedMessage(payload) {
  const msg = {
    id: payload.idempotencyKey || randomUUID(),
    ts: Date.now(),
    from: payload.from || 'user',
    to: payload.to,
    mode: payload.mode || 'direct',
    content: payload.content || '',
    project: payload.project || '',
    delivered: false,
    deliveredAt: null,
  }
  const messages = readJson(MESSAGES_FILE, [])
  const existing = messages.findIndex(m => m.id === msg.id)
  if (existing >= 0) return messages[existing]
  messages.unshift(msg)
  if (messages.length > MAX_MESSAGES) messages.length = MAX_MESSAGES
  writeJson(MESSAGES_FILE, messages)

  postEvent({
    agent: msg.from,
    project: msg.project,
    event: 'message_sent',
    message: `→ ${msg.to}: ${msg.content.slice(0, 80)}`,
  })

  return msg
}

export function getMessagesForAgent(agentId) {
  const messages = readJson(MESSAGES_FILE, [])
  return messages.filter(m => m.to === agentId && !m.delivered).slice(0, 20)
}

export function markMessageDelivered(messageId) {
  const messages = readJson(MESSAGES_FILE, [])
  const msg = messages.find(m => m.id === messageId)
  if (msg) {
    msg.delivered = true
    msg.deliveredAt = Date.now()
    writeJson(MESSAGES_FILE, messages)
  }
  return msg
}

export function getMessageHistory(filter = {}) {
  const messages = readJson(MESSAGES_FILE, [])
  let result = messages
  if (filter.project) result = result.filter(m => m.project === filter.project)
  if (filter.agent) result = result.filter(m => m.from === filter.agent || m.to === filter.agent)
  return result.slice(0, filter.limit || 30)
}

// --- Agent Handoffs (Claw3D handoff pattern) ---

export function sendHandoff(payload) {
  const handoff = {
    id: payload.idempotencyKey || randomUUID(),
    ts: Date.now(),
    from: payload.from,
    to: payload.to,
    project: payload.project || '',
    task: payload.task,
    context: payload.context || '',
    acceptanceCriteria: payload.acceptanceCriteria || '',
    deliverables: payload.deliverables || [],
    status: 'pending',
    result: null,
  }

  const tasks = readJson(TASKS_FILE, [])
  tasks.unshift(handoff)
  if (tasks.length > MAX_TASKS) tasks.length = MAX_TASKS
  writeJson(TASKS_FILE, tasks)

  postEvent({
    agent: handoff.from,
    project: handoff.project,
    event: 'handoff_sent',
    message: `Handoff → ${handoff.to}: ${handoff.task.slice(0, 60)}`,
  })

  return handoff
}

export function getHandoffsForAgent(agentId) {
  const tasks = readJson(TASKS_FILE, [])
  return tasks.filter(t => t.to === agentId && t.status === 'pending').slice(0, 20)
}

export function completeHandoff(handoffId, result) {
  const tasks = readJson(TASKS_FILE, [])
  const task = tasks.find(t => t.id === handoffId)
  if (task) {
    task.status = 'completed'
    task.result = result || 'done'
    task.completedAt = Date.now()
    writeJson(TASKS_FILE, tasks)

    postEvent({
      agent: task.to,
      project: task.project,
      event: 'handoff_completed',
      message: `Completed: ${task.task.slice(0, 60)}`,
    })
  }
  return task
}

// --- Shared Task Store (Claw3D shared-store pattern) ---

export function getSharedTasks(project) {
  const tasks = readJson(TASKS_FILE, [])
  if (project) return tasks.filter(t => t.project === project)
  return tasks.slice(0, 50)
}

export function createSharedTask(task) {
  const entry = {
    id: randomUUID(),
    ts: Date.now(),
    title: task.title,
    description: task.description || '',
    status: task.status || 'open',
    project: task.project || '',
    assignedAgentId: task.assignedAgentId || null,
    source: task.source || 'user',
    history: [{ ts: Date.now(), action: 'created', by: task.source || 'user' }],
  }
  const tasks_list = readJson(TASKS_FILE, [])
  tasks_list.unshift(entry)
  if (tasks_list.length > MAX_TASKS) tasks_list.length = MAX_TASKS
  writeJson(TASKS_FILE, tasks_list)
  return entry
}

export function updateSharedTask(taskId, update) {
  const tasks = readJson(TASKS_FILE, [])
  const task = tasks.find(t => t.id === taskId)
  if (!task) return null
  if (update.status) task.status = update.status
  if (update.assignedAgentId) task.assignedAgentId = update.assignedAgentId
  if (update.result) task.result = update.result
  if (!task.history) task.history = []
  task.history.push({ ts: Date.now(), action: update.action || 'updated', by: update.by || 'system' })
  if (task.history.length > MAX_TASK_HISTORY) task.history = task.history.slice(-MAX_TASK_HISTORY)
  writeJson(TASKS_FILE, tasks)
  return task
}

// --- SSE Broadcast (real-time push to connected clients) ---

const _listeners = new Set()

export function addListener(res) {
  _listeners.add(res)
  res.on('close', () => _listeners.delete(res))
}

function broadcastToListeners(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const res of _listeners) {
    try { res.write(data) } catch { _listeners.delete(res) }
  }
}

// --- Project Context (agents on same project share context) ---

export function getProjectContext(project) {
  const events = getEvents({ project, limit: 20 })
  const messages = getMessageHistory({ project, limit: 20 })
  const tasks = getSharedTasks(project)
  const activeAgents = new Set()
  const recentTools = []

  for (const e of events) {
    if (Date.now() - e.ts < 300000) activeAgents.add(e.agent)
    if (e.tool && recentTools.length < 10) recentTools.push({ agent: e.agent, tool: e.tool, file: e.file, ts: e.ts })
  }

  return {
    project,
    activeAgents: [...activeAgents],
    recentEvents: events.slice(0, 10),
    recentMessages: messages.slice(0, 10),
    openTasks: tasks.filter(t => t.status === 'open' || t.status === 'pending').slice(0, 10),
    recentTools,
  }
}
