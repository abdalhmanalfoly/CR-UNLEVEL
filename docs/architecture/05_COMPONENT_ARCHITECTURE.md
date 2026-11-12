# 05 — Component Architecture

For each component: purpose, responsibilities, inputs/outputs, dependencies, interface
surface, and — explicitly — what it must **not** do. "Must not" columns define the boundaries
that future work must preserve (or establish, where the boundary is currently violated and
flagged in 02).

---

## 5.1 React Shell (`src/main.tsx`, `src/App.tsx`, `src/pages/Home.tsx`)

| | |
|---|---|
| **Purpose** | Own the DOM document: root mount, routing, canvas element, HUD markup, all overlay screens. |
| **Responsibilities** | Render `<canvas id="game-canvas">` + full HUD/screen DOM; call `startGame(canvas, multiplayer?)` once in `useEffect` and `stopGame()` on cleanup; parse `?mp=1&server=&name=&room=` into a multiplayer config object. |
| **Inputs** | URL params; none at runtime. |
| **Outputs** | DOM tree the imperative game binds to by id; a live `Game` instance. |
| **Dependencies** | `react`, `react-router`, `@/game/boot`. |
| **Must NOT** | Contain game logic, hold game state in React, or re-render per frame. Also must not assume the physics singleton is reusable across mounts (see CRIT-1 dependency). |

DOM id contract (breaking any pair breaks the game at runtime):
`game-canvas`, `title-screen`, `buy-screen`, `pause-screen`, `end-screen`, `start-btn`,
`next-round-btn`, `resume-btn`, `restart-btn`, `end-restart-btn`, `mute-btn`, `health`,
`armor`, `credits`, `player-rounds`, `enemy-rounds`, `round-label`, `timer`, `enemies-left`,
`weapon-name`, `ammo`, `reserve`, `reload-label`, `killfeed`, `crosshair`, `hitmarker`,
`damage-flash`, `scope`, `round-banner`, `buy-credits`, `buy-title`, `round-result`,
`buy-tip`, `end-badge`, `end-title`, `end-subtitle`, `stat-kills`, `stat-accuracy`, `stat-rounds`.

## 5.2 Boot / Orchestrator (`src/game/boot.ts` — class `Game` + `startGame/stopGame`)

| | |
|---|---|
| **Purpose** | Compose all subsystems; own the mode flow; translate input+state into per-frame actions; own all DOM updates. |
| **Responsibilities (current, exhaustive)** | Three.js renderer/scene/camera setup; GLB weapon loading + fallback; pointer lock; keyboard/mouse/pointer event binding (via `this.on`); mode switching (`setMode`); round flow (`beginMatch`, `beginRound`, `finishRound`, `endMatch`); firing pipeline (spread, raycast, hit routing to bots/enemies/obstacles); damage intake; economy UI; buy flow; weapon switching/reload timers; camera + weapon rig animation; bot spawn policy per round; MP wiring (24 callbacks, remote player meshes, interpolation, input streaming); test/debug hooks (`__gameProbe`, `__gameDebug`, `__gameTest`, `__ASSETS_READY__`, `__GAME_READY__`); teardown. |
| **Inputs** | DOM events; per-frame `update(dt)` from GameLoop; network messages via NetworkClient callbacks. |
| **Outputs** | Rendered frame; DOM text/classes; subsystem calls; network sends. |
| **Dependencies** | everything in `src/game/**` (see import list, lines 1-19). |
| **Must NOT** | (target) contain weapon math, round rules, or MP protocol handling inline — these already exist as modules and are being re-implemented here; must not reach into private fields (`roundManager["round"]`) — add proper setters instead. **Status: violated today — this is the #1 refactor target (02 HIGH-1).** |
| **Lifecycle contract** | `startGame()` must be safe after `stopGame()` (StrictMode double-mount); `dispose()` must release: loop, all listeners (self-registered), audio, bots, physics (`disposePhysics`), scene GPU resources, renderer, window globals. |

## 5.3 Game Loop (`src/game/engine.ts` — `GameLoop`)

| | |
|---|---|
| **Purpose** | Fixed 60 Hz simulation, decoupled rendering, stall protection. |
| **Interface** | `new GameLoop({update(dt), render(alpha)})`, `.start()`, `.stop()`; `STEP = 1/60`; `MAX_FRAME = 0.25`. |
| **Must NOT** | Know anything about the game. |
| **Note** | `alpha` is currently ignored by boot (interpolation unused). |

## 5.4 World / Map (`src/game/world.ts` — `World`)

| | |
|---|---|
| **Purpose** | Build the arena from data; provide collision + LOS primitives; ambient dust animation. |
| **Responsibilities** | Scene setup (background, fog, hemisphere+sun light with shadow map 1536²); sand texture (canvas-generated); floor/lane meshes; `MAP_BLOCKS` instancing (wall/crate/barrier + crate trim); lamps, dunes, grid, site marker ring; dust particle system; `moveCircle(pos, dx, dz, radius)` axis-separated slide against obstacles + map clamp; `lineOfSight(from, to, raycaster)`. |
| **Outputs (state)** | `obstacles[]` (AABBs), `collisionMeshes[]` (raycast blockers), `playerSpawn`. |
| **Dependencies** | `three`, `config.ts` (COLORS, GAME, MAP_BLOCKS, mulberry32). |
| **Must NOT** | Simulate the player or know about bots; physics of gravity belongs to collision.ts. |

## 5.5 Physics (`src/game/systems/collision.ts`)

| | |
|---|---|
| **Purpose** | Rapier-backed player capsule: gravity, velocity moves, ground checks, server raycasts; module-level singleton. |
| **Interface** | `initPhysics(gravity?)`, `createPlayerCapsule(Async)(pos, r, h)`, `getPlayerPosition/Velocity`, `setPlayerPosition/Velocity`, `applyPlayerImpulse`, `movePlayer(vx,vy,vz)`, `jumpPlayer(force)`, `isPlayerGrounded()`, `raycast(origin, dir, max)`, `addWallCollider/addCapsuleCollider`, `stepPhysics(dt)`, `disposePhysics()`. |
| **Must NOT** | Be initialized twice concurrently; survive a `disposePhysics()` with a stale world (violated today → CRIT-1); know about the map (world.ts owns obstacles). |
| **Hard requirement** | Invariant: *at most one `RAPIER.init()` per page load; world assignment only if the game session that requested it is still alive* (generation token). |

## 5.6 Rules Layer — pure modules (`src/game/systems/`)

All are framework-free, allocation-light, and unit-tested (`systems.test.ts`). They must stay pure.

### `round.ts` — `RoundManager`
Round/bomb state machine (`menu → buy → freeze → active →(bombPlanted)→ ending → summary/sideSwitch → matchOver`), guarded transitions, timers. Config via `RoundConfig`. **Note:** `plantBomb/defuseBomb` are currently dead code (unwired).

### `damage.ts` — `calculateDamage / applyDamage`
Hit regions (head/torso/arm/leg), armor absorption (50%), helmet rule. **Shared with the server** (`server/index.ts` imports it) — the only combat rule the server trusts. ⚠ Its `remainingHealth` contract ("caller applies to current health") is misused by the server (CRIT-3).

### `weapons.ts` — `WeaponSystem`
Per-player weapon roster + ammo runtime (magazine/reserve), owned/equipped flags, purchase checks, `resetRound/resetMatch`. Must not import rendering or DOM.

### `economy.ts` — `EconomyManager`
Per-team credits, kill/win/loss rewards, purchase debit, cap 16 000.

### `team.ts` — `TeamManager`
Alive counters + kill/death stats per team. Currently barely used by boot (alive counts set once per round).

### `collision.ts` — see 5.5 (the only impure member; flagged for singleton hardening).

## 5.7 Bot AI (`src/game/ai/bot.ts` — `BotManager`, `BotController`)

| | |
|---|---|
| **Purpose** | Solo-mode defenders: perception → decision FSM → navigation → combat. |
| **Responsibilities** | Spawn/despawn bot meshes; per-bot FSM (18 states) with difficulty tables (easy/normal/hard/expert); roles (entry/support/defense); LOS checks via `World`; firing callbacks with accuracy; ammo/reload; death cleanup; `getShootableTargets()` (body+head meshes tagged `botId`/`part`); `damageBot()`; alive count. |
| **Inputs** | `update(dt, playerPos, playerAlive)`; world + raycaster (shared with Game). |
| **Outputs** | `onBotFire(botId, from, to, accuracy)` → boot applies damage to player; `onBotKilled(botId)` → credits/killfeed/round check. |
| **Must NOT** | Depend on the server or on RoundManager directly (it doesn't — good boundary). |

## 5.8 Legacy Enemies (`src/game/enemies.ts` — `EnemyManager`)

Three archetypes (fighter/charger/heavy per README) with callbacks (`damagePlayer`,
`enemyShot`, `killed`). Instantiated by boot and included in shoot targets, but no spawn
policy drives it in normal play — **superseded by bots** (02 HIGH-2). Must not be extended;
candidate for removal after migration of any still-needed behavior.

## 5.9 Input (`src/game/input.ts` — `Input`)

| | |
|---|---|
| **Purpose** | Normalize keyboard/mouse/touch into `moveX/moveZ`, look deltas, actions, held-keys. |
| **Contract (fixed, test-enforced)** | W/↑ forward, S/↓ back, A/← left, D/→ right; mouse right → yaw decreases (right-handed); verified by `scripts/verify-game.mjs` assertions. Changing the mapping requires syncing that script. |
| **Interface** | `moveX/moveZ`, `consumeLook()`, `consumeAction(code)`, `isHeld(code)`, `dispose()`. |
| **Must NOT** | Own game flow (no mode logic inside). |

## 5.10 Audio (`src/game/audio.ts` — `AudioSystem`)

Synthesized SFX (shot/hit/step/reload/dry/hurt/win/lose/ui/pickup), enemy shot variant,
music loop, `toggleMute()`, persisted mute; owns AudioContext + 2 window listeners;
`dispose()` required in teardown. Must not be called from render hot path more than once per event.

## 5.11 Effects (`src/game/effects.ts` — `Effects`)

Pooled tracers, impact bursts, muzzle flash (capacity-tied to `QUALITY.PARTICLES_*`).
`tracer(from,to,isEnemy)`, `burst(point,n,speed)`, `flash()`, `update(dt)`. Must not allocate in the hot loop.

## 5.12 Storage (`src/game/storage.ts`)

Defensive `localStorage` wrapper (prefix `game.`), `highScore`. Never throws. The **only**
persistence in the product.

## 5.13 Network Client (`src/game/net/client.ts` — `NetworkClient`, singleton `networkClient`)

| | |
|---|---|
| **Purpose** | Socket.IO connection + typed message dispatch. |
| **Responsibilities** | connect/disconnect lifecycle, connection status events, one `on…` callback per S2C message type, typed `send` wrappers (createRoom…purchase), dev hook `window.__networkClient`. |
| **Must NOT** | Own game state or decide what to do with messages (boot wires behavior); must not re-render DOM. |
| **Gap** | No lobby/matchmaking UI anywhere — rooms are joined by URL params only (02). |

## 5.14 Game Server (`server/index.ts`)

| | |
|---|---|
| **Purpose** | Authoritative MP: rooms, presence, match start gating, movement validation, combat resolution, purchases, respawn, round timers. |
| **State** | `rooms: Map<code, Room>`, `socketToRoom`, `socketToPlayerId` (all in-memory). |
| **Tick** | 30 Hz `setInterval`: round state timers (`buy 20s → freeze 3s → active 75s`) + respawn after 3 s. |
| **Transport** | One `message` envelope, `switch(type)` dispatch to handlers; emits typed-shaped objects via `as any`. |
| **Shared imports** | `src/shared/types.ts`, `src/game/systems/damage.ts` (`calculateDamage`), `src/game/config.ts` (WEAPONS/EQUIPMENT/ATTACKER_SPAWNS/DEFENDER_SPAWNS). |
| **Must NOT** | (target) duplicate spawn tables (today it hardcodes them), skip validating payloads, or leave the match FSM unfinished (CRIT-2). |
| **Config knobs** | `PORT` (env, default 3001), `MAX_ROOMS=100`, `ROOM_CODE_LENGTH=6`, `TICK_RATE=30`, `SERVER_MOVE_SPEED=5.4`, `MAX_POSITION_DELTA=10`, `RESPAWN_DELAY=3000`, `CLIENT_ORIGIN` (CORS, default `*`). |

## 5.15 Shared Contracts (`src/shared/types.ts`, `src/game/config.ts`)

- `shared/types.ts`: the protocol — every C2S/S2C message interface, `TeamId`, `WeaponId`,
  `RoundState`, `S2CPlayerInfo/RoomInfo`. Single source of truth; imported by client, server, and tests.
- `game/config.ts`: all tunables (`GAME`, `QUALITY`, `COLORS`, `INPUT_CONFIG`), weapon and
  equipment specs, `MAP_BLOCKS`, spawn tables, bomb sites, seeded RNG (`mulberry32`).
  Imported by client **and** server — treat as a shared rules library despite living under `src/`.

## 5.16 Test & Verification Infrastructure (`tests/`, `scripts/`)

| Asset | Kind | What it verifies |
|---|---|---|
| `src/game/systems/systems.test.ts` | vitest unit | damage math, round FSM guards, economy, weapons, team |
| `src/game/net/multiplayer.test.ts` | vitest integration (real server, port 31337) | room lifecycle: create/join/ready/team/start |
| `src/game/net/multiplayer2.test.ts` | vitest integration (port 31338) | weapon switching validation, authoritative kill, respawn broadcast, misses |
| `tests/multiplayer.e2e.ts` | Playwright (server 31339 + `vite preview` 3000) | browser-level MP flow |
| `scripts/verify-game.mjs` | Playwright smoke script | build served statically → canvas not black → Space enters game → **direction assertions** (W forward / D right) via `__gameProbe` → pause → zero console errors |
| `scripts/build-output.ts` | Vite plugin | emitted files match the bundle on disk; prunes only tracked unchanged files; history in `.game-build-files.json` |

Dependencies between them: `verify-game.mjs` requires `npm run build` first and the DOM-id +
probe contracts (5.1, 5.2). E2E requires the ports to be free or `reuseExistingServer` kicks in.
