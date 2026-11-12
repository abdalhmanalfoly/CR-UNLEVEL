# 04 — System Architecture

## 1. Architectural Style (current)

**Client-heavy multiplayer game in two topologies:**

1. **Solo mode (default):** single-tier client application. Browser runs rendering,
   simulation, AI, and rules locally. No server involved.
2. **Multiplayer mode (`?mp=1`):** client/server. Browser is a *dumb terminal for state* +
   *smart predictor for feel* (local physics), while `server/index.ts` (Socket.IO, in-memory)
   is authoritative over movement validity, combat resolution, economy, and respawn.

Both topologies share one codebase and one protocol file. There is **no database, no external
service, no message broker** — and none is currently needed (see 06).

## 2. Context Diagram (C1)

```mermaid
flowchart LR
    subgraph Player
        U(("Player<br/>(keyboard + mouse)"))
    end

    subgraph Browser["Browser (SPA, static)"]
        RS["React shell<br/>main.tsx / App.tsx / Home.tsx<br/>canvas + HUD DOM"]
        GC["Game core (imperative)<br/>boot.ts → engine/world/bots/effects/audio"]
        PH["Rapier WASM<br/>public/rapier_wasm3d_bg.wasm"]
        NC["NetworkClient<br/>net/client.ts"]
        LS[("localStorage<br/>high score")]
    end

    subgraph NodeJS["Node.js process"]
        GS["Game server<br/>server/index.ts<br/>in-memory rooms + 30Hz tick"]
    end

    U -->|DOM events| RS
    RS -->|startGame/stopGame| GC
    GC --- PH
    GC -->|localStorage| LS
    GC <-->|typed protocol over Socket.IO| NC
    NC <-->|"wss/socket.io (single 'message' envelope)"| GS
```

- Solo mode: `GC` alone (NC idle, GS not contacted).
- Multiplayer: `GC` still simulates locally (movement/physics/rendering) but delegates
  combat truth, purchases, respawn, and round state to `GS`.

## 3. Component Diagram (C2)

```mermaid
flowchart TB
    subgraph Client["Client (src/)"]
        direction TB
        subgraph Shell["React shell"]
            MAIN["main.tsx<br/>StrictMode + Router"]
            APP["App.tsx"]
            HOME["pages/Home.tsx<br/>canvas + HUD + screens"]
        end
        subgraph GameCore["game core (src/game/)"]
            BOOT["boot.ts — Game class<br/>(orchestrator, 1064 lines)"]
            ENG["engine.ts — 60Hz loop"]
            WRLD["world.ts — map, AABB collision, LOS"]
            INP["input.ts — keys/mouse/touch"]
            AUD["audio.ts — Web Audio SFX/music"]
            EFF["effects.ts — tracers/particles pools"]
            STO["storage.ts — localStorage"]
            ENM["enemies.ts — legacy enemy system"]
            subgraph AI["ai/"]
                BOT["bot.ts — BotManager + FSM bots"]
            end
            subgraph SYS["systems/"]
                RND["round.ts — round FSM"]
                WPN["weapons.ts — roster/ammo"]
                ECO["economy.ts — credits"]
                DMG["damage.ts — hit regions"]
                COL["collision.ts — Rapier singleton"]
                TEAM["team.ts — alive counts"]
            end
            subgraph NETL["net/"]
                CLI["client.ts — NetworkClient"]
            end
        end
        subgraph Shared
            TYPES["shared/types.ts — protocol types"]
            CFG["game/config.ts — tunables, map data"]
        end
    end

    subgraph Server["server/"]
        SRV["index.ts — rooms, tick, handlers"]
    end

    MAIN --> APP --> HOME
    HOME --> BOOT
    BOOT --> ENG & WRLD & INP & AUD & EFF & STO & ENM & BOT & RND & WPN & ECO & DMG & COL & TEAM & CLI
    BOT --> WRLD
    CLI --> TYPES
    SRV --> TYPES
    SRV --> DMG
    SRV --> CFG
    BOOT --> CFG
```

Note the server importing **client-tree** modules (`src/game/systems/damage.ts`,
`src/game/config.ts`): `src/` is a *shared library*, not purely client code. This is
intentional (single source of truth for rules) but blurs the directory meaning — documented
in 10_DEVELOPER_GUIDE.md.

## 4. Runtime Data Flow

### 4.1 Solo frame (every 1/60 s)

```mermaid
sequenceDiagram
    participant L as GameLoop (engine.ts)
    participant G as Game (boot.ts)
    participant C as collision.ts (Rapier)
    participant W as World (world.ts)
    participant B as BotManager (ai/bot.ts)
    participant R as RoundManager
    participant D as DOM HUD

    L->>G: update(1/60)  [fixed step, may run 0..N times per frame]
    G->>W: world.update(dt) — dust drift
    G->>G: handleActions() — Space/Esc/R/1/2
    G->>C: stepPhysics(dt)
    G->>R: roundManager.update(dt) — buy/freeze/active timers
    alt mode == playing
        G->>C: getPlayerPosition() → playerPos
        G->>G: consumeLook() → yaw/pitch
        G->>C: movePlayer(vx,0,vz) / jumpPlayer()
        G->>C: isPlayerGrounded() (ray)
        opt trigger held
            G->>G: fire() — Raycaster vs walls+bots+enemies
            G->>B: damageBot() → callbacks → credits/killfeed
            G->>D: hitmarker / tracer / flash
        end
        G->>B: botManager.update(dt, playerPos, alive)
        B->>W: lineOfSight() → onBotFire callback
        G->>G: damagePlayer(applyDamage) — grace, armor
        G->>R: elimination / time checks
    end
    G->>D: updateUI() — health/ammo/timer/score
    L->>G: render() — draw scene, FPS degrade guard
```

### 4.2 Multiplayer session (room → match)

```mermaid
sequenceDiagram
    participant H as Home.tsx (?mp=1)
    participant G as Game (boot.ts)
    participant N as NetworkClient
    participant S as server/index.ts

    H->>G: startGame(canvas, {serverUrl, name, room})
    G->>N: connect(serverUrl)
    N->>S: socket connect
    S-->>N: connection_status
    N-->>G: onConnect → joinRoom(room)|createRoom()
    G->>S: join_room / create_room
    S-->>G: room_joined / room_created (+ player_list)
    G->>G: spawnRemotePlayer() for each other player
    Note over S: host starts (≥2 ready)
    S-->>G: match_start (spawns, full player info)
    G->>G: setMode("playing"), pointer lock

    loop every rendered frame (~60/s)
        G->>S: player_input {move, yaw, pitch, fire, aim, reload, weapon, jump}
        S->>S: validate speed/dt → integrate position
        S-->>G: player_updated (per input, to whole room)
        opt fire
            S->>S: rate-limit, ammo--, cone hit-test, calculateDamage
            S-->>G: shoot_validated / player_died / score_update
            S-->>G: round_state ("ending") on team wipe
        end
        S-->>G: reloaded / weapon_switched / player_respawned (3s)
    end
    Note over S: ⚠ no time-expiry, no next round, no match_over (audit CRIT-2)
```

## 5. State Machines

### 5.1 Client game modes (`boot.ts:Mode` — *de facto* state machine)
`title → playing ⇄ paused → (victory | gameover)`; `playing → buy → playing` per round;
transitions enforced by `setMode()` toggling DOM screens (`title/buy/pause/end`).

### 5.2 Round FSM (`systems/round.ts` — shared concept, client-side authoritative in solo)

```mermaid
stateDiagram-v2
    [*] --> menu
    menu --> buy: startMatch()
    buy --> freeze: buyTimer<=0 / startRound()
    freeze --> active: roundTimer<=0
    active --> bombPlanted: plantBomb() [DEAD CODE — never called]
    bombPlanted --> ending: defused / detonated
    active --> ending: endRound() (elimination | time_expired)
    ending --> summary: nextRound()
    summary --> buy: nextRound()
    summary --> sideSwitch: every 2nd round
    sideSwitch --> buy
    ending --> matchOver: winner determined
    summary --> matchOver: winner determined
    matchOver --> [*]
```

### 5.3 Server room FSM (`server/index.ts`)
`waiting → (startMatch) → in_progress` … and nothing further (no `finished` transition is
ever executed — audit CRIT-2).

### 5.4 Bot FSM (`ai/bot.ts`)
18 states: `idle, guard, patrol, moveToObjective, seekCover, investigate, search,
acquireTarget, aiming, engaging, reloading, retreating, flanking, supportTeammate, planting,
defusing, rotate, dead` — driven by perception timers, difficulty tables, and LOS raycasts.

## 6. External Integrations
**None.** No HTTP API, no database, no third-party services, no analytics, no CDN assets
(everything is same-origin; `vite.config.ts base: "./"`). The only I/O beyond sockets:
`localStorage` and GLB/WASM fetches from `public/`.

## 7. Infrastructure Requirements (current truth)
- One static file host (or any SPA server) for the client build.
- One Node.js process (`server/index.ts`) when MP is used. Node ≥ 20.19 recommended
  (Vite 7 requirement — observed warning on 20.16).
- Nothing else.
