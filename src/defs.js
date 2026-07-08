// Data definitions: colors, enemy classes, weapons, shields, enhancements,
// cosmic mod library, bosses, shop prices. Logic lives in game.js.

export const COLORS = {
  cyan: 0x00f0ff,
  magenta: 0xff2fd6,
  orange: 0xff9f1c,
  yellow: 0xffe600,
  green: 0x39ff14,
  red: 0xff3355,
  white: 0xf4f4ff,
  purple: 0xb44dff,
}

// --- Shape outlines (unit scale) -----------------------------------------------
// Shared by game meshes (LineLoop geometry) and shop icons (SVG polygons).

export const SHAPES = {
  ship: [
    [0, 1.6],
    [1.2, -1.2],
    [0.5, -0.6],
    [-0.5, -0.6],
    [-1.2, -1.2],
  ],
  triangle: [
    [0, 1.2],
    [1, -1],
    [-1, -1],
  ],
  diamond: [
    [0, 1.3],
    [1, 0],
    [0, -1.3],
    [-1, 0],
  ],
  hexagon: Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    return [Math.cos(a) * 1.15, Math.sin(a) * 1.15]
  }),
  saucer: [
    [-1.6, 0],
    [-0.6, 0.7],
    [0.6, 0.7],
    [1.6, 0],
    [0.6, -0.5],
    [-0.6, -0.5],
  ],
  circle: Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2
    return [Math.cos(a), Math.sin(a)]
  }),
  square: [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ],
  chevron: [
    [0, 1.3],
    [1, 0.1],
    [0.45, 0.1],
    [0.45, -1.2],
    [-0.45, -1.2],
    [-0.45, 0.1],
    [-1, 0.1],
  ],
  cross: [
    [-0.4, 1.2],
    [0.4, 1.2],
    [0.4, 0.4],
    [1.2, 0.4],
    [1.2, -0.4],
    [0.4, -0.4],
    [0.4, -1.2],
    [-0.4, -1.2],
    [-0.4, -0.4],
    [-1.2, -0.4],
    [-1.2, 0.4],
    [-0.4, 0.4],
  ],
  star: Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    const r = i % 2 === 0 ? 1.35 : 0.55
    return [Math.cos(a) * r, Math.sin(a) * r]
  }),
}

// --- Enemy classes ------------------------------------------------------------
// hp > 1 classes show their remaining hits as a number inside the shape.

export const ENEMY_CLASSES = {
  grunt: { shape: 'triangle', color: COLORS.cyan, hp: 1, points: 10, credits: 1, scale: 2, radius: 2.6 },
  soldier: { shape: 'diamond', color: COLORS.magenta, hp: 2, points: 20, credits: 2, scale: 2, radius: 2.6 },
  brute: { shape: 'hexagon', color: COLORS.orange, hp: 3, points: 40, credits: 4, scale: 2, radius: 2.6 },
  // Goliaths take a 2x2 block of grid slots; hp scales with wave in game.js.
  goliath: { shape: 'hexagon', color: COLORS.purple, hp: 6, points: 100, credits: 10, scale: 4, radius: 5 },
}

// Row composition (top row first) per wave number.
export function rowsForWave(wave) {
  if (wave <= 1) return ['soldier', 'grunt', 'grunt', 'grunt', 'grunt']
  if (wave === 2) return ['soldier', 'soldier', 'grunt', 'grunt', 'grunt']
  if (wave === 3) return ['brute', 'soldier', 'soldier', 'grunt', 'grunt']
  return ['brute', 'brute', 'soldier', 'soldier', 'grunt']
}

export function goliathCount(wave) {
  if (wave < 4) return 0
  return Math.min(4, 1 + Math.floor((wave - 4) / 3))
}

export function goliathHp(wave) {
  return 5 + Math.floor(wave / 2)
}

// One extra grunt per wave, filling new centered rows below the grid.
export function extraGrunts(wave) {
  return Math.min(20, Math.max(0, wave - 1))
}

// --- Weapons ------------------------------------------------------------------
// All non-PULSE weapons are timed pickups drawn from the drop pool. Uniform
// model: pattern ('single'|'twin'|'tri'), flags are cosmic-mod ids
// ('homing', 'pierce').

export const WEAPONS = {
  pulse: { name: 'PULSE', pattern: 'single', damage: 1, cooldown: 0.22, speed: 110, color: COLORS.cyan, flags: [] },
  spread: { name: 'TRISHOT', pattern: 'tri', damage: 1, cooldown: 0.3, speed: 110, color: COLORS.green, flags: [] },
  lance: { name: 'LANCE', pattern: 'single', damage: 2, cooldown: 0.5, speed: 150, color: COLORS.cyan, flags: ['pierce'] },
  seeker: { name: 'SEEKER', pattern: 'twin', damage: 1, cooldown: 0.36, speed: 80, color: COLORS.orange, flags: ['homing'] },
  triseeker: { name: 'TRI-SEEKER', pattern: 'tri', damage: 1, cooldown: 0.42, speed: 80, color: COLORS.orange, flags: ['homing'] },
  trilance: { name: 'TRI-LANCE', pattern: 'tri', damage: 2, cooldown: 0.62, speed: 150, color: COLORS.cyan, flags: ['pierce'] },
  lanceseeker: { name: 'GHOST LANCE', pattern: 'twin', damage: 2, cooldown: 0.55, speed: 100, color: COLORS.magenta, flags: ['homing', 'pierce'] },
  omni: { name: 'OMNI CANNON', pattern: 'tri', damage: 2, cooldown: 0.5, speed: 120, color: COLORS.white, flags: ['homing', 'pierce'] },
}

export const BASE_POOL = ['spread', 'lance', 'seeker'] // in the drop pool from the start
export const COMBO_IDS = ['triseeker', 'trilance', 'lanceseeker', 'omni'] // shop unlocks

// Unique drop icon per weapon (shape + color pair never repeats). Families
// share a shape: tri-shots = triangle, lances = chevron, seekers = cross.
// Cosmics use a star in their rolled color; shields are circles.
export const WEAPON_ICONS = {
  spread: { shape: 'triangle', color: COLORS.green },
  lance: { shape: 'chevron', color: COLORS.cyan },
  seeker: { shape: 'cross', color: COLORS.orange },
  triseeker: { shape: 'cross', color: COLORS.yellow },
  trilance: { shape: 'chevron', color: COLORS.red },
  lanceseeker: { shape: 'diamond', color: COLORS.magenta },
  omni: { shape: 'hexagon', color: COLORS.white },
  pulse: { shape: 'square', color: COLORS.cyan },
}

export const SHIELDS = {
  aegis: { name: 'AEGIS', color: COLORS.cyan },
  reflect: { name: 'REFLECTOR', color: COLORS.yellow },
  nova: { name: 'NOVA', color: COLORS.magenta },
}
export const SHIELD_IDS = ['aegis', 'reflect', 'nova']

export const EQUIP_TIME = 12 // base seconds a weapon pickup lasts

// --- Enhancements (the money sink) ----------------------------------------------
// Per-weapon sub-items in the shop. Small increments, price scales per level.

export const CORE_ENH = {
  rate: { name: 'FIRE RATE', desc: '+10% fire rate', base: 30, max: 20 },
  damage: { name: 'DAMAGE', desc: '+10% damage', base: 40, max: 20 },
  time: { name: 'EQUIP TIME', desc: '+10% equip time', base: 25, max: 20 },
}

// One flavor enhancement per weapon family. `key` selects the effect.
export const UNIQUE_ENH = {
  pulse: { key: 'speed', name: 'VELOCITY', desc: '+15% shot speed', base: 60, max: 5 },
  spread: { key: 'shots', name: 'HYDRA', desc: '+1 projectile', base: 150, max: 3 },
  lance: { key: 'width', name: 'BROADSIDE', desc: '+20% shot size', base: 60, max: 5 },
  seeker: { key: 'turn', name: 'BLOODHOUND', desc: '+25% tracking', base: 60, max: 5 },
  triseeker: { key: 'turn', name: 'BLOODHOUND', desc: '+25% tracking', base: 80, max: 5 },
  trilance: { key: 'width', name: 'BROADSIDE', desc: '+20% shot size', base: 80, max: 5 },
  lanceseeker: { key: 'turn', name: 'BLOODHOUND', desc: '+25% tracking', base: 80, max: 5 },
  omni: { key: 'shots', name: 'HYDRA', desc: '+1 projectile', base: 200, max: 2 },
}

export function enhCost(base, level) {
  return Math.round(base * Math.pow(1.6, level))
}

// --- Cosmic weapon system --------------------------------------------------------
// A boss kill rolls 3 distinct mods from this library of 20 into a weapon.

export const COSMIC_MODS = {
  twin: { name: 'GEMINI', desc: '+1 parallel shot' },
  fan: { name: 'STARBURST', desc: '+2 fan shots' },
  homing: { name: 'VULTURE', desc: 'shots seek enemies' },
  pierce: { name: 'LANCER', desc: 'shots pierce through' },
  ricochet: { name: 'RICOCHET', desc: 'shots bounce off walls' },
  splitter: { name: 'MITOSIS', desc: 'kills split the shot in two' },
  chain: { name: 'ARC', desc: 'hits arc lightning to a nearby foe' },
  explosive: { name: 'PAYLOAD', desc: 'shots explode on impact' },
  giant: { name: 'TITAN', desc: 'huge shots, +1 damage' },
  rapid: { name: 'FRENZY', desc: '+40% fire rate' },
  heavy: { name: 'DREADNOUGHT', desc: '+2 damage, slower fire' },
  velocity: { name: 'RAILSHOT', desc: '+60% shot speed' },
  slow: { name: 'STASIS', desc: 'hits slow the swarm' },
  lucky: { name: 'MIDAS', desc: '+50% credits from kills' },
  jam: { name: 'SCRAMBLER', desc: 'hits can silence enemy guns' },
  volatile: { name: 'CASCADE', desc: 'kills damage nearby enemies' },
  phantom: { name: 'GHOST', desc: 'shots erase enemy fire' },
  overcharge: { name: 'CAPACITOR', desc: 'every 5th volley ×3 damage' },
  storm: { name: 'TEMPEST', desc: 'lightning strikes a foe every 3s' },
  nova: { name: 'SUPERNOVA', desc: 'kills detonate mini-novas' },
}

const COSMIC_PREFIXES = ['VOID', 'QUASAR', 'NEBULA', 'PULSAR', 'ECLIPSE', 'AURORA', 'ZENITH', 'SINGULARITY']
const COSMIC_NOUNS = ['REAPER', 'HERALD', 'LOTUS', 'SERPENT', 'CROWN', 'ENGINE', 'HYMN', 'FANG']
const COSMIC_COLORS = [COLORS.purple, COLORS.white, COLORS.yellow, COLORS.magenta, COLORS.green]

export function rollCosmic() {
  const pool = Object.keys(COSMIC_MODS)
  const mods = []
  while (mods.length < 3) {
    const pick = pool[Math.floor(Math.random() * pool.length)]
    if (!mods.includes(pick)) mods.push(pick)
  }
  const name =
    COSMIC_PREFIXES[Math.floor(Math.random() * COSMIC_PREFIXES.length)] +
    ' ' +
    COSMIC_NOUNS[Math.floor(Math.random() * COSMIC_NOUNS.length)]
  return {
    name,
    mods,
    color: COSMIC_COLORS[Math.floor(Math.random() * COSMIC_COLORS.length)],
    pattern: 'single',
    damage: 2,
    cooldown: 0.28,
    speed: 120,
    flags: [],
  }
}

// --- Bosses (every 10th wave, cycling) ---------------------------------------------

export const BOSSES = [
  {
    id: 'warden',
    name: 'THE WARDEN',
    shape: 'hexagon',
    color: COLORS.orange,
    special: 'snare',
    specialName: 'GRAVITON SNARE',
    specialInterval: 9,
  },
  {
    id: 'jammer',
    name: 'THE JAMMER',
    shape: 'diamond',
    color: COLORS.magenta,
    special: 'jam',
    specialName: 'EMP BURST',
    specialInterval: 9,
  },
  {
    id: 'phantom',
    name: 'THE PHANTOM',
    shape: 'diamond',
    color: COLORS.purple,
    special: 'teleport',
    specialName: 'BLINK SHIFT',
    specialInterval: 5,
  },
  {
    id: 'broodmother',
    name: 'THE BROODMOTHER',
    shape: 'triangle',
    color: COLORS.green,
    special: 'spawn',
    specialName: 'SPAWN SURGE',
    specialInterval: 9,
  },
  {
    id: 'bulwark',
    name: 'THE BULWARK',
    shape: 'hexagon',
    color: COLORS.cyan,
    special: 'shield',
    specialName: 'AEGIS WALL',
    specialInterval: 9,
  },
]

// --- Shop ---------------------------------------------------------------------------

export const PRICES = {
  triseeker: 350,
  trilance: 350,
  lanceseeker: 350,
  omni: 650,
  bunker: 120,
  bunkerUpgrade: 150,
  life: 250,
}

export const BUNKER_SLOTS = [-48, -16, 16, 48]
export const MAX_BUNKER_LEVEL = 3
export const MAX_LIVES = 5
