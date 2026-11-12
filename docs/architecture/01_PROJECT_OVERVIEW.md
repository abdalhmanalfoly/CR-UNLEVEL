# 01 — Project Overview

## 1. Identity

| Field | Value |
|---|---|
| npm package name | `game-3d-app` (v0.0.0) |
| Product name | **SANDLINE — بروتوكول خط الرمل** |
| Type | Browser-based 3D tactical shooter (round-based, CS-like economy; original IP — explicitly *not* a Counter-Strike clone, see `CREDITS.md`) |
| Languages | Code/UI strings: TypeScript; UI copy: Arabic (RTL); docs: English + Arabic (`README.md`) |
| License state | Proprietary assets (weapon GLBs from a design asset library, `CREDITS.md`), MIT for Three.js. No top-level LICENSE file — **Unverified** legal status for redistribution |

## 2. What The Product Does (verified behavior)

### 2.1 Single-player mode (complete)
- Best-of-3 rounds (`GAME.MAX_ROUNDS = 3`, `src/game/config.ts`). Each round: buy phase (20s)
  → freeze (3s) → active (75s).
- Defenders are **bots** (`src/game/ai/bot.ts`) — count grows per round (`min(2 + round*2, 7)`,
  `boot.ts:spawnBotsForRound`), difficulty escalates easy → hard by round 3.
- Player movement is physics-driven (Rapier capsule, `src/game/systems/collision.ts`);
  map collision additionally uses custom circle-vs-AABB sliding (`src/game/world.ts:moveCircle`).
- Weapons: pistol SP-9 (owned), rifle AR-4, sniper LR-8 purchasable; armor purchasable.
  Full roster incl. SMG/shotgun/knife defined in `config.ts:WEAPONS` but not purchasable in
  the buy UI (`Home.tsx` only renders rifle/sniper/armor cards).
- Kill rewards ($150), round win/loss rewards, hit-region damage (head ×2, torso ×1,
  arm/leg ×0.75, armor absorbs 50%), helmet variant (`src/game/systems/damage.ts`).
- Round ends on team elimination or time expiry; match ends on score majority.
- Local-only persistence: best-kill high score in `localStorage` (`src/game/storage.ts`).
- Synthesized Web Audio SFX + music (`src/game/audio.ts`), mute toggle.

### 2.2 Multiplayer mode (core implemented, game loop incomplete)
- Activated by URL `?mp=1` (`src/pages/Home.tsx`). Connects via Socket.IO to
  `server/index.ts` (in-memory authoritative rooms, 30 Hz tick).
- Room lifecycle: create / join by 6-char code / ready-up / team balance / host start (≥2 ready).
- Server simulates movement from client inputs (speed clamps), weapon fire (cone-based hit
  detection between players), reload, purchases, deaths, and timed respawns (3 s).
- Verified gaps (details in 02/07): no round-time expiry handling, no next-round progression,
  no `match_over` emission, no bomb mechanics server-side.

### 2.3 Legacy/parallel systems (both live in the client)
- `EnemyManager` (`src/game/enemies.ts`) — an older enemy system; still instantiated by
  `boot.ts` and shootable, but **bots** are the actual round opponents. Two enemy systems coexist.

## 3. Entry Point Chain (single, verified)

```
index.html  →  src/main.tsx (React root, StrictMode, BrowserRouter)
            →  src/App.tsx (Route "/")
            →  src/pages/Home.tsx (canvas + full HUD DOM; useEffect → startGame/stopGame)
            →  src/game/boot.ts (startGame/stopGame; Game class owns Three.js + all subsystems)
```

`src/game/` never re-renders through React; React owns only the DOM shell. This is a
deliberate template contract (`info.md`).

## 4. Functional Requirements (as implemented)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| F1 | WASD/arrows movement, mouse look, LMB fire, RMB aim, R reload, 1/2 weapon switch, Shift sprint, Space/Esc/P flow | ✅ Done | `src/game/input.ts`, `src/game/boot.ts:handleActions` |
| F2 | 3 escalating rounds vs bots | ✅ Done | `boot.ts:spawnBotsForRound`, `systems/round.ts` |
| F3 | 3 enemy archetypes with distinct behavior | ✅ Done (bots) | `ai/bot.ts` roles entry/support/defense; legacy `enemies.ts` archetypes also present |
| F4 | Ballistics: spread, movement penalty, recoil, ADS scope, reload, headshots | ✅ Done | `boot.ts:fire()`, `config.ts:WEAPONS` |
| F5 | Round economy + purchases (rifle, sniper, armor) | ✅ Done | `boot.ts:buy()`, `systems/economy.ts`, `systems/weapons.ts` |
| F6 | Wall collision + LOS for AI | ✅ Done | `world.ts:moveCircle/lineOfSight`, `ai/bot.ts` |
| F7 | Muzzle/impact FX, tracers, generated audio | ✅ Done | `effects.ts`, `audio.ts` |
| F8 | Pause / victory / defeat / full restart | ✅ Done | `boot.ts:setMode/pause/resume/endMatch`, DOM screens in `Home.tsx` |
| F9 | Multiplayer rooms/match/combat | 🟡 Partial | Server core works (unit-tested over real sockets), client UI for lobby is absent — joining is URL-parameter driven only; no lobby screen exists |
| F10 | Bomb plant/defuse | ❌ Dead code | `systems/round.ts:plantBomb/defuseBomb` exist + are unit-tested, but **never called** by any game code (verified by grep) |
| F11 | Crouch (CROUCH_SPEED defined) | ❌ Not implemented | `config.ts:GAME.CROUCH_SPEED` unused in `input.ts`/`boot.ts` |
| F12 | Additional equipment (grenades, smoke, flash, defuse kit, helmet purchase) | ❌ Data-only | `config.ts:EQUIPMENT` defined; only armor is purchasable |

## 5. Non-Functional Requirements (observed, not formally specified)

- **NFR Performance:** fixed 60 Hz logic step decoupled from rendering (`engine.ts`); automatic
  pixel-ratio degradation below 42 FPS (`QUALITY.DEGRADE_FPS`, `boot.ts:render`); pooled
  particles/tracers (`effects.ts`); README reports 89 draw calls / ~41k triangles in a stress scene.
- **NFR Correctness of feel:** control-mapping conventions are fixed and asserted by the
  self-check (`scripts/verify-game.mjs` direction assertions; `input.ts` header contract).
- **NFR Resilience:** defensive `localStorage` wrapper; pointer-lock optional; audio context
  guarded. Physics failure, however, is not contained (see 02, CRIT-1).
- **NFR Testability:** pure logic modules (damage/round/economy/weapons/team) are separated
  and unit-tested; server protocol tested with real sockets; browser smoke test exists.
- **NFR Deployability:** static SPA build (`dist/`) + one Node process for the game server;
  no Docker/CI (none present).

## 6. Technology Stack & Justification

| Technology | Version | Used for | Justification (observed) |
|---|---|---|---|
| TypeScript | 5.9 | all code | shared types between client/server (`src/shared/types.ts`) |
| Vite | 7.x | dev server + bundler | fast HMR; custom `gameBuildOutput` plugin verifies build output (`scripts/build-output.ts`) |
| React 19 + react-router 7 | — | DOM shell only | template parity (`info.md`); no game state in React |
| Three.js | 0.180 | rendering | procedural map, shadowed lighting, GLB weapon models, Raycaster hit detection |
| @dimforge/rapier3d-compat | 0.17.3 | player capsule physics, raycasts | WASM physics; compat build loads `public/rapier_wasm3d_bg.wasm` |
| Socket.IO | 4.8 | multiplayer transport | rooms, reconnect semantics, single `message` channel |
| Vitest | 3.x | unit + server-integration tests | node environment, `src/**/*.test.ts` |
| Playwright | 1.56 | e2e + smoke self-check | `tests/multiplayer.e2e.ts`, `scripts/verify-game.mjs` |
| tsx | 4.x | run TS server in dev | `npm run dev:server` |
| concurrently | 9.x | run client+server | `npm run dev:all` |
| phaser, lucide-react, gltf-transform, meshoptimizer, sharp | preinstalled | **phaser/lucide-react unused** (verified: no imports); gltf-transform/meshoptimizer/sharp were asset pipeline tools | leftover template deps |

## 7. Out Of Scope / Not In The Product

- No user accounts, no external database, no backend API beyond the game socket server.
- No leaderboards across devices (README explicitly scopes this out).
- No CI/CD, no Docker, no monitoring (nothing present in repo).

## 8. Known Documentation Sources In Repo

| Document | Accuracy vs. code |
|---|---|
| `README.md` (Arabic) | Accurate for **solo mode**; does not mention the multiplayer server at all (undocumented feature) |
| `info.md` | Template guide. Describes `boot.ts` as "~100-line placeholder" — outdated (now 1,064 lines). Still authoritative on entry-point chain, verify contract, build plugin behavior |
| `CREDITS.md` | Accurate asset provenance for rifle/sniper GLBs |
| `environment.yml` | Conda env for notebooks — unrelated leftover of the workspace, not part of the game |
| `docs/architecture/*` (this set) | New — written from code |
