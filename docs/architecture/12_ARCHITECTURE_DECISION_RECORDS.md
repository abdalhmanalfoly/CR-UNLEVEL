# 12 — Architecture Decision Records

Short-form ADRs. Status: **Accepted** (in the code today), **Proposed** (recommended, not
implemented), **Superseded**. Context → Decision → Consequences. Dates refer to audit
observation (Nov 2026); original authoring dates are unknown (no Git history — Unverified).

---

## ADR-001 — React DOM shell over full imperative page
**Status:** Accepted · **Context:** template parity + backend graftability (`info.md`).
**Decision:** React renders shell only; game loop imperative in `src/game/`.
**Consequences:** ✅ zero per-frame React cost; ❌ stringly-typed DOM-id contract between
`Home.tsx` and `boot.ts`.

## ADR-002 — Fixed-timestep 60 Hz simulation
**Status:** Accepted · **Decision:** `GameLoop` accumulator, 250 ms catch-up cap.
**Consequences:** ✅ deterministic-feeling gameplay; ❌ render interpolation (`alpha`) unused.

## ADR-003 — Dual collision model (Rapier capsule + custom AABB world)
**Status:** Accepted · **Decision:** Rapier for vertical physics/grounding; `world.ts`
circle-vs-AABB for walls + LOS; Three.js Raycaster for bullets.
**Consequences:** ✅ cheap tunable wall sliding; ❌ three collision truths; server has none.

## ADR-004 — Server authority over combat truth, client authority over feel
**Status:** Accepted · **Decision:** client streams intents; server clamps/resolves.
**Consequences:** ✅ cheat resistance for rate/ammo/speed; ❌ no reconciliation, no server
geometry (roadmap R-MP-1/R-MP-4).

## ADR-005 — Single generic Socket.IO `message` envelope
**Status:** Accepted · **Decision:** one event, `type` discriminator, shared union in
`src/shared/types.ts`.
**Consequences:** ✅ one contract file, easy logging/replay; ❌ no compile-time direction
checking (`as any` casts at the boundary). **Proposed follow-up:** tiny `send<T>()` helpers
typed per side (R-CORE-3).

## ADR-006 — No database; in-memory server state + localStorage client state
**Status:** Accepted · **Decision:** rooms die with the process; high score device-local.
**Consequences:** ✅ zero infra; ❌ restart loses matches; no accounts/leaderboards.
**Revisit trigger:** accounts or cross-device stats (06 §4).

## ADR-007 — Procedural map/audio; GLB only for weapon models
**Status:** Accepted · **Consequences:** ✅ tiny payload, data-driven map; ❌ art ceiling;
pistol GLB still missing (R-POL-1).

## ADR-008 — Mechanical self-verification of build + controls
**Status:** Accepted · **Decision:** `gameBuildOutput` plugin + `verify-game.mjs` gates
(canvas lit, direction mapping, console-clean).
**Consequences:** ✅ catches the historically worst defect classes in CI-able time;
❌ static-only (fails on backend calls at boot — documented, deliberate).

## ADR-009 — StrictMode stays enabled; double-mount is supported
**Status:** Accepted (behavior) / **Violated by implementation** · **Decision:** all
subsystems must survive init-twice + dispose/re-init.
**Consequences:** ❌ physics singleton violated it → **CRIT-1**.
**ADR-009a (Proposed):** generation-token + single wasm-init-promise hardening of
`collision.ts` (R-FIX-1). Priority: highest.

## ADR-010 — Client-side bot AI (FSM) for solo; no bots in MP
**Status:** Accepted · **Consequences:** ✅ offline play, data-tunable difficulty,
seeded determinism; ❌ solo and MP play completely differently; legacy `EnemyManager`
coexists (to be resolved by R-CORE-2).

## ADR-011 — Rules layer as pure shared modules (`src/game/systems/*`, `src/game/config.ts`)
**Status:** Accepted · **Decision:** framework-free modules imported by client AND server.
**Consequences:** ✅ one rules source (damage math reused server-side); ❌ `src/` is no
longer "client only" — documented in 10 §2; server duplicates some config anyway (spawn
tables — R-MP-1 cleanup).

## ADR-012 — Test isolation via dedicated ports per harness
**Status:** Accepted · **Decision:** vitest 31337/31338, e2e 31339, dev 3000/3001.
**Consequences:** ✅ no collisions; ❌ no single source of truth for the port map (HIGH-4,
fixed by R-FIX-4).

---

## Proposed (not yet decided/implemented)

| ADR | Proposal | Driver |
|---|---|---|
| **ADR-013** | Generation-token physics init (R-FIX-1) | CRIT-1 |
| **ADR-014** | Server match FSM completion + `match_over` (R-FIX-3) | CRIT-2 |
| **ADR-015** | Damage contract fix: server applies delta damage (R-FIX-2) | CRIT-3 |
| **ADR-016** | Boot decomposition into controllers (R-CORE-1) | HIGH-1 |
| **ADR-017** | Server modularization + boundary validation (R-CORE-3/5) | HIGH-3, MED-3 |
| **ADR-018** | Server-side map geometry for LOS/collision (R-MP-1) | MED-1, A8 |
| **ADR-019** | Throttled snapshots instead of per-input broadcast (R-MP-3) | MED-2 |
| **ADR-020** | Same-origin production deployment with reverse proxy (R-OPS-1) | 09 §3 |
| **ADR-021** | Bomb feature: wire it or delete it (R-GAME-1) | dead code |
| **ADR-022** | Remove phaser/lucide-react/state.ts dead weight (R-CORE-4/2) | MED-5 |

Each proposal must be re-validated against the codebase at implementation time; none
contradicts verified facts as of this audit.
