import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const STATE_PATH = join(homedir(), '.claude', 'scripts', 'session-browser', 'companion-state.json')

const SPECIES = ['duck','goose','cat','dragon','octopus','owl','penguin','turtle','axolotl','capybara','robot','lobster','crab','fox','raccoon']
const RARITIES = ['common','uncommon','rare','epic','legendary']
const RARITY_WEIGHTS = [60, 25, 10, 4, 1]
const EYES = ['normal','sleepy','sparkle','determined','mischief']
const MOODS = ['happy','focused','sleepy','excited','grumpy','curious']
const SPECIES_EMOJI = { duck:'🦆', goose:'🪿', cat:'🐱', dragon:'🐉', octopus:'🐙', owl:'🦉', penguin:'🐧', turtle:'🐢', axolotl:'🦎', capybara:'🦫', robot:'🤖', lobster:'🦞', crab:'🦀', fox:'🦊', raccoon:'🦝' }

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickWeighted(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

function rollCompanion(seed) {
  const hash = typeof seed === 'string' ? fnv1a(seed) : seed
  const rng = mulberry32(hash)
  const species = SPECIES[Math.floor(rng() * SPECIES.length)]
  const rarity = pickWeighted(rng, RARITIES, RARITY_WEIGHTS)
  const eye = EYES[Math.floor(rng() * EYES.length)]
  const shiny = rng() < 0.05
  const stats = {
    debugging: Math.floor(rng() * 10) + 1,
    patience: Math.floor(rng() * 10) + 1,
    chaos: Math.floor(rng() * 10) + 1,
    wisdom: Math.floor(rng() * 10) + 1,
    snark: Math.floor(rng() * 10) + 1,
  }
  return { species, rarity, eye, shiny, stats }
}

function loadState() {
  if (!existsSync(STATE_PATH)) return null
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) } catch { return null }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

export function getCompanion() {
  let state = loadState()
  if (!state) {
    const username = process.env.USERNAME || process.env.USER || 'claude-user'
    const bones = rollCompanion(username)
    state = {
      ...bones,
      emoji: SPECIES_EMOJI[bones.species] || '🤖',
      soul: null,
      state: {
        mood: 'happy',
        xp: 0,
        level: 1,
        sessionsWitnessed: 0,
        bugsSquashed: 0,
        testsWritten: 0,
        lastActiveAt: Date.now(),
      },
    }
    saveState(state)
  }
  if (!state.emoji) state.emoji = SPECIES_EMOJI[state.species] || '🤖'
  return state
}

export function processCompanionEvent(eventType) {
  const XP_REWARDS = {
    session_start: 5, session_end: 10, bug_fixed: 25,
    test_written: 15, deploy: 50, error: 2, idle: 1,
  }
  const MOOD_EFFECTS = {
    session_start: 'excited', session_end: 'sleepy', bug_fixed: 'happy',
    test_written: 'focused', deploy: 'excited', error: 'grumpy', idle: 'sleepy',
  }
  const state = getCompanion()
  const xp = XP_REWARDS[eventType] || 0
  const newXp = state.state.xp + xp
  const newLevel = Math.floor(newXp / 100) + 1
  const counters = { ...state.state }
  counters.xp = newXp
  counters.level = newLevel
  counters.mood = MOOD_EFFECTS[eventType] || counters.mood
  counters.lastActiveAt = Date.now()
  if (eventType === 'session_start') counters.sessionsWitnessed++
  if (eventType === 'bug_fixed') counters.bugsSquashed++
  if (eventType === 'test_written') counters.testsWritten++

  const updated = { ...state, state: counters }
  saveState(updated)
  return { companion: updated, xpGained: xp, levelUp: newLevel > state.state.level }
}

const MANAGER_REMARKS = [
  'Nice refactor, clean diff.',
  'Ship it when you\'re ready.',
  'Good progress today.',
  'Tests green? Let\'s go.',
  'Solid commit message.',
  'That fix was quick, nice one.',
  'Clean architecture choice.',
  'PR looks good to me.',
  'Keep that momentum going.',
  'One step closer to done.',
  'Smart approach, I like it.',
  'Coverage looking healthy.',
  'No bugs in sight. For now.',
  'The pipeline thanks you.',
  'Another one off the board.',
  'Merge when ready, no rush.',
  'Looks production-ready to me.',
  'Good call on that edge case.',
  'The codebase is better for it.',
  'Steady hands, clean code.',
]

const PROMPT_TIPS = [
  'Be specific about what you want. "Fix the bug" vs "The login form returns 401 when password has special chars".',
  'Give context before the task. Tell me what the code does before asking me to change it.',
  'Break big tasks into steps. One clear instruction beats a wall of text.',
  'Show me the error message. "It doesn\'t work" is the hardest bug to fix.',
  'Tell me the WHY, not just the WHAT. Knowing the goal helps me pick the right approach.',
  'If my first answer misses, redirect don\'t restart. "No, I meant X" beats rephrasing the whole thing.',
  'Use examples. "Format it like this: ..." is worth 100 words of description.',
  'State constraints upfront. "Must work with Python 3.9" saves a rewrite later.',
  'Don\'t ask me to be careful, show me what to protect. "Don\'t break the auth flow" + the file path.',
  'Paste the relevant code snippet. I can\'t see your screen, but I can read what you paste.',
]

export function getCompanionVisuals() {
  const c = getCompanion()
  const rarityGlow = { common: 0.4, uncommon: 0.6, rare: 0.9, epic: 1.3, legendary: 1.8 }
  const rarityColor = { common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b' }
  const moodSpeed = { happy: 1.2, focused: 0.8, sleepy: 0.4, excited: 1.8, grumpy: 0.6, curious: 1.0 }
  const moodArmAmp = { happy: 0.12, focused: 0.06, sleepy: 0.03, excited: 0.2, grumpy: 0.04, curious: 0.1 }
  const levelScale = Math.min(1.0 + (c.state.level - 1) * 0.03, 1.5)
  const remark = MANAGER_REMARKS[Math.floor(Math.random() * MANAGER_REMARKS.length)]
  const tip = PROMPT_TIPS[Math.floor(Math.random() * PROMPT_TIPS.length)]
  return {
    species: c.species,
    emoji: c.emoji,
    rarity: c.rarity,
    mood: c.state.mood,
    level: c.state.level,
    xp: c.state.xp,
    shiny: c.shiny,
    eye: c.eye,
    glowIntensity: rarityGlow[c.rarity] || 0.4,
    glowColor: rarityColor[c.rarity] || '#9ca3af',
    animSpeed: moodSpeed[c.state.mood] || 1.0,
    armAmplitude: moodArmAmp[c.state.mood] || 0.08,
    scale: levelScale,
    name: c.soul?.name || 'Manager',
    stats: c.stats,
    remark,
    tip,
  }
}
