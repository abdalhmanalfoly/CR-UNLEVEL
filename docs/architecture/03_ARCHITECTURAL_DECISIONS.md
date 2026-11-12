# 03 — Architectural Decisions (Current)

Decisions actually embodied in the codebase, with rationale as far as it is observable and
their trade-offs. Proposed (not-yet-made) decisions live in 12_ARCHITECTURE_DECISION_RECORDS.md.

## D1 — React as a thin shell; the game loop never touches React state
- **Where:** `src/main.tsx` → `src/App.tsx` → `src/pages/Home.tsx` → `src/game/boot.ts` (template contract, `info.md`).
- **Decision:** React renders one route with a `<canvas>` + static HUD DOM; `startGame()` is
  called once in `useEffect`; the 60 Hz loop lives entirely in `src/game/` and mutates DOM ids directly.
- **Why (observed benefit):** zero per-frame React reconciliation; HUD updates are direct
  `textContent` writes (`boot.ts:updateUI()`); the template stays graftable to a backend.
- **Trade-off:** no reactive bindings → the HUD contract is stringly-typed DOM ids
  (`$("health")`, `$("crosshair")`, …) shared between `Home.tsx` markup and `boot.ts` —
  renaming an id breaks the game silently at runtime, not at compile time.

## D2 — Fixed-timestep simulation (60 Hz) decoupled from rendering
- **Where:** `src/game/engine.ts` (`GameLoop.STEP = 1/60`, accumulator, 250 ms catch-up cap).
- **Why:** deterministic-feeling movement/shooting independent of display Hz; spiral-of-death protection.
- **Trade-off:** `render(alpha)` interpolation exists but boot discards alpha
  (`render: () => this.render()`), so interpolation is unused — accepted as-is for now.

## D3 — Two cooperating collision systems (Rapier capsule + custom AABB world)
- **Where:** `src/game/systems/collision.ts` (Rapier: gravity, capsule, ground ray, jump) and
  `src/game/world.ts:moveCircle` (circle-vs-AABB axis-separated sliding against `MAP_BLOCKS`).
- **Why:** Rapier gives believable vertical physics cheaply; the AABB layer gives cheap,
  perfectly tunable wall sliding for a boxy map and is also the LOS source for AI/bots
  (`world.ts:lineOfSight`) and hit detection blockers (`world.collisionMeshes`).
- **Trade-off:** two sources of truth for "can I be here"; server has **neither** (it only
  speed-clamps, see 02 MED-1). Bullet-vs-wall checks are Three.js Raycaster, not Rapier —
  three collision models in one game.

## D4 — Client is authoritative for *feel*, server is authoritative for *truth* (MP)
- **Where:** client sends raw intents (`player_input` at frame rate); server clamps speed
  (`SERVER_MOVE_SPEED`, `MAX_POSITION_DELTA`), resolves fire (`handlePlayerFire` cone test),
  owns ammo/health/credits/respawn.
- **Why:** simplest architecture that prevents the most common cheats (speed, fire-rate, ammo).
- **Trade-off:** hit detection is a dot-product cone against player centers — no map
  geometry server-side, so walls don't block bullets on the server; positions can desync
  (no reconciliation client-side). Acceptable for co-op-scale play, not for competitive.

## D5 — One generic Socket.IO `message` envelope instead of typed events
- **Where:** `server/index.ts:208-222` (`socket.on("message")` + switch on `type`);
  `net/client.ts:handleServerMessage` mirrors it; types in `src/shared/types.ts`.
- **Why:** one channel simplifies logging/replay and keeps the protocol in one shared file
  (`src/shared/types.ts` is imported by both sides — the only true client/server contract).
- **Trade-off:** the compiler cannot check message directionality; both sides suppress it
  with `as any`/`as unknown as`. A discriminated-union-aware send would need small helpers.

## D6 — In-memory state only; no database
- **Where:** `server/index.ts` (`rooms`, `socketToRoom`, `socketToPlayerId` Maps), client
  `localStorage` for high score (`storage.ts`).
- **Why:** match state is ephemeral by nature; no requirement (yet) for accounts, profiles,
  or cross-device stats (README scopes leaderboards out).
- **Trade-off:** server restart loses everything; no observability; scaling requires a
  redesign (see 06).

## D7 — Procedural content over authored assets
- **Where:** map is `MAP_BLOCKS` data + procedural dunes/lamps/texture (`world.ts`); audio is
  synthesized (`audio.ts`); only weapon models are GLB files (rifle, sniper — `CREDITS.md`).
- **Why:** tiny payload, no asset pipeline dependency, deterministic map from config.
- **Trade-off:** art ceiling is low; adding hand-crafted maps means introducing an asset
  pipeline (gltf-transform tooling is already in devDependencies, unused at runtime).

## D8 — Self-verifying build pipeline instead of trust
- **Where:** `scripts/build-output.ts` (Vite plugin: reads back every emitted file, fails on
  stale output, prunes only tracked unchanged files; history in `.game-build-files.json`) and
  `scripts/verify-game.mjs` (Playwright: non-black canvas via `preserveDrawingBuffer`,
  Space → playing, W/D direction assertions via `window.__gameProbe`, pause check,
  zero-console-errors gate).
- **Why:** the most common historical defect classes (reversed controls, black canvas,
  missing output) are asserted mechanically — an unusually strong guard for a game project.
- **Trade-off:** the self-check is a **static** server; any `/api/*` or socket use at boot
  would 404 and fail the check (documented in `info.md`); SwiftShader results are not GPU-perf data.

## D9 — Test ports are isolated from dev ports
- **Where:** vitest server tests boot `server/index.ts` themselves on 31337/31338 (dynamic
  `process.env.PORT` before import); Playwright e2e uses webServer on 31339 + `vite preview`
  on 3000; dev client/server use 3000/3001.
- **Why:** tests never collide with a running dev server; vitest "node" environment keeps
  them CI-friendly without browsers.
- **Trade-off:** five port constants across four files with no single source of truth
  (see 02 HIGH-4).

## D10 — StrictMode stays on; double-mount is a real-world scenario
- **Where:** `src/main.tsx` (`<StrictMode>`), `Home.tsx` effect `startGame`/`stopGame` pairing,
  `boot.ts:startGame()` calling `stopGame()` first (template-required property, `info.md`).
- **Why:** guarantees no double renderers/audio contexts; mirrors React's future semantics.
- **Trade-off:** module-singleton subsystems (physics) must be idempotent across
  mount/unmount — which is precisely the gap of CRIT-1. Any new global must satisfy:
  *safe to init twice, safe to dispose then re-init*.

## D11 — Bot AI as a client-side FSM, server-independent
- **Where:** `src/game/ai/bot.ts` (18 states, per-difficulty perception/reaction/accuracy
  tables, cover/strafe/flank behaviors, seeded RNG per bot id).
- **Why:** solo mode needs no server; difficulty is tunable purely in data
  (`DIFFICULTY` table); deterministic seeds make behavior reproducible for tests.
- **Trade-off:** bot difficulty/behavior differs completely from MP opponents (players);
  bots do not exist in MP (matches are PvP-only today).
