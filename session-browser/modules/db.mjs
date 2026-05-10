/**
 * SQLite persistence layer for session-browser.
 *
 * Uses better-sqlite3 for synchronous access (matches the scanner's sync I/O style).
 * WAL mode + prepared statements for performance.
 *
 * Gracefully degrades: if better-sqlite3 is not installed, DB_AVAILABLE is false
 * and all exported functions return empty arrays / no-ops.
 */

import { join } from 'path'
import { mkdirSync } from 'fs'
import { homedir } from 'os'

// ─── Path setup ──────────────────────────────────────────────────────────────

const DATA_DIR = join(homedir(), '.claude', 'scripts', 'session-browser')
const DB_PATH = join(DATA_DIR, 'data.db')

// ─── Try to load better-sqlite3 ──────────────────────────────────────────────

let Database = null
let DB_AVAILABLE = false

try {
  const mod = await import('better-sqlite3')
  Database = mod.default
  DB_AVAILABLE = true
} catch {
  // better-sqlite3 not installed — all functions will be stubs
  console.warn('[session-browser/db] better-sqlite3 not available; persistence disabled.')
}

export { DB_AVAILABLE }

// ─── Singleton db instance ───────────────────────────────────────────────────

let _db = null

// ─── Schema ──────────────────────────────────────────────────────────────────

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS session_snapshots (
    id                INTEGER PRIMARY KEY,
    session_id        TEXT    UNIQUE NOT NULL,
    project_name      TEXT,
    model             TEXT,
    derived_title     TEXT,
    input_tokens      INTEGER NOT NULL DEFAULT 0,
    output_tokens     INTEGER NOT NULL DEFAULT 0,
    estimated_cost    REAL    NOT NULL DEFAULT 0,
    user_messages     INTEGER NOT NULL DEFAULT 0,
    tool_uses         INTEGER NOT NULL DEFAULT 0,
    first_message_at  TEXT,
    last_message_at   TEXT,
    scanned_at        TEXT    NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS daily_stats (
    id               INTEGER PRIMARY KEY,
    date             TEXT    UNIQUE NOT NULL,
    total_sessions   INTEGER NOT NULL DEFAULT 0,
    total_tokens     INTEGER NOT NULL DEFAULT 0,
    total_cost       REAL    NOT NULL DEFAULT 0,
    models_used      TEXT,
    projects_active  TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS cost_events (
    id          INTEGER PRIMARY KEY,
    session_id  TEXT    NOT NULL,
    timestamp   TEXT    NOT NULL,
    tokens      INTEGER NOT NULL DEFAULT 0,
    cost        REAL    NOT NULL DEFAULT 0,
    model       TEXT,
    project     TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS agents_index (
    id          INTEGER PRIMARY KEY,
    filename    TEXT    UNIQUE NOT NULL,
    name        TEXT,
    description TEXT,
    model       TEXT,
    tools       TEXT,
    updated_at  TEXT    NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS skills_index (
    id          INTEGER PRIMARY KEY,
    filename    TEXT    UNIQUE NOT NULL,
    name        TEXT,
    description TEXT,
    updated_at  TEXT    NOT NULL
  )`,

  // Indexes for common query patterns
  `CREATE INDEX IF NOT EXISTS idx_snapshots_last_msg   ON session_snapshots (last_message_at)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_project    ON session_snapshots (project_name)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_model      ON session_snapshots (model)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_events_session  ON cost_events (session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_events_project  ON cost_events (project)`,
  `CREATE INDEX IF NOT EXISTS idx_cost_events_model    ON cost_events (model)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_stats_date     ON daily_stats (date)`,
]

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Open (or create) the database and run migrations.
 * Returns the db instance, or null if better-sqlite3 is unavailable.
 */
export function initDb() {
  if (!DB_AVAILABLE) return null
  if (_db) return _db

  try {
    mkdirSync(DATA_DIR, { recursive: true })

    _db = new Database(DB_PATH)

    // Performance + safety pragmas (same as mission-control)
    _db.pragma('journal_mode = WAL')
    _db.pragma('synchronous = NORMAL')
    _db.pragma('cache_size = 1000')
    _db.pragma('foreign_keys = ON')

    // Run all migrations in a transaction
    const migrate = _db.transaction(() => {
      for (const sql of MIGRATIONS) {
        _db.exec(sql)
      }
    })
    migrate()

    return _db
  } catch (err) {
    console.error('[session-browser/db] Failed to initialize database:', err)
    _db = null
    return null
  }
}

// ─── Prepared statement cache ────────────────────────────────────────────────

// Lazy-initialized so we don't prepare against a null db
const _stmts = {}

function stmt(name, sql) {
  const db = initDb()
  if (!db) return null
  if (!_stmts[name]) {
    _stmts[name] = db.prepare(sql)
  }
  return _stmts[name]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString()
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function cutoffIso(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

// ─── Upsert sessions ─────────────────────────────────────────────────────────

/**
 * Bulk upsert scanner results into session_snapshots.
 * @param {Array} sessions - output of scanSessions()
 */
export function upsertSessions(sessions) {
  const db = initDb()
  if (!db || !sessions?.length) return

  const upsert = db.prepare(`
    INSERT INTO session_snapshots
      (session_id, project_name, model, derived_title,
       input_tokens, output_tokens, estimated_cost,
       user_messages, tool_uses,
       first_message_at, last_message_at, scanned_at)
    VALUES
      (@sessionId, @projectName, @model, @derivedTitle,
       @inputTokens, @outputTokens, @estimatedCost,
       @userMessages, @toolUses,
       @firstMessageAt, @lastMessageAt, @scannedAt)
    ON CONFLICT (session_id) DO UPDATE SET
      project_name     = excluded.project_name,
      model            = excluded.model,
      derived_title    = excluded.derived_title,
      input_tokens     = excluded.input_tokens,
      output_tokens    = excluded.output_tokens,
      estimated_cost   = excluded.estimated_cost,
      user_messages    = excluded.user_messages,
      tool_uses        = excluded.tool_uses,
      first_message_at = excluded.first_message_at,
      last_message_at  = excluded.last_message_at,
      scanned_at       = excluded.scanned_at
  `)

  const scannedAt = nowIso()
  const run = db.transaction((rows) => {
    for (const s of rows) {
      upsert.run({
        sessionId:      s.sessionId,
        projectName:    s.projectName  ?? null,
        model:          s.model        ?? null,
        derivedTitle:   s.derivedTitle ?? null,
        inputTokens:    s.inputTokens  ?? 0,
        outputTokens:   s.outputTokens ?? 0,
        estimatedCost:  s.estimatedCost ?? 0,
        userMessages:   s.userMessages ?? 0,
        toolUses:       s.toolUses     ?? 0,
        firstMessageAt: s.firstMessageAt ?? null,
        lastMessageAt:  s.lastMessageAt  ?? null,
        scannedAt,
      })
    }
  })

  try {
    run(sessions)
  } catch (err) {
    console.error('[session-browser/db] upsertSessions failed:', err)
  }
}

// ─── Daily stats ─────────────────────────────────────────────────────────────

/**
 * Aggregate today's sessions and upsert into daily_stats.
 * @param {Array} sessions - output of scanSessions()
 */
export function recordDailyStats(sessions) {
  const db = initDb()
  if (!db || !sessions?.length) return

  const today = todayIso()

  // Only consider sessions active today (last message on today's date)
  const todaySessions = sessions.filter(s => {
    if (!s.lastMessageAt) return false
    return s.lastMessageAt.slice(0, 10) === today
  })

  if (todaySessions.length === 0) return

  const totalSessions = todaySessions.length
  const totalTokens = todaySessions.reduce((sum, s) => sum + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0)
  const totalCost = todaySessions.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0)

  const models = [...new Set(todaySessions.map(s => s.model).filter(Boolean))]
  const projects = [...new Set(todaySessions.map(s => s.projectName).filter(Boolean))]

  const upsert = db.prepare(`
    INSERT INTO daily_stats (date, total_sessions, total_tokens, total_cost, models_used, projects_active)
    VALUES (@date, @totalSessions, @totalTokens, @totalCost, @modelsUsed, @projectsActive)
    ON CONFLICT (date) DO UPDATE SET
      total_sessions   = excluded.total_sessions,
      total_tokens     = excluded.total_tokens,
      total_cost       = excluded.total_cost,
      models_used      = excluded.models_used,
      projects_active  = excluded.projects_active
  `)

  try {
    upsert.run({
      date:            today,
      totalSessions:   totalSessions,
      totalTokens:     totalTokens,
      totalCost:       Math.round(totalCost * 10000) / 10000,
      modelsUsed:      JSON.stringify(models),
      projectsActive:  JSON.stringify(projects),
    })
  } catch (err) {
    console.error('[session-browser/db] recordDailyStats failed:', err)
  }
}

// ─── Snapshot throttle ───────────────────────────────────────────────────────

let _lastSnapshotAt = 0
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Called on every /api/sessions request.
 * Runs upsertSessions + recordDailyStats at most once per hour.
 * @param {Array} sessions - output of scanSessions()
 */
export function snapshotIfNeeded(sessions) {
  if (!DB_AVAILABLE) return
  const now = Date.now()
  if (now - _lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return

  _lastSnapshotAt = now
  upsertSessions(sessions)
  recordDailyStats(sessions)
}

// ─── Query: daily trend ───────────────────────────────────────────────────────

/**
 * Get daily_stats rows for the last N days, ordered ascending by date.
 * @param {number} days
 * @returns {Array<{date, total_sessions, total_tokens, total_cost, models_used, projects_active}>}
 */
export function getDailyTrend(days = 30) {
  const db = initDb()
  if (!db) return []

  try {
    const rows = db.prepare(`
      SELECT date, total_sessions, total_tokens, total_cost, models_used, projects_active
      FROM daily_stats
      WHERE date >= ?
      ORDER BY date ASC
    `).all(cutoffIso(days))

    return rows.map(r => ({
      ...r,
      models_used:     safeJsonParse(r.models_used, []),
      projects_active: safeJsonParse(r.projects_active, []),
    }))
  } catch (err) {
    console.error('[session-browser/db] getDailyTrend failed:', err)
    return []
  }
}

// ─── Query: cost by project ───────────────────────────────────────────────────

/**
 * Aggregate total cost per project for sessions last active within N days.
 * @param {number} days
 * @returns {Array<{project_name, total_cost, total_tokens, session_count}>}
 */
export function getCostByProject(days = 30) {
  const db = initDb()
  if (!db) return []

  try {
    return db.prepare(`
      SELECT
        project_name,
        SUM(estimated_cost)               AS total_cost,
        SUM(input_tokens + output_tokens) AS total_tokens,
        COUNT(*)                          AS session_count
      FROM session_snapshots
      WHERE last_message_at >= ?
        AND project_name IS NOT NULL
      GROUP BY project_name
      ORDER BY total_cost DESC
    `).all(cutoffIso(days) + 'T00:00:00.000Z')
  } catch (err) {
    console.error('[session-browser/db] getCostByProject failed:', err)
    return []
  }
}

// ─── Query: cost by model ─────────────────────────────────────────────────────

/**
 * Aggregate total cost per model for sessions last active within N days.
 * @param {number} days
 * @returns {Array<{model, total_cost, total_tokens, session_count}>}
 */
export function getCostByModel(days = 30) {
  const db = initDb()
  if (!db) return []

  try {
    return db.prepare(`
      SELECT
        model,
        SUM(estimated_cost)               AS total_cost,
        SUM(input_tokens + output_tokens) AS total_tokens,
        COUNT(*)                          AS session_count
      FROM session_snapshots
      WHERE last_message_at >= ?
        AND model IS NOT NULL
      GROUP BY model
      ORDER BY total_cost DESC
    `).all(cutoffIso(days) + 'T00:00:00.000Z')
  } catch (err) {
    console.error('[session-browser/db] getCostByModel failed:', err)
    return []
  }
}

// ─── Query: session history ───────────────────────────────────────────────────

/**
 * Get all snapshot rows for a single session (tracks growth over time).
 * Because session_id is UNIQUE in session_snapshots, this returns 0 or 1 rows.
 * Kept as an array return for forward compatibility with a future snapshots-log table.
 * @param {string} sessionId
 * @returns {Array}
 */
export function getSessionHistory(sessionId) {
  const db = initDb()
  if (!db || !sessionId) return []

  try {
    return db.prepare(`
      SELECT *
      FROM session_snapshots
      WHERE session_id = ?
      ORDER BY scanned_at ASC
    `).all(sessionId)
  } catch (err) {
    console.error('[session-browser/db] getSessionHistory failed:', err)
    return []
  }
}

// ─── Query: lifetime totals ───────────────────────────────────────────────────

/**
 * Lifetime totals across all stored sessions.
 * @returns {{ total_cost: number, total_tokens: number, total_sessions: number, avg_cost_per_session: number }}
 */
export function getTotalStats() {
  const db = initDb()
  if (!db) return { total_cost: 0, total_tokens: 0, total_sessions: 0, avg_cost_per_session: 0 }

  try {
    const row = db.prepare(`
      SELECT
        COUNT(*)                          AS total_sessions,
        SUM(estimated_cost)               AS total_cost,
        SUM(input_tokens + output_tokens) AS total_tokens
      FROM session_snapshots
    `).get()

    const totalSessions = row?.total_sessions ?? 0
    const totalCost     = row?.total_cost     ?? 0
    const totalTokens   = row?.total_tokens   ?? 0

    return {
      total_sessions:       totalSessions,
      total_cost:           Math.round(totalCost * 10000) / 10000,
      total_tokens:         totalTokens,
      avg_cost_per_session: totalSessions > 0
        ? Math.round((totalCost / totalSessions) * 10000) / 10000
        : 0,
    }
  } catch (err) {
    console.error('[session-browser/db] getTotalStats failed:', err)
    return { total_cost: 0, total_tokens: 0, total_sessions: 0, avg_cost_per_session: 0 }
  }
}

// ─── Upsert agents/skills ────────────────────────────────────────────────────

export function upsertAgents(agents) {
  const db = initDb()
  if (!db || !agents?.length) return

  const upsert = db.prepare(`
    INSERT INTO agents_index (filename, name, description, model, tools, updated_at)
    VALUES (@filename, @name, @description, @model, @tools, @updatedAt)
    ON CONFLICT (filename) DO UPDATE SET
      name = excluded.name, description = excluded.description,
      model = excluded.model, tools = excluded.tools, updated_at = excluded.updated_at
  `)

  const now = nowIso()
  const run = db.transaction((rows) => {
    for (const a of rows) {
      upsert.run({
        filename: a.filename, name: a.name ?? null, description: a.description ?? null,
        model: a.model ?? null, tools: Array.isArray(a.tools) ? JSON.stringify(a.tools) : null, updatedAt: now,
      })
    }
  })
  try { run(agents) } catch (err) { console.error('[session-browser/db] upsertAgents failed:', err) }
}

export function upsertSkills(skills) {
  const db = initDb()
  if (!db || !skills?.length) return

  const upsert = db.prepare(`
    INSERT INTO skills_index (filename, name, description, updated_at)
    VALUES (@filename, @name, @description, @updatedAt)
    ON CONFLICT (filename) DO UPDATE SET
      name = excluded.name, description = excluded.description, updated_at = excluded.updated_at
  `)

  const now = nowIso()
  const run = db.transaction((rows) => {
    for (const s of rows) {
      upsert.run({ filename: s.filename, name: s.name ?? null, description: s.description ?? null, updatedAt: now })
    }
  })
  try { run(skills) } catch (err) { console.error('[session-browser/db] upsertSkills failed:', err) }
}

export function getAgentsFromDb() {
  const db = initDb()
  if (!db) return []
  try { return db.prepare('SELECT * FROM agents_index ORDER BY name ASC').all() } catch { return [] }
}

export function getSkillsFromDb() {
  const db = initDb()
  if (!db) return []
  try { return db.prepare('SELECT * FROM skills_index ORDER BY name ASC').all() } catch { return [] }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function safeJsonParse(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

// ─── Cleanup on exit ──────────────────────────────────────────────────────────

function closeDb() {
  if (_db) {
    try { _db.close() } catch { /* ignore */ }
    _db = null
  }
}

process.on('exit', closeDb)
process.on('SIGINT', closeDb)
process.on('SIGTERM', closeDb)
