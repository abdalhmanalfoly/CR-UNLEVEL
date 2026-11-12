# 10 — Developer Guide

Everything a developer needs to work on SANDLINE without tribal knowledge.

## 1. Getting Started

```bash
npm install
npm run dev:all        # client :3000 + game server :3001 (concurrently)
# open http://localhost:3000
```

Useful scripts (all verified in `package.json`):

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev client, port 3000 |
| `npm run dev:server` | game server via tsx, port 3001 (`PORT` env overrides) |
| `npm run dev:all` | both at once |
| `npm run check` | `tsc -b` — **client types only** (server is excluded, see §8) |
| `npm run build` | `tsc -b && vite build` → `dist/` with output verification |
| `npm run preview` | serve the built client (static) |
| `npm run test` | vitest: unit + real-socket MP tests (ports 31337/31338) |
| `npm run verify` | Playwright smoke self-check against `dist/` (build first!) |

**URL params:** `?state=play|busy` (jump into game for tests), `?mp=1&server=<url>&name=<n>&room=<code>` (multiplayer).

**Node version:** use Node ≥ 20.19 (Vite 7 warns below that; observed on 20.16).

## 2. Repository Map (what lives where)

```
index.html                 SPA shell, loads /src/main.tsx
src/
  main.tsx                 React root (StrictMode — double-mounts effects in dev!)
  App.tsx                  route "/" only
  pages/Home.tsx           canvas + ALL HUD/screens DOM (ids are a hard contract)
  game/
    boot.ts                Game orchestrator (startGame/stopGame) — 90% of wiring
    engine.ts              fixed 60Hz loop
    world.ts               map build + AABB collision + LOS
    config.ts              ALL tunables: GAME/WEAPONS/EQUIPMENT/MAP_BLOCKS/spawns
    input.ts               key/mouse → axes/actions (mapping conventions are FIXED)
    audio.ts               WebAudio synth SFX/music + mute
    effects.ts             pooled tracers/bursts/flash
    enemies.ts             LEGACY enemy system (superseded by bots — do not extend)
    state.ts               GameStateMachine (UNUSED in game flow)
    storage.ts             defensive localStorage wrapper
    ai/bot.ts              BotManager + 18-state FSM bots
    systems/
      collision.ts         Rapier singleton (init/capsule/step/raycast)
      round.ts             round FSM (bomb methods exist but are unwired)
      weapons.ts           roster/ammo/purchase logic
      damage.ts            hit regions/armor math (SHARED with server)
      economy.ts           credits
      team.ts              alive counts/stats
    net/client.ts          Socket.IO client + message dispatch
  shared/types.ts          protocol types — THE client/server contract
server/index.ts            authoritative MP server (rooms/tick/combat)
scripts/
  build-output.ts          Vite plugin: output verification + pruning
  verify-game.mjs          Playwright smoke self-check (build first)
tests/multiplayer.e2e.ts   Playwright e2e (server :31339 + vite preview :3000)
docs/architecture/         this documentation set
public/assets/weapons/     rifle/ sniper/ GLBs (pistol missing → fallback)
public/rapier_wasm3d_bg.wasm
```

## 3. The Non-Negotiable Contracts

Breaking any of these breaks the game or its tests **at runtime**:

1. **DOM ids** (full list in 05 §5.1) — `Home.tsx` ↔ `boot.ts` pairs.
2. **`window.__GAME_READY__ = true`** on first rendered frame; `window.__gameProbe()` →
   player coordinates; `__ASSETS_READY__` when 3 weapon assets loaded — the verify script depends on them.
3. **Input mapping conventions** (`input.ts` header): W forward (z decreasing), D right
   (x increasing). If you change them, sync `scripts/verify-game.mjs` assertions.
4. **`<canvas id="game-canvas">`** — verify script looks it up by id (`CANVAS_ID`).
5. **startGame/stopGame pairing** must survive StrictMode double-mount: any module-global
   you add must be *safe to init twice and dispose/re-init* (the physics singleton failed
   this once — see §7 and 02 CRIT-1).
6. **Build plugin behavior:** never delete `dist/` to "fix" a build; read the failure
   (stale output), fix, rebuild once. `.game-build-files.json` must stay.
7. **Protocol compatibility:** changing any `src/shared/types.ts` message means updating
   `server/index.ts` handlers AND `net/client.ts` dispatch AND the two vitest MP suites.

## 4. How To Add Things

### A new weapon
1. `src/game/config.ts` → add to `WEAPONS` (all fields required: damage/headDamage/interval/
   magazine/reserve/reload/spread/moveSpread/recoil/automatic/cost/fov/range/armorPen/icon).
2. Server automatically honors it (`WEAPONS[shooter.weapon]` lookups).
3. To make it buyable: add a `data-buy` card in `Home.tsx` buy-grid + handle in `boot.ts:buy()`
   + `updateBuyUI()`.
4. Optional: drop `public/assets/weapons/<id>/model.glb` and add the id to the
   `loadWeapons()` list; without a GLB you get the procedural fallback automatically.

### A new map block / spawn
`config.ts:MAP_BLOCKS` / `ATTACKER_SPAWNS` / `DEFENDER_SPAWNS` / `ENEMY_SPAWNS` /
`BOMB_SITES`. The server uses the spawn tables — keep server-side duplicates in
`server/index.ts:startMatch()` in mind (known duplication, roadmap R-MP-1).

### A new protocol message
1. Type in `src/shared/types.ts` (both C2S and S2C sides as needed).
2. Server handler + dispatch case in `server/index.ts`.
3. Client: `on…` callback + dispatch case in `net/client.ts`; wire behavior in `boot.ts`.
4. Extend `net/multiplayer*.test.ts` (they drive a real server over sockets).

### A new game system (pure logic)
Follow `systems/*` pattern: no DOM, no three.js, no sockets — inject config via constructor,
return values, export types. Add cases to `systems.test.ts`. This keeps it testable and
server-shareable (that's how `damage.ts` got reused by the server).

### A new screen/mode
Add DOM to `Home.tsx` + id, extend `Mode` union + `setMode()` in `boot.ts`, add transition
gates in `handleActions()`.

## 5. Testing Workflow

```bash
npm run test          # fast logic + protocol tests (no browser)
npm run check         # types (client)
npm run build         # must pass before verify
npm run verify        # browser smoke: render, controls direction, pause, console-clean
npx playwright test   # tests/multiplayer.e2e.ts (boots its own servers)
```

- MP tests boot the real server on fixed ports — close other servers or they collide
  (vitest tests do NOT use `reuseExistingServer`; playwright e2e does).
- `verify-game.mjs` is a **static** server: it will fail on console errors caused by
  missing backends — by design (template contract, `info.md`).
- Playwright/headless renders via SwiftShader: treat its fps numbers as meaningless.

## 6. Debug Hooks (already built in)

| Hook | Gives |
|---|---|
| `window.__gameProbe()` | player `{x,y,z}` |
| `window.__gameDebug()` | mode, health/armor/credits, round, enemies, draw calls, triangles, fps, assets loaded, lastShot detail, weapon box |
| `window.__gameTest` | `start()`, `busy()`, `target()`, `winRound()`, `loseRound()`, `end(victory)` |
| `window.__ASSETS_READY__` / `window.__GAME_READY__` | load gates |
| `window.__roomCode` / `window.__networkClient` | MP room + raw client for console experiments |
| `?state=play` / `?state=busy` | jump straight into a match |

## 7. Known Traps (read before debugging "weird" behavior)

1. **StrictMode double-mount (dev):** effects run twice; subsystems must be idempotent.
   If you see rapier wasm `RuntimeError: unreachable` / "recursive use … unsafe aliasing" +
   a stuck camera at origin in dev — that's CRIT-1, not your change.
2. **Pistol GLB missing** → `Weapon asset pistol unavailable; using local fallback` warning
   is expected; add `public/assets/weapons/pistol/model.glb` to silence it.
3. **`npm run check` does not check the server.** Type errors in `server/index.ts` surface
   only when running tsx/vitest.
4. **Phaser and lucide-react are installed but unused.** Don't reach for them by reflex.
5. **Round `winScore` in solo** is 3 of 3 rounds (computed, not the majority-2 you might
   expect) — match-over actually triggers via the `maxRounds` guard; don't "fix" one side
   without the other (02 MED-4).
6. **MP matches never end** (no time expiry/next round server-side — CRIT-2) — if your e2e
   waits for `match_over`, it will hang.
7. **Port map:** dev 3000 (client) / 3001 (server) / 31337 & 31338 (vitest MP) /
   31339 (playwright e2e server). `?mp=1` without `?server=` hits 31337 — nothing runs there
   in normal dev (HIGH-4).

## 8. Type-Checking The Server (current gap)

`tsconfig.server.json` exists but is **not referenced** by the solution `tsconfig.json`.
Until that changes (roadmap R-CORE-4), validate server changes via:
`npx tsc -p tsconfig.server.json --noEmit` or rely on vitest MP tests.

## 9. Coding Conventions (as observed — keep consistent)

- ESM everywhere (`"type": "module"`); imports with `@/` alias for `src/`.
- No classes-with-inheritance; plain classes with private fields, builder-style fluent
  descriptors for physics (`RigidBodyDesc…`).
- File-header doc comments stating responsibility + invariants (follow the existing style).
- UI strings: Arabic (RTL). Keep numerals/IDs Latin.
- Immutable-ish config: `as const` objects; seeded RNG via `mulberry32` for determinism.
- Preallocated `THREE.Vector3` scratch objects at module scope in hot paths (`_v1`, `_origin`, …).
- Error handling: browsers guard everything user-facing (storage, pointer lock, audio);
  pure systems throw nothing and return status values.
- No lint/format tooling configured — match surrounding style manually.

## 10. Where To Make Which Change (quick routing)

| I want to… | Touch |
|---|---|
| Tune movement/jump/gravity/timers | `config.ts:GAME` (client) — remember server has its own constants |
| Tune weapon feel | `config.ts:WEAPONS` (client+server shared) |
| Change the map | `config.ts:MAP_BLOCKS` (+ server spawn dupes if spawns change) |
| Fix a control bug | `input.ts` (+ `verify-game.mjs` assertions) |
| Fix combat math | `systems/damage.ts` — then check server usage (CRIT-3 context) |
| Add UI element | `Home.tsx` DOM + `boot.ts:updateUI()` |
| Change multiplayer behavior | `server/index.ts` + `shared/types.ts` + `net/client.ts` + tests |
| Improve bots | `ai/bot.ts` (difficulty tables + FSM) |
| Optimize rendering | `boot.ts` renderer setup, `effects.ts` pools, `world.ts` geometry, `QUALITY` config |
