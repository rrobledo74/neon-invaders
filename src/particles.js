// Pooled GPU particle system: one THREE.Points with additive blending.
// Dead particles fade to black, which is invisible under additive blending,
// so the whole pool can always be drawn. Plus RingFX: expanding shockwave
// rings for kills and blasts.

import * as THREE from 'three'

export class ParticleSystem {
  constructor(scene, max = 8192) {
    this.max = max
    this.cursor = 0
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.baseCol = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 2)
    this.life = new Float32Array(max)
    this.maxLife = new Float32Array(max)

    const geometry = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', this.posAttr)
    geometry.setAttribute('color', this.colAttr)

    const material = new THREE.PointsMaterial({
      size: 3,
      sizeAttenuation: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    })
    this.points = new THREE.Points(geometry, material)
    this.points.frustumCulled = false
    scene.add(this.points)
  }

  spawn(x, y, vx, vy, life, r, g, b) {
    const i = this.cursor
    this.cursor = (this.cursor + 1) % this.max
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = 0
    this.vel[i * 2] = vx
    this.vel[i * 2 + 1] = vy
    this.life[i] = life
    this.maxLife[i] = life
    this.baseCol[i * 3] = r
    this.baseCol[i * 3 + 1] = g
    this.baseCol[i * 3 + 2] = b
  }

  // Radial explosion burst. color: THREE.Color-compatible hex.
  burst(x, y, hex, count, speedMin = 8, speedMax = 45, lifeMin = 0.4, lifeMax = 1.1) {
    const c = new THREE.Color(hex)
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = speedMin + Math.random() * (speedMax - speedMin)
      const life = lifeMin + Math.random() * (lifeMax - lifeMin)
      // Slight per-particle tint variation keeps bursts from looking flat.
      const shade = 0.7 + Math.random() * 0.5
      this.spawn(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        life,
        Math.min(1, c.r * shade),
        Math.min(1, c.g * shade),
        Math.min(1, c.b * shade)
      )
    }
  }

  // Particles strung along a segment — lightning arcs, snare beams.
  beam(x1, y1, x2, y2, hex, count = 14) {
    const c = new THREE.Color(hex)
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      const jitter = (Math.random() - 0.5) * 2
      this.spawn(
        x1 + (x2 - x1) * t + jitter,
        y1 + (y2 - y1) * t + jitter,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        0.35 + Math.random() * 0.25,
        c.r,
        c.g,
        c.b
      )
    }
  }

  update(dt) {
    const drag = Math.exp(-1.8 * dt)
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        this.col[i * 3] = 0
        this.col[i * 3 + 1] = 0
        this.col[i * 3 + 2] = 0
        continue
      }
      this.vel[i * 2] *= drag
      this.vel[i * 2 + 1] *= drag
      this.pos[i * 3] += this.vel[i * 2] * dt
      this.pos[i * 3 + 1] += this.vel[i * 2 + 1] * dt
      const fade = this.life[i] / this.maxLife[i]
      this.col[i * 3] = this.baseCol[i * 3] * fade
      this.col[i * 3 + 1] = this.baseCol[i * 3 + 1] * fade
      this.col[i * 3 + 2] = this.baseCol[i * 3 + 2] * fade
    }
    this.posAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
  }
}

// --- Shockwave rings ------------------------------------------------------------

const RING_SEGMENTS = 32
const ringGeo = (() => {
  const pts = []
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0))
  }
  return new THREE.BufferGeometry().setFromPoints(pts)
})()

export class RingFX {
  constructor(scene, max = 16) {
    this.rings = []
    for (let i = 0; i < max; i++) {
      const mesh = new THREE.LineLoop(
        ringGeo,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })
      )
      mesh.visible = false
      scene.add(mesh)
      this.rings.push({ mesh, t: 0, life: 1, maxScale: 10 })
    }
    this.cursor = 0
  }

  spawn(x, y, hex, maxScale = 8, life = 0.5) {
    const r = this.rings[this.cursor]
    this.cursor = (this.cursor + 1) % this.rings.length
    r.mesh.position.set(x, y, 0)
    r.mesh.material.color.setHex(hex)
    r.mesh.visible = true
    r.t = 0
    r.life = life
    r.maxScale = maxScale
  }

  update(dt) {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue
      r.t += dt
      const frac = r.t / r.life
      if (frac >= 1) {
        r.mesh.visible = false
        continue
      }
      const eased = 1 - (1 - frac) * (1 - frac)
      r.mesh.scale.setScalar(0.5 + eased * r.maxScale)
      r.mesh.material.opacity = 1 - frac
    }
  }
}
