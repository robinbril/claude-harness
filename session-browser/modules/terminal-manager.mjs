import { spawn } from 'child_process'
import { homedir } from 'os'

const terminals = new Map()
let nextId = 1

function createTerminal({ prompt, model, name, path, maxTurns, maxBudget, permissionMode, effortLevel }) {
  const id = 't' + nextId++
  const dir = path || process.env.USERPROFILE || homedir()

  const terminal = {
    id,
    ownSessionId: null,
    output: [],
    listeners: new Set(),
    alive: true,
    createdAt: Date.now(),
    dir,
    name: name || 'unnamed',
    model: model || 'claude-sonnet-4-6',
    maxTurns: maxTurns || 0,
    maxBudget: maxBudget || 0,
    permissionMode: permissionMode || 'default',
    effortLevel: effortLevel || 'high',
    pending: false,
  }
  terminals.set(id, terminal)

  if (prompt) {
    runPrompt(id, prompt)
  }

  return id
}

function runPrompt(terminalId, message) {
  const t = terminals.get(terminalId)
  if (!t) return { ok: false, error: 'Terminal not found' }
  if (t.pending) return { ok: false, error: 'Already processing a message' }

  t.pending = true
  const push = (chunk) => {
    t.output.push(chunk)
    if (t.output.length > 500) t.output.shift()
    for (const fn of t.listeners) fn(chunk)
  }

  push({ type: 'stdin', text: message, ts: Date.now() })

  const args = ['-p', message, '--output-format', 'json']
  if (t.ownSessionId) {
    args.push('--resume', t.ownSessionId)
  }
  if (t.model) {
    args.push('--model', t.model)
  }
  if (t.maxBudget > 0) {
    args.push('--max-budget-usd', String(t.maxBudget))
  }
  if (t.permissionMode && t.permissionMode !== 'default') {
    args.push('--permission-mode', t.permissionMode)
  } else {
    args.push('--dangerously-skip-permissions')
  }

  const child = spawn('claude', args, {
    cwd: t.dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  })

  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (data) => {
    stdout += data.toString('utf-8')
  })

  child.stderr.on('data', (data) => {
    stderr += data.toString('utf-8')
  })

  child.on('close', (code) => {
    t.pending = false

    if (code === 0 && stdout) {
      try {
        const json = JSON.parse(stdout.trim())
        if (json.session_id) t.ownSessionId = json.session_id
        const text = json.result || ''
        if (text) push({ type: 'stdout', text, ts: Date.now() })
        push({ type: 'done', code: 0, cost: json.total_cost_usd, turns: json.num_turns, ts: Date.now() })
        return
      } catch {}
    }

    if (stdout.trim()) {
      push({ type: 'stdout', text: stdout, ts: Date.now() })
    }
    if (code !== 0 && stderr) {
      const cleaned = stderr.split('\n').filter(l => !l.includes('Hook cancelled') && !l.includes('Hook failed')).join('\n').trim()
      if (cleaned) push({ type: 'stderr', text: cleaned, ts: Date.now() })
    }
    push({ type: 'done', code, ts: Date.now() })
  })

  child.on('error', (err) => {
    t.pending = false
    push({ type: 'error', text: err.message, ts: Date.now() })
  })

  return { ok: true }
}

function sendMessage(terminalId, message) {
  return runPrompt(terminalId, message)
}

function getOutput(terminalId, since) {
  const t = terminals.get(terminalId)
  if (!t) return { ok: false, error: 'Terminal not found' }
  const chunks = since ? t.output.filter(c => c.ts > since) : t.output.slice(-100)
  return { ok: true, terminalId, alive: t.alive, pending: t.pending, chunks, name: t.name, sessionId: t.ownSessionId }
}

function addOutputListener(terminalId, fn) {
  const t = terminals.get(terminalId)
  if (!t) return false
  t.listeners.add(fn)
  return true
}

function removeOutputListener(terminalId, fn) {
  const t = terminals.get(terminalId)
  if (!t) return
  t.listeners.delete(fn)
}

function listTerminals() {
  const list = []
  for (const [id, t] of terminals) {
    list.push({
      id, sessionId: t.ownSessionId, alive: t.alive,
      pending: t.pending, name: t.name, createdAt: t.createdAt,
      dir: t.dir, outputLines: t.output.length,
    })
  }
  return list
}

function killTerminal(terminalId) {
  const t = terminals.get(terminalId)
  if (!t) return { ok: false, error: 'Not found' }
  t.alive = false
  terminals.delete(terminalId)
  return { ok: true }
}

export { createTerminal, sendMessage, getOutput, addOutputListener, removeOutputListener, listTerminals, killTerminal }
