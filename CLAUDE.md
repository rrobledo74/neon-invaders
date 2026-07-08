# CLAUDE.md

## Project

`game-prototype` — **NEON INVADERS**: a modern Space Invaders with a
Geometry Wars art style. Black void, glowing neon wireframe shapes,
UnrealBloom post-processing for the glow, and a pooled additive-blend
particle system for explosions, trails, and impacts.

(An earlier HD-2D isometric tribes prototype in this directory was scrapped
2026-07-06 and fully replaced by this.)

**Design:** classic invader-grid marching/descending core, modernized:
- **Enemy classes** (defs.js): grunt (triangle, 1hp), soldier (diamond, 2hp),
  brute (hexagon, 3hp), goliath (purple 2×2-grid-slot hexagon, hp scales with
  wave). Enemies with maxHp > 1 show remaining hits as a number inside the
  shape (cached digit-sprite materials). Row composition and goliath count
  scale with wave via `rowsForWave`/`goliathCount`.
- **Enemy count scaling**: `extraGrunts(wave)` adds one grunt per wave (cap
  20), filling new center-aligned rows below the standard grid so the
  formation stays symmetric.
- **Weapons are timed drops** (PULSE is the only permanent weapon): base
  drop pool = TRISHOT/LANCE/SEEKER; shop-bought combos (TRI-SEEKER,
  TRI-LANCE, GHOST LANCE, OMNI CANNON) and claimed cosmics join the pool and
  then drop from enemies like any other pickup. Equip time is 12s base,
  extendable per weapon. Uniform model: pattern (single/twin/tri) + flags
  ('homing'/'pierce') shared with cosmic mod ids — one fire/bullet path.
  Every drop has a unique shape+color icon (`WEAPON_ICONS` in defs.js;
  families share shapes — tri-shots triangle, lances chevron, seekers cross;
  cosmics are stars in their rolled color, shields circles). The same
  outline data (`SHAPES`) renders drops in-world and as SVG icons in the
  shop next to weapon names.
- **Enhancements (the money sink)**: per-weapon shop sub-items. Cores: FIRE
  RATE / DAMAGE / EQUIP TIME, each +10% per level (tenths), 20 levels, price
  `base × 1.6^level` (`enhCost`). Plus one unique per weapon family:
  VELOCITY (pulse, +shot speed), HYDRA (+1 projectile, trishot/omni),
  BROADSIDE (+shot size, lance types), BLOODHOUND (+tracking, seeker types).
  Cosmics get cores only. State in `game.enh[weaponId]`.
- **Cosmic weapons**: every 10th wave boss drop. `rollCosmic()` draws 3
  distinct mods from a 20-mod library (`COSMIC_MODS`), random name + color.
  Reveal screen shows mods + stats; Enter claims → joins drop pool and is
  hot-equipped once.
- **Bosses** (every 10th wave, cycling 5, hp scales): THE WARDEN (snare —
  half speed 5s), THE JAMMER (EMP — weapons offline 4s), THE PHANTOM
  (teleports to a new anchor every ~5s — hard to hit), THE BROODMOTHER
  (spawns grunts), THE BULWARK (raises a damage-absorbing AEGIS WALL ring,
  breaks or expires in 8s). Radial + aimed fire, 1.2s converging-particle
  telegraph before specials, top-center health bar (shows wall hp).
- **Economy/shop**: kills/UFO/bosses award credits (¤); wave bonus capped.
  Shop after every 5th wave: combo unlocks, per-weapon enhancements,
  **bunkers** (classic 4-slot segment grids; enemy fire, marching invaders,
  AND your own shots chew them — carve a firing slit or camp and lose them),
  bunker reinforcement, extra ships.
- **Shields** (pickups, one at a time): AEGIS (3 hits), REFLECTOR (10s,
  converts incoming fire), NOVA (blast on hit).
- Feel: 8192-particle pool, shockwave rings (`RingFX`), muzzle flashes,
  beams/lightning arcs, screen shake, and a parallax space backdrop: 3-layer
  starfield streaming downward (flying-forward feel) + `PlanetField` in
  main.js (dim outlined planets, optional rings, orbiting moons, drifting
  slowly at z=-3). Hi-score persists in localStorage; credits/enhancements
  are per-run (restart = reload).

**Controls:** ←→/AD move, Space fire, Enter start/retry/confirm, P pause.
Shop is mouse-driven, Enter launches.

**Stack:** Vite + vanilla JS + Three.js (orthographic camera on a fixed
160×100 world; `three/addons` EffectComposer + UnrealBloomPass). No
framework. `npm run dev` to run.

**Layout:**
- `src/defs.js` — data only: colors, enemy classes + wave composition,
  weapon/shield defs, cosmic mod library + `rollCosmic()`, bosses, prices.
- `src/game.js` — all gameplay logic: shape geometry, `Game` class with
  state machine (title/playing/paused/shop/cosmic/gameover), grid + goliath
  spawning, unified fire/bullet path with mod effects, boss AI, bunkers,
  shop data/actions, collisions, HUD data.
- `src/particles.js` — `ParticleSystem` (pooled additive `THREE.Points`;
  `burst`/`beam`/`spawn`) and `RingFX` (pooled expanding shockwave rings).
- `src/ui.js` — DOM-overlay HUD, boss bar, toasts, overlays, shop renderer,
  cosmic reveal screen. Dumb view; game pushes prepared display data.
- `src/main.js` — bootstrap: renderer, fixed-world ortho camera, bloom
  composer, background grid, starfield, input, screen-shake, main loop.

**Conventions so far:** all visuals are runtime-generated (line-loop outlines,
additive quads, particles) — no textures or assets. Data/tuning lives in
`defs.js`. No state management library, no asset pipeline, no audio yet.
Keep it this simple until the prototype actually needs more.

---

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
