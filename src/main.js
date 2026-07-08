import './style.css'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ParticleSystem, RingFX } from './particles.js'
import { Game, BOUNDS } from './game.js'
import { UI } from './ui.js'

// --- Renderer / scene ---------------------------------------------------

const app = document.querySelector('#app')
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000004)

// Fixed 2D play area, camera fit to always contain it.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
camera.position.z = 10

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight
  const worldW = BOUNDS.x * 2 + 8
  const worldH = BOUNDS.y * 2 + 8
  let width, height
  if (aspect > worldW / worldH) {
    height = worldH
    width = worldH * aspect
  } else {
    width = worldW
    height = worldW / aspect
  }
  camera.left = -width / 2
  camera.right = width / 2
  camera.top = height / 2
  camera.bottom = -height / 2
  camera.updateProjectionMatrix()
}

// --- Bloom (the Geometry Wars glow) ------------------------------------------

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.35, // strength
  0.55, // radius
  0.1 // threshold
)
composer.addPass(bloom)

// --- Background grid ----------------------------------------------------------

{
  const points = []
  for (let x = -BOUNDS.x; x <= BOUNDS.x; x += 8) {
    points.push(new THREE.Vector3(x, -BOUNDS.y, -1), new THREE.Vector3(x, BOUNDS.y, -1))
  }
  for (let y = -BOUNDS.y; y <= BOUNDS.y; y += 8) {
    points.push(new THREE.Vector3(-BOUNDS.x, y, -1), new THREE.Vector3(BOUNDS.x, y, -1))
  }
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x0a1430 })
  )
  scene.add(grid)
}

// --- Game -----------------------------------------------------------------------

// --- Parallax planets & moons (far background, drifting past as you fly) -----

const planetPalette = [0x235a8c, 0x5a2a8c, 0x2a8c5a, 0x8c5a2a, 0x8c2a5a]

class PlanetField {
  constructor(scene) {
    this.scene = scene
    this.planets = []
    this.timer = 4
    // One planet already in view so the sky isn't empty at the title screen.
    this.spawn(Math.random() * 40 - 20)
  }

  spawn(startY = null) {
    const r = 6 + Math.random() * 10
    const tint = planetPalette[Math.floor(Math.random() * planetPalette.length)]
    const dim = new THREE.Color(tint).multiplyScalar(0.45)
    const group = new THREE.Group()

    const body = new THREE.Mesh(
      new THREE.CircleGeometry(r, 40),
      new THREE.MeshBasicMaterial({ color: 0x04060d })
    )
    const outlinePts = []
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2
      outlinePts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0))
    }
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(outlinePts),
      new THREE.LineBasicMaterial({ color: dim })
    )
    group.add(body, outline)

    if (Math.random() < 0.35) {
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(outlinePts),
        new THREE.LineBasicMaterial({ color: dim, transparent: true, opacity: 0.6 })
      )
      ring.scale.set(1.7, 0.5, 1)
      ring.rotation.z = 0.35
      group.add(ring)
    }

    const moons = []
    const moonCount = Math.floor(Math.random() * 3)
    for (let i = 0; i < moonCount; i++) {
      const mr = r * (0.12 + Math.random() * 0.12)
      const moon = new THREE.Mesh(
        new THREE.CircleGeometry(mr, 16),
        new THREE.MeshBasicMaterial({ color: 0x2a3348 })
      )
      const orbit = r * 1.5 + i * 3 + 2
      const angle = Math.random() * Math.PI * 2
      const speed = 0.15 + Math.random() * 0.3
      group.add(moon)
      moons.push({ mesh: moon, orbit, angle, speed })
    }

    group.position.set((Math.random() - 0.5) * 140, startY !== null ? startY : BOUNDS.y + r + 6, -3)
    this.scene.add(group)
    this.planets.push({ group, r, vy: 1.5 + Math.random() * 1.5, moons })
  }

  update(dt) {
    this.timer -= dt
    if (this.timer <= 0 && this.planets.length < 3) {
      this.timer = 16 + Math.random() * 14
      this.spawn()
    }
    for (let i = this.planets.length - 1; i >= 0; i--) {
      const pl = this.planets[i]
      pl.group.position.y -= pl.vy * dt
      for (const m of pl.moons) {
        m.angle += m.speed * dt
        m.mesh.position.set(Math.cos(m.angle) * m.orbit, Math.sin(m.angle) * m.orbit * 0.4, 0.1)
      }
      if (pl.group.position.y < -BOUNDS.y - pl.r - 8) {
        this.scene.remove(pl.group)
        this.planets.splice(i, 1)
      }
    }
  }
}

const keys = new Set()
const particles = new ParticleSystem(scene, 8192)
const rings = new RingFX(scene)
const planets = new PlanetField(scene)
const ui = new UI()
const game = new Game(scene, particles, rings, ui, keys)

window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase())
  if (!e.repeat) game.handleKey(e.key.toLowerCase())
  if (e.key === ' ' || e.key.startsWith('Arrow')) e.preventDefault()
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

// --- Resize / loop -----------------------------------------------------------

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
  fitCamera()
}
window.addEventListener('resize', onResize)
onResize()

const clock = new THREE.Clock()

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05)
  game.update(dt)

  // Three-layer parallax starfield: far/dim/slow → near/bright/fast, all
  // streaming downward so it reads as flying forward through space.
  const starLayers = [
    { rate: 8, speed: 5, jitter: 4, r: 0.05, g: 0.07, b: 0.16 },
    { rate: 5, speed: 14, jitter: 6, r: 0.1, g: 0.14, b: 0.3 },
    { rate: 2.5, speed: 30, jitter: 8, r: 0.35, g: 0.4, b: 0.55 },
  ]
  for (const layer of starLayers) {
    if (Math.random() < dt * layer.rate) {
      const speed = layer.speed + Math.random() * layer.jitter
      particles.spawn(
        (Math.random() - 0.5) * BOUNDS.x * 2,
        BOUNDS.y + 2,
        0,
        -speed,
        (BOUNDS.y * 2 + 6) / speed, // live just long enough to cross the screen
        layer.r,
        layer.g,
        layer.b
      )
    }
  }

  planets.update(dt)
  particles.update(dt)
  rings.update(dt)

  // Screen shake
  camera.position.x = (Math.random() - 0.5) * 2 * game.shake
  camera.position.y = (Math.random() - 0.5) * 2 * game.shake
  game.shake *= Math.exp(-6 * dt)

  composer.render()
  requestAnimationFrame(animate)
}
animate()
