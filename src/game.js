// Game logic: enemy classes and goliaths, timed weapon drops + enhancements,
// shop, bunkers, bosses, powerups, UFO, collisions.
// World coordinates: x in [-80, 80], y in [-50, 50].

import * as THREE from 'three'
import {
  COLORS,
  SHAPES,
  WEAPON_ICONS,
  ENEMY_CLASSES,
  rowsForWave,
  goliathCount,
  goliathHp,
  extraGrunts,
  WEAPONS,
  BASE_POOL,
  COMBO_IDS,
  SHIELDS,
  SHIELD_IDS,
  EQUIP_TIME,
  CORE_ENH,
  UNIQUE_ENH,
  enhCost,
  COSMIC_MODS,
  rollCosmic,
  BOSSES,
  PRICES,
  BUNKER_SLOTS,
  MAX_BUNKER_LEVEL,
  MAX_LIVES,
} from './defs.js'

export const BOUNDS = { x: 80, y: 50 }
const PLAYER_Y = -42
const COLS = 10
const GRID_SPACING = 6.5

// Shape geometry built from the shared outline data in defs.js.
const GEO = {}
for (const [name, pts] of Object.entries(SHAPES)) {
  GEO[name] = new THREE.BufferGeometry().setFromPoints(
    pts.map(([x, y]) => new THREE.Vector3(x, y, 0))
  )
}

function makeOutline(shape, color, scale = 2) {
  const mesh = new THREE.LineLoop(GEO[shape], new THREE.LineBasicMaterial({ color }))
  mesh.scale.setScalar(scale)
  return mesh
}

function makeBolt(color, w, h) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
  )
}

// HP digit sprites (shared materials, cached per number).
const digitMats = new Map()
function digitMaterial(n) {
  if (digitMats.has(n)) return digitMats.get(n)
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  ctx.font = 'bold 40px "Courier New", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.fillText(String(n), 32, 34)
  const texture = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  digitMats.set(n, mat)
  return mat
}

function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0')
}

export class Game {
  constructor(scene, particles, rings, ui, keys) {
    this.scene = scene
    this.fx = particles
    this.rings = rings
    this.ui = ui
    this.keys = keys

    this.state = 'title' // title | playing | paused | shop | cosmic | gameover
    this.shake = 0
    this.score = 0
    this.hi = Number(localStorage.getItem('neonInvadersHi') || 0)
    this.credits = 0
    this.lives = 3
    this.wave = 0

    // Arsenal: PULSE is permanent; everything else is a timed drop from the
    // pool. Combos are shop-unlocked into the pool; cosmics join on claim.
    this.pool = [...BASE_POOL]
    this.cosmics = {} // id -> rolled cosmic def
    this.enh = {} // weaponId -> { rate, damage, time, unique }
    this.temp = null // { id, t } current timed weapon
    this.volleyCount = 0 // for CAPACITOR

    // Status effects
    this.slowT = 0 // player slowed (boss snare)
    this.jamT = 0 // player weapons disabled (boss EMP)
    this.enemySlowT = 0 // STASIS
    this.enemyJamT = 0 // SCRAMBLER
    this.stormT = 0 // TEMPEST tick

    this.invaders = []
    this.waveTotal = 1
    this.bullets = []
    this.enemyBullets = []
    this.powerups = []
    this.bunkers = []
    this.bunkerLevel = 1
    this.boss = null
    this.pendingCosmic = null
    this.lastShopWave = 0
    this.ufo = null
    this.ufoTimer = 8 + Math.random() * 8

    this.player = makeOutline('ship', COLORS.cyan, 1.8)
    this.player.position.set(0, PLAYER_Y, 0)
    scene.add(this.player)
    this.cooldown = 0
    this.invuln = 0
    this.shield = null // { id, hp?, t? }

    this.shieldRing = makeOutline('circle', COLORS.cyan, 4)
    this.shieldRing.visible = false
    scene.add(this.shieldRing)

    this.bossShieldRing = makeOutline('circle', COLORS.cyan, 11)
    this.bossShieldRing.visible = false
    scene.add(this.bossShieldRing)

    this.groupDir = 1
    this.waveDelay = 0
    this.fireTimer = 1

    this.updateLegend()
    ui.showOverlay(
      `<div style="font-size:44px;color:#fff;text-shadow:0 0 16px #0ff,0 0 40px #0ff">NEON INVADERS</div>` +
        `<div style="margin-top:16px;color:#9ff">←→ / AD MOVE &nbsp;·&nbsp; SPACE FIRE &nbsp;·&nbsp; P PAUSE</div>` +
        `<div style="margin-top:8px;color:#9ff">EARN ¤ · SHOP EVERY 5 WAVES · BOSSES EVERY 10</div>` +
        `<div style="margin-top:24px;color:#fff;text-shadow:0 0 10px #f2d">PRESS ENTER</div>`
    )
    this.refreshHud()
  }

  // --- Weapon helpers ----------------------------------------------------------

  weaponById(id) {
    return WEAPONS[id] || this.cosmics[id]
  }

  currentWeaponId() {
    return this.temp ? this.temp.id : 'pulse'
  }

  enhFor(id) {
    if (!this.enh[id]) this.enh[id] = { rate: 0, damage: 0, time: 0, unique: 0 }
    return this.enh[id]
  }

  uniqueDef(id) {
    return this.cosmics[id] ? null : UNIQUE_ENH[id] || null
  }

  equipTime(id) {
    return EQUIP_TIME * (1 + 0.1 * this.enhFor(id).time)
  }

  // Resolve pattern/damage/cooldown/speed with enhancements and cosmic mods.
  weaponStats() {
    const id = this.currentWeaponId()
    const def = this.weaponById(id)
    const enh = this.enhFor(id)
    const unique = this.uniqueDef(id)
    const mods = new Set([...def.flags, ...(def.mods || [])])
    let damage = def.damage * (1 + 0.1 * enh.damage)
    let cooldown = def.cooldown / (1 + 0.1 * enh.rate)
    let speed = def.speed
    let sizeMult = 1
    let turnMult = 1
    let extraShots = 0
    if (unique) {
      if (unique.key === 'speed') speed *= 1 + 0.15 * enh.unique
      if (unique.key === 'width') sizeMult *= 1 + 0.2 * enh.unique
      if (unique.key === 'turn') turnMult *= 1 + 0.25 * enh.unique
      if (unique.key === 'shots') extraShots = enh.unique
    }
    if (mods.has('giant')) {
      damage += 1
      sizeMult *= 2
    }
    if (mods.has('heavy')) {
      damage += 2
      cooldown *= 1.25
    }
    if (mods.has('rapid')) cooldown *= 0.7
    if (mods.has('velocity')) speed *= 1.6
    return { id, def, mods, damage, cooldown, speed, sizeMult, turnMult, extraShots }
  }

  // --- Flow --------------------------------------------------------------------

  start() {
    this.state = 'playing'
    this.ui.hideOverlay()
    this.nextWave()
  }

  handleKey(key) {
    if (key === 'enter') {
      if (this.state === 'title') this.start()
      else if (this.state === 'gameover') window.location.reload()
      else if (this.state === 'cosmic') this.claimCosmic()
      else if (this.state === 'shop') this.closeShop()
    }
    if (key === 'p' && (this.state === 'playing' || this.state === 'paused')) {
      this.state = this.state === 'paused' ? 'playing' : 'paused'
      if (this.state === 'paused') {
        this.ui.showOverlay('<div style="font-size:30px;color:#fff">PAUSED</div>')
      } else {
        this.ui.hideOverlay()
      }
    }
  }

  nextWave() {
    this.wave++
    this.groupDir = 1
    this.fireTimer = 1.2
    if (this.wave % 10 === 0) {
      this.spawnBoss()
    } else {
      this.ui.toast(`WAVE ${this.wave}`)
      this.spawnGrid()
    }
  }

  spawnGrid() {
    const rows = rowsForWave(this.wave)
    const cells = []
    for (let r = 0; r < rows.length; r++) cells.push(new Array(COLS).fill(rows[r]))

    // Goliaths consume 2x2 blocks of the grid.
    let goliaths = goliathCount(this.wave)
    let tries = 40
    const goliathSpots = []
    while (goliaths > 0 && tries-- > 0) {
      const r = Math.floor(Math.random() * (rows.length - 1))
      const c = Math.floor(Math.random() * (COLS - 1))
      if (cells[r][c] && cells[r][c + 1] && cells[r + 1][c] && cells[r + 1][c + 1]) {
        cells[r][c] = cells[r][c + 1] = cells[r + 1][c] = cells[r + 1][c + 1] = null
        goliathSpots.push([r, c])
        goliaths--
      }
    }

    const cellX = (c) => (c - (COLS - 1) / 2) * GRID_SPACING
    const cellY = (r) => 38 - r * 5.5

    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!cells[r][c]) continue
        this.addInvader(cells[r][c], cellX(c), cellY(r), null)
      }
    }
    for (const [r, c] of goliathSpots) {
      this.addInvader('goliath', (cellX(c) + cellX(c + 1)) / 2, (cellY(r) + cellY(r + 1)) / 2, goliathHp(this.wave))
    }

    // Extra grunts: one more per wave, on new centered rows below the grid.
    let extras = extraGrunts(this.wave)
    let row = rows.length
    while (extras > 0) {
      const n = Math.min(10, extras)
      extras -= n
      const y = cellY(row)
      for (let i = 0; i < n; i++) {
        this.addInvader('grunt', (i - (n - 1) / 2) * GRID_SPACING, y, null)
      }
      row++
    }

    this.waveTotal = this.invaders.length
  }

  addInvader(classId, x, y, hpOverride) {
    const def = ENEMY_CLASSES[classId]
    const mesh = makeOutline(def.shape, def.color, def.scale)
    mesh.position.set(x, y, 0)
    this.scene.add(mesh)
    const inv = { ...def, classId, mesh, hp: hpOverride || def.hp, maxHp: hpOverride || def.hp, hpSprite: null }
    if (inv.maxHp > 1) {
      // Number inside the shape = hits remaining.
      const sprite = new THREE.Sprite(digitMaterial(inv.hp))
      sprite.scale.setScalar(1.6)
      mesh.add(sprite)
      inv.hpSprite = sprite
    }
    this.invaders.push(inv)
  }

  gameOver() {
    this.state = 'gameover'
    this.player.visible = false
    this.shieldRing.visible = false
    this.bossShieldRing.visible = false
    this.ui.hideBossBar()
    if (this.score > this.hi) {
      this.hi = this.score
      localStorage.setItem('neonInvadersHi', String(this.hi))
    }
    this.ui.showOverlay(
      `<div style="font-size:38px;color:#f36;text-shadow:0 0 16px #f36">GAME OVER</div>` +
        `<div style="margin-top:14px;color:#fff">SCORE ${this.score} &nbsp;·&nbsp; HI ${this.hi}</div>` +
        `<div style="margin-top:20px;color:#9ff">PRESS ENTER TO RETRY</div>`
    )
  }

  // --- Update ---------------------------------------------------------------------

  update(dt) {
    if (this.state !== 'playing') return
    const p = this.player.position

    this.slowT = Math.max(0, this.slowT - dt)
    this.jamT = Math.max(0, this.jamT - dt)
    this.enemySlowT = Math.max(0, this.enemySlowT - dt)
    this.enemyJamT = Math.max(0, this.enemyJamT - dt)

    this.updatePlayer(dt, p)
    this.updateWeaponState(dt)
    this.updateStorm(dt)
    this.updateBullets(dt)
    this.updateEnemyBullets(dt, p)
    this.updateInvaders(dt, p)
    this.updateBoss(dt, p)
    this.updateUfo(dt)
    this.updatePowerups(dt, p)
    this.updateShieldRing(p)

    if (this.invaders.length === 0 && !this.boss && !this.ufo) {
      this.waveDelay += dt
      if (this.waveDelay > 1.2) {
        this.waveDelay = 0
        this.endOfWaveFlow()
      }
    } else {
      this.waveDelay = 0
    }
    this.refreshHud()
  }

  endOfWaveFlow() {
    if (this.pendingCosmic) {
      this.state = 'cosmic'
      this.ui.showCosmic(this.cosmicPresentation(this.pendingCosmic))
      return
    }
    if (this.wave % 5 === 0 && this.lastShopWave !== this.wave) {
      this.openShop()
      return
    }
    this.score += 100 * this.wave
    this.credits += Math.min(30, 5 + this.wave)
    this.nextWave()
  }

  updatePlayer(dt, p) {
    let dx = 0
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= 1
    if (this.keys.has('arrowright') || this.keys.has('d')) dx += 1
    const speed = 55 * (this.slowT > 0 ? 0.5 : 1)
    p.x = THREE.MathUtils.clamp(p.x + dx * speed * dt, -BOUNDS.x + 4, BOUNDS.x - 4)

    // Engine trail — heavier when moving.
    const trailN = dx !== 0 ? 3 : 2
    for (let i = 0; i < trailN; i++) {
      this.fx.spawn(
        p.x + (Math.random() - 0.5) * 1.4,
        p.y - 2.2,
        (Math.random() - 0.5) * 8,
        -24 - Math.random() * 12,
        0.4,
        0,
        0.7,
        1
      )
    }

    if (this.invuln > 0) {
      this.invuln -= dt
      this.player.visible = Math.floor(this.invuln * 10) % 2 === 0
    } else {
      this.player.visible = true
    }

    this.cooldown -= dt
    if (this.keys.has(' ') && this.cooldown <= 0 && this.jamT <= 0) this.fire(p)
  }

  fire(p) {
    const { def, mods, damage, cooldown, speed, sizeMult, extraShots } = this.weaponStats()
    this.cooldown = cooldown
    this.volleyCount++
    const overcharged = mods.has('overcharge') && this.volleyCount % 5 === 0
    const dmg = overcharged ? damage * 3 : damage

    // Build the volley: pattern base + HYDRA/GEMINI/STARBURST additions.
    const shots = [] // { angle, offsetX }
    if (def.pattern === 'single') shots.push({ angle: 0, offsetX: 0 })
    else if (def.pattern === 'twin') shots.push({ angle: 0, offsetX: -1.2 }, { angle: 0, offsetX: 1.2 })
    else if (def.pattern === 'tri')
      shots.push({ angle: 0, offsetX: 0 }, { angle: 0.24, offsetX: 0 }, { angle: -0.24, offsetX: 0 })
    for (let i = 0; i < extraShots; i++) {
      const side = i % 2 === 0 ? -1 : 1
      shots.push({ angle: 0, offsetX: side * (2.2 + Math.floor(i / 2) * 2.2) })
    }
    if (mods.has('twin')) {
      for (const s of [...shots]) shots.push({ angle: s.angle, offsetX: s.offsetX + 2.2 })
    }
    if (mods.has('fan')) shots.push({ angle: 0.45, offsetX: 0 }, { angle: -0.45, offsetX: 0 })

    const color = overcharged ? COLORS.white : def.color
    for (const s of shots) {
      const mesh = makeBolt(color, 0.45 * sizeMult, 2.6 * sizeMult)
      mesh.position.set(p.x + s.offsetX, p.y + 2.5, 0)
      this.scene.add(mesh)
      this.bullets.push({
        mesh,
        vx: Math.sin(s.angle) * speed,
        vy: Math.cos(s.angle) * speed,
        damage: dmg,
        mods,
        radius: 1 + sizeMult * 0.6,
        bounces: 0,
        hit: mods.has('pierce') ? new Set() : null,
      })
    }
    // Muzzle flash
    this.fx.burst(p.x, p.y + 2.5, def.color, 6, 5, 25, 0.1, 0.25)
  }

  updateWeaponState(dt) {
    if (this.temp) {
      this.temp.t -= dt
      if (this.temp.t <= 0) {
        this.temp = null
        this.ui.toast('PULSE RESTORED')
      }
    }
    if (this.shield && this.shield.id === 'reflect') {
      this.shield.t -= dt
      if (this.shield.t <= 0) this.shield = null
    }
  }

  updateStorm(dt) {
    const { mods } = this.weaponStats()
    if (!mods.has('storm')) return
    this.stormT -= dt
    if (this.stormT > 0) return
    this.stormT = 3
    const targets = [...this.invaders]
    if (this.boss) targets.push(this.boss)
    if (targets.length === 0) return
    const t = targets[Math.floor(Math.random() * targets.length)]
    const pos = t.mesh.position
    this.fx.beam(pos.x, BOUNDS.y, pos.x, pos.y, COLORS.yellow, 22)
    this.fx.burst(pos.x, pos.y, COLORS.yellow, 25, 10, 45, 0.2, 0.6)
    this.rings.spawn(pos.x, pos.y, COLORS.yellow, 5, 0.35)
    this.shake = Math.max(this.shake, 0.3)
    if (t === this.boss) this.damageBoss(2)
    else this.damageInvaderObj(t, 2, null)
  }

  // --- Bullets ------------------------------------------------------------------------

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      if (b.mods && b.mods.has('homing')) this.steerHoming(b, dt)

      b.mesh.position.x += b.vx * dt
      b.mesh.position.y += b.vy * dt
      b.mesh.rotation.z = Math.atan2(b.vy, b.vx) - Math.PI / 2
      this.fx.spawn(b.mesh.position.x, b.mesh.position.y, 0, 0, 0.3, 0, 0.5, 0.7)

      // RICOCHET: bounce off side walls (twice max).
      if (b.mods && b.mods.has('ricochet') && b.bounces < 2 && Math.abs(b.mesh.position.x) > BOUNDS.x - 1) {
        b.vx = -b.vx
        b.bounces++
        this.fx.burst(b.mesh.position.x, b.mesh.position.y, COLORS.white, 8, 5, 20, 0.15, 0.3)
      }

      if (
        Math.abs(b.mesh.position.y) > BOUNDS.y + 4 ||
        Math.abs(b.mesh.position.x) > BOUNDS.x + 4
      ) {
        this.removeBullet(i)
        continue
      }

      // Your own shots carve through your own bunkers (classic rules — cut a
      // firing slit or lose the shot).
      if (b.vy > 0 && this.hitBunker(b.mesh.position)) {
        this.removeBullet(i)
        continue
      }

      // GHOST: erase enemy fire on contact.
      if (b.mods && b.mods.has('phantom')) {
        for (let j = this.enemyBullets.length - 1; j >= 0; j--) {
          if (b.mesh.position.distanceTo(this.enemyBullets[j].mesh.position) < 1.6) {
            this.fx.burst(this.enemyBullets[j].mesh.position.x, this.enemyBullets[j].mesh.position.y, COLORS.white, 6, 4, 16, 0.1, 0.3)
            this.scene.remove(this.enemyBullets[j].mesh)
            this.enemyBullets.splice(j, 1)
          }
        }
      }

      this.hitTargets(b, i)
    }
  }

  steerHoming(b, dt) {
    const targets = [...this.invaders]
    if (this.boss) targets.push(this.boss)
    if (targets.length === 0) return
    let nearest = null
    let best = Infinity
    for (const t of targets) {
      const d = b.mesh.position.distanceToSquared(t.mesh.position)
      if (d < best) {
        best = d
        nearest = t
      }
    }
    const { turnMult } = this.weaponStats()
    const steer = 5 * turnMult
    const speed = Math.hypot(b.vx, b.vy)
    const tx = nearest.mesh.position.x - b.mesh.position.x
    const ty = nearest.mesh.position.y - b.mesh.position.y
    const td = Math.hypot(tx, ty) || 1
    b.vx += ((tx / td) * speed - b.vx) * Math.min(1, steer * dt)
    b.vy += ((ty / td) * speed - b.vy) * Math.min(1, steer * dt)
    const norm = speed / (Math.hypot(b.vx, b.vy) || 1)
    b.vx *= norm
    b.vy *= norm
  }

  hitTargets(b, bulletIndex) {
    // Invaders
    for (let j = this.invaders.length - 1; j >= 0; j--) {
      const inv = this.invaders[j]
      if (b.hit && b.hit.has(inv)) continue
      if (b.mesh.position.distanceTo(inv.mesh.position) < inv.radius + (b.radius - 1)) {
        this.onHit(b, inv.mesh.position)
        this.damageInvaderObj(inv, b.damage, b.mods)
        if (b.hit) {
          b.hit.add(inv)
        } else {
          this.removeBullet(bulletIndex)
          return
        }
      }
    }
    // Boss
    if (
      this.boss &&
      !(b.hit && b.hit.has(this.boss)) &&
      b.mesh.position.distanceTo(this.boss.mesh.position) < this.boss.radius
    ) {
      this.onHit(b, this.boss.mesh.position)
      this.damageBoss(b.damage)
      if (b.hit) {
        b.hit.add(this.boss)
      } else {
        this.removeBullet(bulletIndex)
        return
      }
    }
    // UFO
    if (this.ufo && b.mesh.position.distanceTo(this.ufo.mesh.position) < 3.2) {
      this.score += 150
      this.credits += this.creditGain(25)
      this.ui.toast(`+150 · ¤${this.creditGain(25)}`)
      this.fx.burst(this.ufo.mesh.position.x, this.ufo.mesh.position.y, COLORS.green, 90, 10, 60)
      this.rings.spawn(this.ufo.mesh.position.x, this.ufo.mesh.position.y, COLORS.green, 8, 0.5)
      this.dropPowerup(this.ufo.mesh.position)
      this.scene.remove(this.ufo.mesh)
      this.ufo = null
      this.shake = Math.max(this.shake, 0.6)
      if (!b.hit) this.removeBullet(bulletIndex)
    }
  }

  // On-hit cosmic effects (fire regardless of kill).
  onHit(b, pos) {
    this.fx.burst(pos.x, pos.y, COLORS.white, 8, 4, 20, 0.1, 0.3)
    if (!b.mods) return
    if (b.mods.has('explosive')) {
      this.fx.burst(pos.x, pos.y, COLORS.orange, 30, 10, 50, 0.3, 0.7)
      this.rings.spawn(pos.x, pos.y, COLORS.orange, 6, 0.4)
      this.shake = Math.max(this.shake, 0.3)
      this.aoeDamage(pos, 6, 1)
    }
    if (b.mods.has('chain')) {
      let nearest = null
      let best = Infinity
      for (const inv of this.invaders) {
        const d = inv.mesh.position.distanceToSquared(pos)
        if (d > 1 && d < best && d < 400) {
          best = d
          nearest = inv
        }
      }
      if (nearest) {
        this.fx.beam(pos.x, pos.y, nearest.mesh.position.x, nearest.mesh.position.y, COLORS.cyan)
        this.damageInvaderObj(nearest, 1, null)
      }
    }
    if (b.mods.has('slow')) this.enemySlowT = 3
    if (b.mods.has('jam') && Math.random() < 0.25) {
      this.enemyJamT = 2
      this.ui.toast('ENEMY GUNS SILENCED')
    }
  }

  damageInvaderObj(inv, dmg, killerMods) {
    const idx = this.invaders.indexOf(inv)
    if (idx === -1) return
    inv.hp -= dmg
    if (inv.hp <= 0) {
      this.killInvader(idx, killerMods)
    } else {
      if (inv.hpSprite) inv.hpSprite.material = digitMaterial(Math.max(1, Math.ceil(inv.hp)))
      this.fx.burst(inv.mesh.position.x, inv.mesh.position.y, inv.color, 12, 5, 28, 0.2, 0.5)
    }
  }

  aoeDamage(pos, radius, dmg) {
    for (const inv of [...this.invaders]) {
      const d = inv.mesh.position.distanceTo(pos)
      if (d > 0.01 && d < radius) this.damageInvaderObj(inv, dmg, null)
    }
  }

  killInvader(index, killerMods) {
    const inv = this.invaders[index]
    const pos = inv.mesh.position.clone()
    this.score += inv.points
    this.credits += this.creditGain(inv.credits)
    const big = inv.classId === 'goliath'
    this.fx.burst(pos.x, pos.y, inv.color, big ? 150 : 70, 8, big ? 70 : 55)
    this.rings.spawn(pos.x, pos.y, inv.color, big ? 12 : 6, big ? 0.6 : 0.4)
    this.shake = Math.max(this.shake, big ? 0.7 : 0.3)
    if (Math.random() < 0.12) this.dropPowerup(pos)
    this.scene.remove(inv.mesh)
    this.invaders.splice(index, 1)

    // On-kill cosmic effects (only from direct weapon kills — no chain reactions).
    if (!killerMods) return
    if (killerMods.has('volatile')) this.aoeDamage(pos, 10, 1)
    if (killerMods.has('nova')) {
      this.fx.burst(pos.x, pos.y, COLORS.magenta, 40, 15, 60, 0.3, 0.8)
      this.rings.spawn(pos.x, pos.y, COLORS.magenta, 7, 0.45)
      this.aoeDamage(pos, 8, 1)
    }
    if (killerMods.has('splitter')) {
      for (const angle of [-0.5, 0.5]) {
        const mesh = makeBolt(COLORS.white, 0.4, 1.8)
        mesh.position.copy(pos)
        this.scene.add(mesh)
        this.bullets.push({
          mesh,
          vx: Math.sin(angle) * 90,
          vy: Math.cos(angle) * 90,
          damage: 1,
          mods: null,
          radius: 1,
          bounces: 0,
          hit: null,
        })
      }
    }
  }

  creditGain(base) {
    const { mods } = this.weaponStats()
    return mods.has('lucky') ? Math.ceil(base * 1.5) : base
  }

  removeBullet(i) {
    this.scene.remove(this.bullets[i].mesh)
    this.bullets.splice(i, 1)
  }

  // --- Invader grid ----------------------------------------------------------------------

  updateInvaders(dt, p) {
    if (this.invaders.length === 0) return
    const slowMult = this.enemySlowT > 0 ? 0.5 : 1
    const speed =
      Math.min(45, (6 + this.wave * 2) * (1 + 2 * Math.max(0, 1 - this.invaders.length / this.waveTotal))) *
      this.groupDir *
      slowMult

    let min = Infinity
    let max = -Infinity
    for (const inv of this.invaders) {
      inv.mesh.position.x += speed * dt
      min = Math.min(min, inv.mesh.position.x)
      max = Math.max(max, inv.mesh.position.x)
    }
    if ((max > BOUNDS.x - 5 && this.groupDir > 0) || (min < -BOUNDS.x + 5 && this.groupDir < 0)) {
      this.groupDir *= -1
      for (const inv of this.invaders) inv.mesh.position.y -= 2.2
    }

    // Invaders grind through bunker segments they touch.
    for (const inv of this.invaders) {
      if (inv.mesh.position.y < -24) this.crushBunkers(inv.mesh.position, inv.radius)
    }

    // Breach: invaders reached the player's line.
    for (const inv of this.invaders) {
      if (inv.mesh.position.y < PLAYER_Y + 6) {
        this.ui.toast('LINE BREACHED')
        for (const other of this.invaders) other.mesh.position.y += 18
        this.loseLife(p)
        break
      }
    }

    this.fireTimer -= dt * slowMult
    if (this.fireTimer <= 0 && this.enemyJamT <= 0) {
      this.fireTimer = Math.max(0.3, 1.15 - this.wave * 0.05)
      this.invaderFire(p)
    }
  }

  invaderFire(p) {
    // Fire from the bottom-most invader of a random occupied column.
    const byCol = new Map()
    for (const inv of this.invaders) {
      const col = Math.round(inv.mesh.position.x / GRID_SPACING)
      const cur = byCol.get(col)
      if (!cur || inv.mesh.position.y < cur.mesh.position.y) byCol.set(col, inv)
    }
    const shooters = [...byCol.values()]
    const shooter = shooters[Math.floor(Math.random() * shooters.length)]
    const pos = shooter.mesh.position
    const speed = 32 + this.wave * 2
    let vx = (Math.random() - 0.5) * 8
    if (Math.random() < 0.3) {
      const d = Math.hypot(p.x - pos.x, p.y - pos.y) || 1
      vx = ((p.x - pos.x) / d) * speed * 0.6
    }
    this.spawnEnemyBullet(pos.x, pos.y - 2, vx, -speed)
  }

  spawnEnemyBullet(x, y, vx, vy, big = false) {
    const mesh = makeBolt(COLORS.magenta, big ? 1.1 : 0.7, big ? 2.4 : 1.6)
    mesh.position.set(x, y, 0)
    this.scene.add(mesh)
    this.enemyBullets.push({ mesh, vx, vy })
  }

  updateEnemyBullets(dt, p) {
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i]
      b.mesh.position.x += b.vx * dt
      b.mesh.position.y += b.vy * dt
      this.fx.spawn(b.mesh.position.x, b.mesh.position.y, 0, 0, 0.25, 0.6, 0, 0.5)

      if (b.mesh.position.y < -BOUNDS.y - 3 || Math.abs(b.mesh.position.x) > BOUNDS.x + 6) {
        this.scene.remove(b.mesh)
        this.enemyBullets.splice(i, 1)
        continue
      }

      // Bunkers soak enemy fire.
      if (this.hitBunker(b.mesh.position)) {
        this.scene.remove(b.mesh)
        this.enemyBullets.splice(i, 1)
        continue
      }

      const dist = Math.hypot(b.mesh.position.x - p.x, b.mesh.position.y - p.y)

      // Reflector converts incoming fire into your own.
      if (this.shield && this.shield.id === 'reflect' && dist < 5) {
        const bx = b.mesh.position.x
        const by = b.mesh.position.y
        this.scene.remove(b.mesh)
        this.enemyBullets.splice(i, 1)
        const mesh = makeBolt(COLORS.yellow, 0.45, 2.6)
        mesh.position.set(bx, by, 0)
        this.scene.add(mesh)
        this.bullets.push({ mesh, vx: -b.vx * 0.4, vy: 95, damage: 1, mods: null, radius: 1, bounces: 0, hit: null })
        this.fx.burst(bx, by, COLORS.yellow, 10, 5, 22, 0.2, 0.4)
        continue
      }

      if (dist < 2.2 && this.invuln <= 0) {
        this.scene.remove(b.mesh)
        this.enemyBullets.splice(i, 1)
        this.playerHit(p)
      }
    }
  }

  // --- Bunkers (classic stationary shields) ---------------------------------------------

  buildBunker(slotIndex) {
    const bx = BUNKER_SLOTS[slotIndex]
    const segments = []
    const maxHp = this.bunkerLevel + 1
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 7; c++) {
        if (r === 0 && c >= 2 && c <= 4) continue // classic arch notch
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1.4, 1.4),
          new THREE.MeshBasicMaterial({ color: COLORS.green, transparent: true, opacity: 0.9 })
        )
        mesh.position.set(bx + (c - 3) * 1.5, -33 + r * 1.5, 0)
        this.scene.add(mesh)
        segments.push({ mesh, hp: maxHp })
      }
    }
    this.bunkers[slotIndex] = { segments }
  }

  hitBunker(pos) {
    if (pos.y < -36 || pos.y > -28) return false
    for (const bunker of this.bunkers) {
      if (!bunker) continue
      for (let i = bunker.segments.length - 1; i >= 0; i--) {
        const seg = bunker.segments[i]
        if (
          Math.abs(seg.mesh.position.x - pos.x) < 1.1 &&
          Math.abs(seg.mesh.position.y - pos.y) < 1.1
        ) {
          seg.hp--
          this.fx.burst(seg.mesh.position.x, seg.mesh.position.y, COLORS.green, 10, 4, 22, 0.15, 0.4)
          if (seg.hp <= 0) {
            this.scene.remove(seg.mesh)
            bunker.segments.splice(i, 1)
          } else {
            seg.mesh.material.opacity = 0.3 + (0.6 * seg.hp) / (this.bunkerLevel + 1)
          }
          return true
        }
      }
    }
    return false
  }

  crushBunkers(pos, radius) {
    for (const bunker of this.bunkers) {
      if (!bunker) continue
      for (let i = bunker.segments.length - 1; i >= 0; i--) {
        const seg = bunker.segments[i]
        if (seg.mesh.position.distanceTo(pos) < radius + 1) {
          this.fx.burst(seg.mesh.position.x, seg.mesh.position.y, COLORS.green, 14, 6, 30, 0.2, 0.5)
          this.scene.remove(seg.mesh)
          bunker.segments.splice(i, 1)
        }
      }
    }
  }

  // --- Boss ------------------------------------------------------------------------------

  spawnBoss() {
    const bossIndex = this.wave / 10 - 1
    const def = BOSSES[bossIndex % BOSSES.length]
    const mesh = makeOutline(def.shape, def.color, 8)
    mesh.position.set(0, 30, 0)
    this.scene.add(mesh)
    this.boss = {
      ...def,
      mesh,
      radius: 9.5,
      hp: 80 + 60 * bossIndex,
      maxHp: 80 + 60 * bossIndex,
      shieldHp: 0,
      t: 0,
      fireT: 2,
      fireMode: 0,
      specialT: 6,
      telegraphT: 0,
    }
    this.ui.toast(`⚠ ${def.name} ⚠`)
    this.shake = Math.max(this.shake, 0.8)
    this.rings.spawn(0, 30, def.color, 14, 0.8)
  }

  updateBoss(dt, p) {
    const boss = this.boss
    if (!boss) {
      this.bossShieldRing.visible = false
      return
    }
    boss.t += dt
    const slowMult = this.enemySlowT > 0 ? 0.5 : 1
    boss.mesh.position.x = boss.homeX !== undefined
      ? boss.homeX + Math.sin(boss.t * 0.8 * slowMult) * 12
      : Math.sin(boss.t * 0.5 * slowMult) * 45
    boss.mesh.position.y = (boss.homeY || 30) + Math.sin(boss.t * 1.3) * 4
    boss.mesh.rotation.z += dt * 0.4

    // Menace aura
    const auraColor = new THREE.Color(boss.color)
    this.fx.spawn(
      boss.mesh.position.x + (Math.random() - 0.5) * 14,
      boss.mesh.position.y + (Math.random() - 0.5) * 14,
      0,
      -6,
      0.5,
      auraColor.r * 0.5,
      auraColor.g * 0.5,
      auraColor.b * 0.5
    )

    // AEGIS WALL visual
    if (boss.shieldHp > 0) {
      boss.shieldT -= dt
      if (boss.shieldT <= 0) {
        boss.shieldHp = 0
      } else {
        this.bossShieldRing.visible = true
        this.bossShieldRing.position.copy(boss.mesh.position)
        this.bossShieldRing.rotation.z -= dt * 1.5
        this.bossShieldRing.material.color.setHex(COLORS.cyan)
        this.bossShieldRing.material.transparent = true
        this.bossShieldRing.material.opacity = 0.5 + 0.3 * Math.sin(boss.t * 6)
      }
    }
    if (boss.shieldHp <= 0) this.bossShieldRing.visible = false

    // Regular fire: alternating radial burst / aimed volley.
    boss.fireT -= dt * slowMult
    if (boss.fireT <= 0 && this.enemyJamT <= 0) {
      boss.fireT = Math.max(0.9, 1.6 - (this.wave / 10) * 0.1)
      boss.fireMode = 1 - boss.fireMode
      const pos = boss.mesh.position
      if (boss.fireMode === 0) {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2
          this.spawnEnemyBullet(pos.x, pos.y, Math.cos(a) * 26, Math.sin(a) * 26, true)
        }
      } else {
        for (const spread of [-0.2, 0, 0.2]) {
          const angle = Math.atan2(p.y - pos.y, p.x - pos.x) + spread
          this.spawnEnemyBullet(pos.x, pos.y, Math.cos(angle) * 42, Math.sin(angle) * 42, true)
        }
      }
    }

    // Special attack with a 1.2s converging-particle telegraph.
    boss.specialT -= dt
    if (boss.specialT <= 0 && boss.telegraphT <= 0) {
      boss.telegraphT = 1.2
      this.ui.toast(`${boss.specialName} CHARGING`)
    }
    if (boss.telegraphT > 0) {
      boss.telegraphT -= dt
      const pos = boss.mesh.position
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 14
        this.fx.spawn(
          pos.x + Math.cos(a) * r,
          pos.y + Math.sin(a) * r,
          -Math.cos(a) * 20,
          -Math.sin(a) * 20,
          0.5,
          1,
          1,
          0.4
        )
      }
      if (boss.telegraphT <= 0) {
        boss.specialT = boss.specialInterval
        this.bossSpecial(boss, p)
      }
    }

    this.ui.bossBar(
      boss.name + (boss.shieldHp > 0 ? ` 🛡${Math.ceil(boss.shieldHp)}` : ''),
      boss.hp / boss.maxHp,
      hexCss(boss.color)
    )
  }

  bossSpecial(boss, p) {
    const pos = boss.mesh.position
    this.shake = Math.max(this.shake, 0.9)
    this.rings.spawn(pos.x, pos.y, boss.color, 16, 0.7)
    if (boss.special === 'snare') {
      this.slowT = 5
      this.fx.beam(pos.x, pos.y, p.x, p.y, COLORS.yellow, 30)
      this.ui.toast('GRAVITON SNARE — SPEED HALVED')
    } else if (boss.special === 'jam') {
      this.jamT = 4
      this.fx.burst(p.x, p.y, COLORS.magenta, 40, 10, 50, 0.3, 0.8)
      this.ui.toast('EMP BURST — WEAPONS OFFLINE')
    } else if (boss.special === 'teleport') {
      this.fx.burst(pos.x, pos.y, boss.color, 80, 15, 60, 0.3, 0.8)
      this.rings.spawn(pos.x, pos.y, boss.color, 10, 0.5)
      boss.homeX = (Math.random() - 0.5) * 90
      boss.homeY = 24 + Math.random() * 14
      boss.t = 0 // restart sway around the new anchor
      boss.mesh.position.set(boss.homeX, boss.homeY, 0)
      this.fx.burst(boss.homeX, boss.homeY, COLORS.white, 60, 10, 50, 0.2, 0.6)
      this.rings.spawn(boss.homeX, boss.homeY, COLORS.white, 8, 0.4)
      this.ui.toast('BLINK SHIFT')
    } else if (boss.special === 'spawn') {
      this.ui.toast('SPAWN SURGE')
      if (this.invaders.length < 24) {
        for (let i = 0; i < 8; i++) {
          const x = -30 + i * 8.5
          this.addInvader('grunt', x, 38, null)
          this.fx.burst(x, 38, COLORS.green, 15, 5, 30, 0.2, 0.5)
        }
        this.waveTotal = Math.max(this.waveTotal, this.invaders.length)
      }
    } else if (boss.special === 'shield') {
      boss.shieldHp = 25 + 10 * (this.wave / 10 - 1)
      boss.shieldT = 8
      this.ui.toast('AEGIS WALL RAISED')
    }
  }

  damageBoss(dmg) {
    const boss = this.boss
    if (!boss) return
    if (boss.shieldHp > 0) {
      boss.shieldHp -= dmg
      this.fx.burst(boss.mesh.position.x, boss.mesh.position.y, COLORS.cyan, 12, 8, 35, 0.2, 0.5)
      if (boss.shieldHp <= 0) {
        this.ui.toast('WALL SHATTERED')
        this.fx.burst(boss.mesh.position.x, boss.mesh.position.y, COLORS.cyan, 60, 15, 55, 0.3, 0.8)
        this.rings.spawn(boss.mesh.position.x, boss.mesh.position.y, COLORS.cyan, 12, 0.5)
      }
      return
    }
    boss.hp -= dmg
    this.fx.burst(boss.mesh.position.x, boss.mesh.position.y, boss.color, 10, 5, 30, 0.2, 0.5)
    if (boss.hp <= 0) this.killBoss()
  }

  killBoss() {
    const boss = this.boss
    const pos = boss.mesh.position
    this.score += 500
    this.credits += this.creditGain(150)
    this.ui.toast(`${boss.name} DESTROYED · ¤${this.creditGain(150)}`)
    // Death spectacle
    this.fx.burst(pos.x, pos.y, boss.color, 250, 10, 90, 0.6, 1.8)
    this.fx.burst(pos.x, pos.y, COLORS.white, 120, 20, 70, 0.4, 1.2)
    this.rings.spawn(pos.x, pos.y, boss.color, 20, 0.9)
    this.rings.spawn(pos.x, pos.y, COLORS.white, 12, 0.6)
    this.shake = 1.8
    this.scene.remove(boss.mesh)
    this.boss = null
    this.bossShieldRing.visible = false
    this.ui.hideBossBar()
    this.pendingCosmic = rollCosmic()
  }

  // --- Cosmic reveal ------------------------------------------------------------------------

  cosmicPresentation(cosmic) {
    // Dry-run the stat math for display (fresh weapon = no enhancements yet).
    const mods = new Set(cosmic.mods)
    let damage = cosmic.damage
    let cooldown = cosmic.cooldown
    if (mods.has('giant')) damage += 1
    if (mods.has('heavy')) {
      damage += 2
      cooldown *= 1.25
    }
    if (mods.has('rapid')) cooldown *= 0.7
    let shots = 1
    if (mods.has('twin')) shots *= 2
    if (mods.has('fan')) shots += 2
    return {
      name: cosmic.name,
      colorCss: hexCss(cosmic.color),
      mods: cosmic.mods.map((id) => COSMIC_MODS[id]),
      stats: [
        { k: 'DMG', v: damage },
        { k: 'RATE', v: (1 / cooldown).toFixed(1) + '/s' },
        { k: 'SHOTS', v: shots },
        { k: 'EQUIP', v: EQUIP_TIME + 's' },
      ],
    }
  }

  claimCosmic() {
    const id = 'cosmic' + (Object.keys(this.cosmics).length + 1)
    this.cosmics[id] = this.pendingCosmic
    this.pool.push(id)
    this.pendingCosmic = null
    this.updateLegend()
    this.temp = { id, t: this.equipTime(id) } // hand it over hot
    this.ui.hideOverlay()
    this.state = 'playing'
    this.ui.toast(`${this.cosmics[id].name} — ADDED TO DROP POOL`)
    // endOfWaveFlow continues next frame (shop check / next wave).
  }

  // --- Shop -----------------------------------------------------------------------------------

  openShop() {
    this.state = 'shop'
    this.lastShopWave = this.wave
    this.renderShop()
  }

  renderShop() {
    this.ui.showShop(
      this.shopData(),
      (id) => this.shopAction(id),
      () => this.closeShop()
    )
  }

  closeShop() {
    this.ui.hideOverlay()
    this.state = 'playing'
    // endOfWaveFlow proceeds to the next wave on the following frames.
  }

  shopData() {
    const sections = []

    // Combo unlocks — bought weapons join the drop pool.
    const combos = []
    for (const id of COMBO_IDS) {
      if (this.pool.includes(id)) continue
      combos.push({
        id: 'unlock_' + id,
        label: WEAPONS[id].name,
        icon: this.dropIcon(id, false),
        desc: this.weaponDesc(id) + ' · joins the drop pool',
        price: PRICES[id],
        disabled: this.credits < PRICES[id],
      })
    }
    sections.push({ title: 'COMBINE WEAPONS', items: combos })

    // Per-weapon enhancement sub-items.
    const enhIds = ['pulse', ...this.pool]
    for (const wid of enhIds) {
      const def = this.weaponById(wid)
      const enh = this.enhFor(wid)
      const items = []
      for (const [key, coreDef] of Object.entries(CORE_ENH)) {
        if (wid === 'pulse' && key === 'time') continue // pulse is always equipped
        const lvl = enh[key]
        if (lvl >= coreDef.max) continue
        const price = enhCost(coreDef.base, lvl)
        items.push({
          id: `enh_${wid}_${key}`,
          label: `${coreDef.name} +`,
          desc: `${coreDef.desc} (lv ${lvl})`,
          price,
          disabled: this.credits < price,
        })
      }
      const unique = this.uniqueDef(wid)
      if (unique && enh.unique < unique.max) {
        const price = enhCost(unique.base, enh.unique)
        items.push({
          id: `enh_${wid}_unique`,
          label: `${unique.name} +`,
          desc: `${unique.desc} (lv ${enh.unique})`,
          price,
          disabled: this.credits < price,
        })
      }
      if (items.length > 0) {
        sections.push({ title: `ENHANCE — ${def.name}`, icon: this.dropIcon(wid, false), items })
      }
    }

    // Defense
    const defense = []
    const emptySlot = BUNKER_SLOTS.findIndex(
      (_, i) => !this.bunkers[i] || this.bunkers[i].segments.length === 0
    )
    if (emptySlot !== -1) {
      defense.push({
        id: 'buy_bunker',
        label: 'BUNKER',
        desc: 'classic stationary shield — your own shots carve it too',
        price: PRICES.bunker,
        disabled: this.credits < PRICES.bunker,
      })
    }
    if (this.bunkerLevel < MAX_BUNKER_LEVEL && this.bunkers.some((b) => b && b.segments.length)) {
      defense.push({
        id: 'up_bunker',
        label: `REINFORCE BUNKERS ${['', 'II', 'III'][this.bunkerLevel]}`,
        desc: 'repair all bunkers and +1 hp per segment',
        price: PRICES.bunkerUpgrade,
        disabled: this.credits < PRICES.bunkerUpgrade,
      })
    }
    if (this.lives < MAX_LIVES) {
      defense.push({
        id: 'buy_life',
        label: 'EXTRA SHIP',
        desc: 'one more life',
        price: PRICES.life,
        disabled: this.credits < PRICES.life,
      })
    }
    sections.push({ title: 'DEFENSE', items: defense })

    return { credits: this.credits, sections }
  }

  weaponDesc(id) {
    const def = this.weaponById(id)
    const bits = []
    bits.push({ single: '1 shot', twin: '2 shots', tri: '3-way' }[def.pattern])
    if (def.flags.includes('homing')) bits.push('homing')
    if (def.flags.includes('pierce')) bits.push('piercing')
    bits.push(`dmg ${def.damage}`)
    return bits.join(' · ')
  }

  shopAction(id) {
    const spend = (cost) => {
      if (this.credits < cost) return false
      this.credits -= cost
      return true
    }
    if (id.startsWith('unlock_')) {
      const wid = id.slice(7)
      if (this.pool.includes(wid) || !spend(PRICES[wid])) return
      this.pool.push(wid)
      this.updateLegend()
    } else if (id.startsWith('enh_')) {
      const parts = id.split('_')
      const key = parts.pop()
      const wid = parts.slice(1).join('_')
      const enh = this.enhFor(wid)
      if (key === 'unique') {
        const unique = this.uniqueDef(wid)
        if (!unique || enh.unique >= unique.max) return
        if (!spend(enhCost(unique.base, enh.unique))) return
        enh.unique++
      } else {
        const coreDef = CORE_ENH[key]
        if (!coreDef || enh[key] >= coreDef.max) return
        if (!spend(enhCost(coreDef.base, enh[key]))) return
        enh[key]++
      }
    } else if (id === 'buy_bunker') {
      const slot = BUNKER_SLOTS.findIndex(
        (_, i) => !this.bunkers[i] || this.bunkers[i].segments.length === 0
      )
      if (slot === -1 || !spend(PRICES.bunker)) return
      this.buildBunker(slot)
    } else if (id === 'up_bunker') {
      if (this.bunkerLevel >= MAX_BUNKER_LEVEL || !spend(PRICES.bunkerUpgrade)) return
      this.bunkerLevel++
      for (let i = 0; i < this.bunkers.length; i++) {
        if (this.bunkers[i]) this.rebuildBunker(i)
      }
    } else if (id === 'buy_life') {
      if (this.lives >= MAX_LIVES || !spend(PRICES.life)) return
      this.lives++
    }
    this.renderShop()
    this.refreshHud()
  }

  rebuildBunker(slotIndex) {
    const bunker = this.bunkers[slotIndex]
    if (bunker) {
      for (const seg of bunker.segments) this.scene.remove(seg.mesh)
    }
    this.buildBunker(slotIndex)
  }

  // --- Player damage ---------------------------------------------------------------------------

  playerHit(p) {
    if (this.shield && this.shield.id === 'aegis') {
      this.shield.hp--
      this.fx.burst(p.x, p.y, COLORS.cyan, 30, 10, 45, 0.3, 0.7)
      this.rings.spawn(p.x, p.y, COLORS.cyan, 5, 0.35)
      this.shake = Math.max(this.shake, 0.5)
      if (this.shield.hp <= 0) {
        this.shield = null
        this.ui.toast('AEGIS DOWN')
      }
      return
    }
    if (this.shield && this.shield.id === 'nova') {
      this.shield = null
      this.novaBlast(p)
      return
    }
    this.loseLife(p)
  }

  novaBlast(p) {
    this.ui.toast('NOVA DISCHARGE')
    this.fx.burst(p.x, p.y, COLORS.magenta, 200, 20, 100, 0.5, 1.5)
    this.rings.spawn(p.x, p.y, COLORS.magenta, 18, 0.7)
    this.shake = 1.4
    for (let i = this.invaders.length - 1; i >= 0; i--) {
      if (this.invaders[i].mesh.position.distanceTo(p) < 26) this.killInvader(i, null)
    }
    if (this.boss && this.boss.mesh.position.distanceTo(p) < 30) this.damageBoss(10)
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      if (this.enemyBullets[i].mesh.position.distanceTo(p) < 32) {
        this.scene.remove(this.enemyBullets[i].mesh)
        this.enemyBullets.splice(i, 1)
      }
    }
  }

  loseLife(p) {
    this.lives--
    this.fx.burst(p.x, p.y, COLORS.red, 120, 15, 80, 0.5, 1.4)
    this.rings.spawn(p.x, p.y, COLORS.red, 10, 0.6)
    this.shake = 1.2
    this.shield = null
    // Mercy: clear nearby fire so you don't die twice instantly.
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      if (this.enemyBullets[i].mesh.position.distanceTo(p) < 30) {
        this.scene.remove(this.enemyBullets[i].mesh)
        this.enemyBullets.splice(i, 1)
      }
    }
    if (this.lives <= 0) {
      this.gameOver()
    } else {
      this.invuln = 2.5
      p.x = 0
    }
  }

  // --- UFO & powerups -----------------------------------------------------------------------

  updateUfo(dt) {
    if (this.ufo) {
      this.ufo.mesh.position.x += this.ufo.vx * dt
      this.fx.spawn(this.ufo.mesh.position.x, this.ufo.mesh.position.y - 1, 0, -10, 0.35, 0.2, 1, 0.3)
      if (Math.abs(this.ufo.mesh.position.x) > BOUNDS.x + 6) {
        this.scene.remove(this.ufo.mesh)
        this.ufo = null
      }
      return
    }
    if (this.boss) return
    this.ufoTimer -= dt
    if (this.ufoTimer <= 0 && this.invaders.length > 0) {
      this.ufoTimer = 14 + Math.random() * 8
      const fromLeft = Math.random() < 0.5
      const mesh = makeOutline('saucer', COLORS.green, 2)
      mesh.position.set(fromLeft ? -BOUNDS.x - 4 : BOUNDS.x + 4, 45, 0)
      this.scene.add(mesh)
      this.ufo = { mesh, vx: fromLeft ? 24 : -24 }
    }
  }

  dropPowerup(pos) {
    // 1/3 shields, 2/3 a weapon from the (growing) drop pool.
    let kind, isShield
    if (Math.random() < 1 / 3) {
      kind = SHIELD_IDS[Math.floor(Math.random() * SHIELD_IDS.length)]
      isShield = true
    } else {
      kind = this.pool[Math.floor(Math.random() * this.pool.length)]
      isShield = false
    }
    const icon = this.dropIcon(kind, isShield)
    const mesh = makeOutline(icon.shape, icon.color, 1.2)
    mesh.position.set(pos.x, pos.y, 0)
    this.scene.add(mesh)
    this.powerups.push({ kind, isShield, mesh })
  }

  // Side legend mapping every possible drop to its icon; grows with the pool.
  updateLegend() {
    const rows = []
    for (const id of this.pool) {
      rows.push({ icon: this.dropIcon(id, false), label: this.weaponById(id).name })
    }
    for (const id of SHIELD_IDS) {
      rows.push({ icon: this.dropIcon(id, true), label: SHIELDS[id].name })
    }
    this.ui.legend(rows)
  }

  // Every drop has a unique shape+color pair: shields are circles, cosmics
  // are stars in their rolled color, weapons use WEAPON_ICONS.
  dropIcon(kind, isShield = !!SHIELDS[kind]) {
    if (isShield) return { shape: 'circle', color: SHIELDS[kind].color }
    if (this.cosmics[kind]) return { shape: 'star', color: this.cosmics[kind].color }
    return WEAPON_ICONS[kind]
  }

  updatePowerups(dt, p) {
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i]
      pu.mesh.position.y -= 13 * dt
      pu.mesh.rotation.z += 2 * dt
      if (pu.mesh.position.y < -BOUNDS.y - 3) {
        this.scene.remove(pu.mesh)
        this.powerups.splice(i, 1)
        continue
      }
      if (Math.hypot(pu.mesh.position.x - p.x, pu.mesh.position.y - p.y) < 3.2) {
        this.applyPowerup(pu)
        this.scene.remove(pu.mesh)
        this.powerups.splice(i, 1)
      }
    }
  }

  applyPowerup(pu) {
    if (pu.isShield) {
      if (pu.kind === 'aegis') this.shield = { id: 'aegis', hp: 3 }
      else if (pu.kind === 'reflect') this.shield = { id: 'reflect', t: 10 }
      else this.shield = { id: 'nova' }
      this.ui.toast(`${SHIELDS[pu.kind].name} ONLINE`)
    } else {
      const t = this.equipTime(pu.kind)
      this.temp = { id: pu.kind, t }
      this.ui.toast(`${this.weaponById(pu.kind).name} ONLINE (${Math.round(t)}s)`)
    }
    this.fx.burst(pu.mesh.position.x, pu.mesh.position.y, COLORS.yellow, 25, 5, 35, 0.3, 0.6)
  }

  updateShieldRing(p) {
    if (!this.shield) {
      this.shieldRing.visible = false
      return
    }
    this.shieldRing.visible = true
    this.shieldRing.position.copy(p)
    this.shieldRing.rotation.z += 0.02
    const def = SHIELDS[this.shield.id]
    this.shieldRing.material.color.setHex(def.color)
    this.shieldRing.material.transparent = true
    this.shieldRing.material.opacity =
      this.shield.id === 'aegis' ? 0.35 + 0.22 * this.shield.hp : 0.8
  }

  // --- HUD --------------------------------------------------------------------------

  refreshHud() {
    const def = this.weaponById(this.currentWeaponId())
    let weaponText = def.name
    if (this.temp) weaponText += ` ${Math.ceil(this.temp.t)}s`
    if (this.jamT > 0)
      weaponText += ` <span style="color:#f36;text-shadow:0 0 8px #f36">· JAMMED ${Math.ceil(this.jamT)}s</span>`
    if (this.slowT > 0)
      weaponText += ` <span style="color:#fe6;text-shadow:0 0 8px #fe6">· SLOWED ${Math.ceil(this.slowT)}s</span>`
    let shieldText = 'NO SHIELD'
    if (this.shield) {
      const sdef = SHIELDS[this.shield.id]
      if (this.shield.id === 'aegis') shieldText = `${sdef.name} ×${this.shield.hp}`
      else if (this.shield.id === 'reflect') shieldText = `${sdef.name} ${Math.ceil(this.shield.t)}s`
      else shieldText = `${sdef.name} ARMED`
    }
    this.ui.hud({
      score: this.score,
      hi: this.hi,
      credits: this.credits,
      wave: this.wave,
      lives: this.lives,
      weapon: weaponText,
      shield: shieldText,
    })
  }
}
