import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { scanSessions } from '../scanner.mjs'

const HOME = homedir()
const CLAUDE_HOME = join(HOME, '.claude')
const CACHE_TTL_MS = 60_000

let _cache = null
let _cacheTs = 0

function buildIndex(sessions) {
  const sessionsByAgent = {}
  const sessionsBySkill = {}
  const sessionsByProject = {}
  const agentsByProject = {}
  const skillsByProject = {}
  const sessionMeta = {}

  for (const s of sessions) {
    const { sessionId, projectSlug, projectName, agentsUsed, skillsUsed, toolNames } = s

    sessionMeta[sessionId] = {
      agentsUsed: agentsUsed || [],
      skillsUsed: skillsUsed || [],
      toolNames: toolNames || [],
      projectSlug,
      projectName,
      derivedTitle: s.derivedTitle,
      model: s.model,
      estimatedCost: s.estimatedCost,
      lastMessageAt: s.lastMessageAt,
    }

    const proj = projectName || projectSlug
    if (!sessionsByProject[proj]) sessionsByProject[proj] = []
    sessionsByProject[proj].push(sessionId)

    if (!agentsByProject[proj]) agentsByProject[proj] = new Set()
    if (!skillsByProject[proj]) skillsByProject[proj] = new Set()

    for (const agent of (agentsUsed || [])) {
      if (!sessionsByAgent[agent]) sessionsByAgent[agent] = []
      sessionsByAgent[agent].push(sessionId)
      agentsByProject[proj].add(agent)
    }

    for (const skill of (skillsUsed || [])) {
      if (!sessionsBySkill[skill]) sessionsBySkill[skill] = []
      sessionsBySkill[skill].push(sessionId)
      skillsByProject[proj].add(skill)
    }
  }

  const toArr = (obj) => Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v instanceof Set ? [...v] : v])
  )

  return {
    sessionsByAgent,
    sessionsBySkill,
    sessionsByProject,
    agentsByProject: toArr(agentsByProject),
    skillsByProject: toArr(skillsByProject),
    sessionMeta,
    builtAt: new Date().toISOString(),
    sessionCount: sessions.length,
  }
}

export function getRelationshipIndex() {
  const now = Date.now()
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache
  const sessions = scanSessions()
  _cache = buildIndex(sessions)
  _cacheTs = now
  return _cache
}

export function getSessionGraph(sessionId) {
  const index = getRelationshipIndex()
  const meta = index.sessionMeta[sessionId]
  if (!meta) return null
  return {
    sessionId,
    ...meta,
    relatedSessions: findRelatedSessions(index, sessionId, meta),
  }
}

function findRelatedSessions(index, sessionId, meta) {
  const related = new Set()
  for (const agent of (meta.agentsUsed || [])) {
    for (const sid of (index.sessionsByAgent[agent] || [])) {
      if (sid !== sessionId) related.add(sid)
    }
  }
  for (const skill of (meta.skillsUsed || [])) {
    for (const sid of (index.sessionsBySkill[skill] || [])) {
      if (sid !== sessionId) related.add(sid)
    }
  }
  return [...related].slice(0, 10).map(sid => ({
    sessionId: sid,
    derivedTitle: index.sessionMeta[sid]?.derivedTitle,
    lastMessageAt: index.sessionMeta[sid]?.lastMessageAt,
  }))
}

export function getAgentGraph(agentName) {
  const index = getRelationshipIndex()
  const sessionIds = index.sessionsByAgent[agentName] || []
  return {
    agent: agentName,
    sessionCount: sessionIds.length,
    sessions: sessionIds.map(sid => ({
      sessionId: sid,
      derivedTitle: index.sessionMeta[sid]?.derivedTitle,
      projectName: index.sessionMeta[sid]?.projectName,
      estimatedCost: index.sessionMeta[sid]?.estimatedCost,
      lastMessageAt: index.sessionMeta[sid]?.lastMessageAt,
    })),
    coAgents: findCoEntities(index, sessionIds, 'agentsUsed', agentName),
    coSkills: findCoEntities(index, sessionIds, 'skillsUsed', null),
  }
}

export function getSkillGraph(skillName) {
  const index = getRelationshipIndex()
  const sessionIds = index.sessionsBySkill[skillName] || []
  return {
    skill: skillName,
    sessionCount: sessionIds.length,
    sessions: sessionIds.map(sid => ({
      sessionId: sid,
      derivedTitle: index.sessionMeta[sid]?.derivedTitle,
      projectName: index.sessionMeta[sid]?.projectName,
      estimatedCost: index.sessionMeta[sid]?.estimatedCost,
      lastMessageAt: index.sessionMeta[sid]?.lastMessageAt,
    })),
    coAgents: findCoEntities(index, sessionIds, 'agentsUsed', null),
    coSkills: findCoEntities(index, sessionIds, 'skillsUsed', skillName),
  }
}

export function getProjectGraph(projectSlug) {
  const index = getRelationshipIndex()
  const proj = Object.keys(index.sessionsByProject).find(p =>
    p === projectSlug || p.toLowerCase().includes(projectSlug.toLowerCase())
  )
  if (!proj) return null
  return {
    project: proj,
    sessionCount: (index.sessionsByProject[proj] || []).length,
    agents: index.agentsByProject[proj] || [],
    skills: index.skillsByProject[proj] || [],
    sessions: (index.sessionsByProject[proj] || []).slice(0, 20).map(sid => ({
      sessionId: sid,
      derivedTitle: index.sessionMeta[sid]?.derivedTitle,
      agentsUsed: index.sessionMeta[sid]?.agentsUsed,
      skillsUsed: index.sessionMeta[sid]?.skillsUsed,
      estimatedCost: index.sessionMeta[sid]?.estimatedCost,
      lastMessageAt: index.sessionMeta[sid]?.lastMessageAt,
    })),
  }
}

function findCoEntities(index, sessionIds, field, excludeName) {
  const counts = {}
  for (const sid of sessionIds) {
    const meta = index.sessionMeta[sid]
    if (!meta) continue
    for (const name of (meta[field] || [])) {
      if (name === excludeName) continue
      counts[name] = (counts[name] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))
}

export function searchAll(query) {
  if (!query || query.length < 2) return { results: [] }
  const q = query.toLowerCase()
  const results = []

  const index = getRelationshipIndex()
  for (const [sid, meta] of Object.entries(index.sessionMeta)) {
    if ((meta.derivedTitle || '').toLowerCase().includes(q) ||
        (meta.projectName || '').toLowerCase().includes(q)) {
      results.push({
        type: 'session', id: sid,
        title: meta.derivedTitle || sid.slice(0, 8),
        subtitle: meta.projectName,
        lastMessageAt: meta.lastMessageAt,
      })
    }
  }

  const agentsDir = join(CLAUDE_HOME, 'agents')
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
      const name = f.replace('.md', '')
      if (name.toLowerCase().includes(q)) {
        const sessionCount = (index.sessionsByAgent[name] || []).length
        results.push({ type: 'agent', id: name, title: name, subtitle: `Used in ${sessionCount} sessions` })
      }
    }
  }

  const commandsDir = join(CLAUDE_HOME, 'commands')
  if (existsSync(commandsDir)) {
    for (const f of readdirSync(commandsDir).filter(f => f.endsWith('.md'))) {
      const name = f.replace('.md', '')
      if (name.toLowerCase().includes(q)) {
        const sessionCount = (index.sessionsBySkill[name] || []).length
        results.push({ type: 'skill', id: name, title: '/' + name, subtitle: `Used in ${sessionCount} sessions` })
      }
    }
  }

  const rulesDir = join(CLAUDE_HOME, 'rules', 'common')
  if (existsSync(rulesDir)) {
    for (const f of readdirSync(rulesDir).filter(f => f.endsWith('.md'))) {
      const name = f.replace('.md', '')
      if (name.toLowerCase().includes(q)) {
        results.push({ type: 'rule', id: f, title: name, subtitle: 'Rule' })
      }
    }
  }

  const projectsDir = join(CLAUDE_HOME, 'projects')
  if (existsSync(projectsDir)) {
    try {
      for (const projDir of readdirSync(projectsDir)) {
        const memoryDir = join(projectsDir, projDir, 'memory')
        if (!existsSync(memoryDir)) continue
        for (const f of readdirSync(memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')) {
          try {
            const content = readFileSync(join(memoryDir, f), 'utf-8')
            const nameMatch = content.match(/^name:\s*(.+)$/m)
            const descMatch = content.match(/^description:\s*(.+)$/m)
            const typeMatch = content.match(/^type:\s*(.+)$/m)
            const displayName = nameMatch ? nameMatch[1].trim() : f.replace('.md', '')
            if (displayName.toLowerCase().includes(q) || (descMatch && descMatch[1].toLowerCase().includes(q))) {
              const exists = results.some(r => r.type === 'memory' && r.id === f)
              if (!exists) {
                results.push({
                  type: 'memory', id: f, title: displayName,
                  subtitle: typeMatch ? typeMatch[1].trim() : 'memory',
                })
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  const projectNames = Object.keys(index.sessionsByProject)
  for (const name of projectNames) {
    if (name.toLowerCase().includes(q)) {
      results.push({
        type: 'project', id: name, title: name,
        subtitle: `${(index.sessionsByProject[name] || []).length} sessions`,
      })
    }
  }

  return { results: results.slice(0, 30), query }
}
