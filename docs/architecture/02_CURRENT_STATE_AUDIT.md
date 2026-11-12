# 02 — Current State Audit

Read-only, evidence-based assessment of the implementation as inspected (full read of
`src/`, `server/`, `scripts/`, `tests/`, all configs). Severity: **Critical / High / Medium / Low**.
Every finding cites its location. "Unverified" marks what could not be confirmed.

---

## A. What Is Genuinely Working (do not break these)

| # | Verified capability | Evidence |
|---|---|---|
| W1 | Build + type-check pass: `tsc -b` exits clean | executed during audit |
| W2 | Solo game loop: fixed-timestep 60 Hz, render decoupled, FPS degradation guard | `engine.ts`, `boot.ts:render()` |
| W3 | Round/economy/weapons/damage/team logic is pure, deterministic, unit-tested (18+ assertions) | `src/game/systems/*.ts`, `systems.test.ts` |
| W4 | Authoritative MP server core: rooms, team balance, start gating (host + ≥2 ready), movement speed clamps, fire cone hit-test, reload, purchases, deaths, timed respawn — integration-tested over real sockets on port 31338 | `server/index.ts`, `net/multiplayer2.test.ts` |
| W5 | Smoke self-check pipeline: build-output verification plugin + Playwright render/direction/pause/console checks | `scripts/build-output.ts`, `scripts/verify-game.mjs` |
| W6 | Clean teardown contract: `dispose()` releases loop, listeners, audio, bots, GPU resources, globals | `boot.ts:dispose()` |
| W7 | Weapon GLBs for rifle/sniper load, auto-centered/scaled, fall back to procedural geometry on failure | `boot.ts:loadWeapons()`, `public/assets/weapons/` |

---

## B. Findings

### CRIT-1 — Physics singleton is corrupted by React StrictMode double-mount (dev)
- **Location:** `src/game/systems/collision.ts` (module state + `initPhysics`), `src/pages/Home.tsx:6-19`, `src/main.tsx:8` (`<StrictMode>`), `src/game/boot.ts:1056-1063`.
- **Evidence (reproduced live during this audit):** In dev, StrictMode mounts `Home` twice:
  `startGame()` runs, then unmount runs `stopGame()` → `disposePhysics()` (world = null),
  then second `startGame()` calls `initPhysics()` again while the first `RAPIER.init()` is
  still in flight. Result observed in the browser console: two Emscripten init warnings,
  then `RuntimeError: unreachable` (wasm) and `recursive use of an object … unsafe aliasing
  in rust` from rapier. Consequence: player capsule never usable → `getPlayerPosition()`
  returns `null` → `this.playerPos` stays `(0,0,0)` → camera sits at ground level inside the
  map and `movePlayer()` no-ops. Exactly the reported symptom: "scene broken, player can't move".
- **Impact:** In dev, the game is broken at random depending on timing (sometimes works).
  In production build StrictMode double-invoke does not apply, which is why the delivered
  build passed its checks while dev was broken.
- **Severity:** **Critical** (blocks all development iteration).
- **Recommended fix:** make `initPhysics` idempotent and generation-aware: keep a single
  module-level `wasmReady`/init promise that survives `disposePhysics()`, capture a
  generation token bumped by `disposePhysics()`, and only assign `world` if the token is
  still current. Never run two concurrent `RAPIER.init()` calls.

### CRIT-2 — Multiplayer match never progresses past round 1
- **Location:** `server/index.ts` tick loop (lines ~729-790).
- **Evidence:** The tick only transitions `buy → freeze → active` and handles respawn. There
  is **no** handling of round-time expiry in `active` (no `time_expired`), no next-round
  logic, no score threshold check, and `match_over` is never emitted (grep: 0 matches for
  `match_over|nextRound|winScore` in `server/index.ts`). After a team elimination sets
  `roundState = "ending"`, nothing ever advances state; `room.status` stays `"in_progress"` forever.
- **Impact:** A multiplayer match can never finish; score display is the only feedback.
- **Severity:** **Critical** for the MP feature (feature incomplete at the game-loop level).

### CRIT-3 — Server damage calculation heals players who are already damaged
- **Location:** `src/game/systems/damage.ts:76` (`remainingHealth = Math.max(0, 100 - finalDamage)` — "caller applies to current health") vs `server/index.ts:599` (`hitTarget.health = result.remainingHealth`).
- **Evidence:** `calculateDamage` computes remaining health **from 100**, not from the
  victim's current health. The server assigns that directly to `hitTarget.health`.
  A player at 40 HP taking 17 damage becomes 83 HP.
- **Impact:** Combat outcomes in MP are wrong; kills are harder than intended; unit tests
  only cover the pure function, not the server's use of it.
- **Severity:** **Critical** (gameplay correctness in MP).
- **Fix:** server must apply `result.damage` to current health: `hitTarget.health = Math.max(0, hitTarget.health - result.damage)`.

### HIGH-1 — `boot.ts` is a God-class (~1,064 lines, 20+ responsibilities)
- **Location:** `src/game/boot.ts`.
- **Evidence:** `Game` owns rendering, camera, DOM/UI updates via `$(id)`, input flow,
  audio triggers, economy, round flow, bots, weapon models, multiplayer wiring (24 network
  callback assignments), effects, hit detection, pause/pointer-lock, test hooks.
- **Impact:** Any change risks unrelated breakage; untestable as a unit; the class also
  reaches into privates of other classes: `this.roundManager["round"] = round` (`boot.ts:249-250, 315-316`).
- **Severity:** High (maintainability, the top structural debt).
- **Direction:** split into presentation (HUD controller), orchestration (thin Game),
  and feature controllers (solo match controller, MP match controller).

### HIGH-2 — Two enemy systems coexist; one is legacy
- **Location:** `src/game/enemies.ts` (`EnemyManager`, instantiated at `boot.ts:150`, shot in
  `boot.ts:fire()` via `enemyTargets`) vs `src/game/ai/bot.ts` (`BotManager`, the actual round
  opponents spawned by `spawnBotsForRound`).
- **Evidence:** Round win condition checks only bots: `this.botManager.getAliveCount() === 0`
  (`boot.ts:714, 758`). `EnemyManager` enemies are spawned nowhere in normal flow (spawn list
  `ENEMY_SPAWNS` unused by boot outside `__gameTest`).
- **Impact:** Wasted raycast targets each shot, duplicated concepts, confused ownership
  (kills/credits paths exist for both: `boot.ts:677-694`).
- **Severity:** High (dead weight in the hot path + ambiguity). Remove or clearly re-purpose.

### HIGH-3 — Server is a single 796-line file mixing transport, domain, and infra
- **Location:** `server/index.ts`.
- **Evidence:** one file contains: transport wiring (`io.on("connection")` + a generic
  `"message"` envelope with `switch (type)`), room domain logic, combat resolution,
  economy, respawn, tick loop, and constants. Message payloads are cast through
  `as unknown as C2S…` with no runtime validation. All emits are `as any`.
- **Impact:** untyped boundary (bugs like CRIT-3 survive), no module boundaries for growth,
  duplicated spawn tables (hardcoded `attackerSpawns`/`defenderSpawns` at `server/index.ts:168-169`
  duplicate `config.ts:ATTACKER_SPAWNS/DEFENDER_SPAWNS`).
- **Severity:** High.

### HIGH-4 — Client/MP server port contract is inconsistent
- **Location:** `src/pages/Home.tsx:12` defaults `serverUrl = http://localhost:31337`;
  `server/index.ts:22` defaults `PORT = 3001`; `package.json:dev:server` runs it as `3001`;
  `multiplayer.test.ts` uses 31337; `multiplayer2.test.ts` uses 31338; `playwright.config.ts`
  webServer uses 31339; vite dev is 3000.
- **Impact:** `?mp=1` without an explicit `?server=` param connects to a port nothing
  listens on in normal dev (31337) — the default MP path is broken unless the developer
  knows to pass the param.
- **Severity:** High (feature-blocking for the default path), trivial fix.

### MED-1 — Player position is never reconciled with server authority client-side in MP
- **Location:** `boot.ts:855-856` (`getPlayerPosition()` → local Rapier sim), `onPlayerUpdated`
  only updates *remote* players.
- **Evidence:** Client sends inputs; server clamps and broadcasts positions; client never
  applies server correction to its own capsule (no reconciliation/rollback), and the server
  has no wall geometry so players can walk through walls server-side.
- **Impact:** position drift and desync are inevitable in MP; server-side noclip.
- **Severity:** Medium for current MP scope (will become High with competitive play).

### MED-2 — Protocol messages sent per-frame with full-room fan-out
- **Location:** `boot.ts:922-934` sends `player_input` every rendered frame (~60/s per client);
  `server/index.ts:533-537` broadcasts `player_updated` to the entire room for every input.
- **Impact:** O(players²) messages × 60 Hz; fine for 2-3 players, collapses at room scale.
- **Severity:** Medium.

### MED-3 — No runtime validation/limits at the server boundary
- **Location:** `server/index.ts:208-222`.
- **Evidence:** `data.playerName`, `data.roomName`, `data.maxPlayers` (accepted up to any
  number; `maxPlayers ?? 10` — a client can set maxPlayers to 10,000), no string length
  limits, no message size limits, no rate limiting beyond weapon interval, no per-socket
  message frequency cap.
- **Impact:** resource abuse (room spam up to MAX_ROOMS=100, huge names broadcast to all),
  protocol confusion; **no XSS found today** because names are never inserted into DOM
  (`killfeed` innerHTML is a fixed string, `boot.ts:751-752`), but any future use of names
  in HTML would become an injection vector.
- **Severity:** Medium (before public deployment: High).

### MED-4 — `RoundManager` public API has encapsulation holes and config drift
- **Location:** `systems/round.ts` vs `boot.ts:154-155` (`maxRounds: 3, winScore: Math.ceil(3/2)+1 = 3`).
- **Evidence:** `winScore=3` with 3 rounds means the `winner` getter never triggers during
  play; match-over is instead reached via `nextRound()`'s `round > maxRounds` guard, and
  victory is re-derived from scores in `endMatch()`. Works, but the "winScore" concept is
  inert in solo; defaults (`maxRounds: 12, winScore: 7`) differ from boot overrides.
- **Severity:** Medium (logic works; semantics confusing; bug-prone when tuning).

### MED-5 — Orphaned/unused template code adds cognitive load
- **Location/evidence:**
  - `src/game/state.ts` `GameStateMachine` — never imported by game code (grep: definition + tests only).
  - `src/game/engine.ts` interpolation `render(alpha)` param unused by boot (`render: () => this.render()`).
  - `phaser`, `lucide-react` dependencies — no imports anywhere.
  - `tsconfig.server.json` — **not referenced** by the solution `tsconfig.json` (only app+node), so the server is never type-checked by `npm run check`; it type-checks only implicitly through tsx execution and vitest imports.
  - `environment.yml` — workspace leftover, unrelated.
- **Severity:** Medium (maintenance noise; the tsconfig gap is a real blind spot).

### LOW-1 — Weapon asset `pistol/model.glb` missing
- **Evidence:** `public/assets/weapons/` contains only `rifle/` and `sniper/`; console warning
  `Weapon asset pistol unavailable; using local fallback` reproduced live. Fallback works.
- **Severity:** Low (cosmetic), one-file fix.

### LOW-2 — Dead/decorative HUD contract
- `Home.tsx` HUD shows "الجولة 1 / 3" and "4 خصوم" as initial markup; `updateUI()` overwrites
  them per frame — harmless but the initial values are fiction. Killfeed label `특수 요원`
  (`boot.ts:752`) is a non-Arabic artifact string shown to users.
- **Severity:** Low (polish).

### LOW-3 — Server room GC edge cases
- `disconnect` schedules an empty-room check 10 s later and re-reads `rooms` — OK — but
  never calls `broadcastRoomList()` after auto-deletion; `room_closed` is broadcast to a
  room that was just deleted. `lastActivity` is written but never used for expiry.
- **Severity:** Low (leak is bounded by MAX_ROOMS and cleanup condition).

---

## C. Documentation vs Reality

| Topic | Docs say | Reality |
|---|---|---|
| `boot.ts` placeholder | `info.md`: "~100-line minimal scene" | 1,064-line full game — outdated |
| Multiplayer | `README.md`: silent | 796-line authoritative server + protocol + tests — undocumented |
| Bomb gameplay | implied by `round.ts` states | dead code, never wired (grep-verified) |
| MP respawn | not documented anywhere | implemented server-side (3 s) — undocumented feature |
| Deploy | `npm run build && npm run preview` | verified to exist; **no production story for the socket server** (preview is static-only) — gap |

## D. Development Phase Classification

| Feature | Class |
|---|---|
| Solo round-based FPS (movement, bots, weapons, economy, FX, audio, UI, restart) | **Completed & verified** (build + live run + tests) |
| Multiplayer server core (rooms, combat, respawn, purchases) | **Completed core, incomplete game loop** (CRIT-2/CRIT-3) |
| Multiplayer client experience (lobby UI, match end, reconciliation) | **Partially implemented** |
| Bomb plant/defuse | **Planned** (logic + tests exist; no wiring) |
| Crouch, grenades/smoke/flash, SMG/shotgun/knife purchase | **Planned/data-only** |
| `EnemyManager` legacy system | **Experimental/legacy** (superseded by bots) |
| Authentication, persistence, CI, Docker | **Absent** |

## E. Single Points Of Failure

1. `boot.ts` — everything passes through one class (HIGH-1).
2. `collision.ts` module singletons — one corrupted init breaks the entire game (CRIT-1).
3. `server/index.ts` — one process, in-memory state; restart = total state loss (by design for now).
4. Node version: Vite 7 requires Node ≥20.19; environment had 20.16 (warning observed live).
