# SANDLINE — Architecture Documentation

Architecture documentation for **SANDLINE (game-3d-app)** — a browser-based tactical shooter
built with Three.js + React, with an authoritative Socket.IO multiplayer server.

This directory is the single source of truth for how the system is designed today, how it
should evolve, and how to work on it. It was produced from a full read of the source code
(every file in `src/`, `server/`, `scripts/`, `tests/`, and all configuration), not from
filenames or existing docs alone.

## Document Map

| # | Document | Contents |
|---|----------|----------|
| 1 | [01_PROJECT_OVERVIEW.md](01_PROJECT_OVERVIEW.md) | What the project is, functional & non-functional requirements, tech stack |
| 2 | [02_CURRENT_STATE_AUDIT.md](02_CURRENT_STATE_AUDIT.md) | Evidence-based audit of the current implementation: strengths, findings, severity |
| 3 | [03_ARCHITECTURAL_DECISIONS.md](03_ARCHITECTURAL_DECISIONS.md) | Current architectural decisions and their trade-offs |
| 4 | [04_SYSTEM_ARCHITECTURE.md](04_SYSTEM_ARCHITECTURE.md) | System-level architecture, diagrams, data flow |
| 5 | [05_COMPONENT_ARCHITECTURE.md](05_COMPONENT_ARCHITECTURE.md) | Per-component responsibilities, interfaces, boundaries |
| 6 | [06_DATABASE_ARCHITECTURE.md](06_DATABASE_ARCHITECTURE.md) | Current (no-database) state model and persistence options |
| 7 | [07_API_ARCHITECTURE.md](07_API_ARCHITECTURE.md) | Socket.IO protocol contract: every message, direction, payload |
| 8 | [08_SECURITY_ARCHITECTURE.md](08_SECURITY_ARCHITECTURE.md) | Threat model, server authority, validation gaps |
| 9 | [09_DEPLOYMENT_ARCHITECTURE.md](09_DEPLOYMENT_ARCHITECTURE.md) | Dev/test/prod environments, build pipeline, operations |
| 10 | [10_DEVELOPER_GUIDE.md](10_DEVELOPER_GUIDE.md) | How to navigate, run, extend, and not break the project |
| 11 | [11_IMPLEMENTATION_ROADMAP.md](11_IMPLEMENTATION_ROADMAP.md) | Phased, prioritized roadmap from current state to target architecture |
| 12 | [12_ARCHITECTURE_DECISION_RECORDS.md](12_ARCHITECTURE_DECISION_RECORDS.md) | ADR log (decided / proposed / superseded) |

## Reading Order

- **New developer on the project:** 01 → 04 → 05 → 10
- **Fixing a bug / investigating behavior:** 02 (findings index) → 05 (component owning the behavior) → 10
- **Planning the next milestone:** 02 → 11 → 12
- **Evaluating security or going to production:** 08 → 09 → 02

## Ground Rules Used To Produce This Documentation

1. Every claim is backed by a file path (and line number where useful). Items that could not
   be verified are explicitly marked **Unverified**.
2. Current architecture and target architecture are kept separate. Proposals never claim to
   already exist.
3. Features were classified as *completed*, *partially implemented*, *planned/dead code*, or
   *experimental* — never assumed complete because a file exists.
4. There is **no Git history** (the directory is not a repository), so development-phase
   reconstruction is based on code inspection only.

## Project Facts At A Glance

- **Product:** single-player tactical FPS vs. bots (complete, playable) + authoritative
  multiplayer (functional core, incomplete game loop) + React DOM shell.
- **Stack:** TypeScript, Vite 7, React 19, Three.js 0.180, Rapier3D (compat) physics,
  Socket.IO 4, Vitest, Playwright.
- **Runtime layout:** client dev server on port **3000**; game/multiplayer server on port
  **3001** (`server/index.ts`, tsx in dev); tests use their own ports (31337–31339).
- **Persistence:** none server-side (in-memory rooms); client-side `localStorage` only.
- **Repository state:** not a Git repository — no history, no branches, no CI.

Maintained by: see [10_DEVELOPER_GUIDE.md](10_DEVELOPER_GUIDE.md) for conventions before editing.
