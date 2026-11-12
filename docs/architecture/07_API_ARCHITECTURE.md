# 07 — API / Protocol Architecture

There is **no HTTP API**. The entire client↔server contract is a Socket.IO connection
carrying one generic event (`"message"`) whose payload is a discriminated union defined in
`src/shared/types.ts` (`NetworkMessage`). This document is the authoritative protocol
reference; the implementation is `server/index.ts` (dispatch: `socket.on("message")`,
lines ~208-222) and `src/game/net/client.ts` (`handleServerMessage`).

## 1. Transport Conventions

| Aspect | Value |
|---|---|
| Transport | Socket.IO 4 (`transports: ["websocket", "polling"]` on client) |
| Endpoint | `PORT` env on server (default **3001**); client default currently **31337** (mismatch — audit HIGH-4) |
| CORS | `origin: process.env.CLIENT_ORIGIN \|\| "*"` — wide open by default |
| Envelope | Every payload has `type: string`; server switches on it; unknown → `error` message back |
| Typing | Shared TS interfaces per message; server-side casts are `as any`/`as unknown as` (no runtime validation) |
| Heartbeat | `pingTimeout: 5000`, `pingInterval: 2500` |

## 2. Message Catalog

### 2.1 Client → Server

| Type | Payload (interface) | Server handler | Validation performed | Emitted responses |
|---|---|---|---|---|
| `create_room` | `C2SCreateRoom` `{roomName, playerName, maxPlayers?}` | `handleCreateRoom` | room cap (100); "already in room" | `room_created`, `player_list`, `room_list`, `error` |
| `join_room` | `C2SJoinRoom` `{roomCode, playerName}` | `handleJoinRoom` | exists; `waiting` status; capacity | `room_joined`, `player_list`, `room_list`, `error` |
| `leave_room` | `C2SLeaveRoom` | `handleLeaveRoom` | — | `player_left`, `host_changed?`, `room_list`, optional room delete |
| `set_ready` | `C2SSetReady` `{ready}` | `handleSetReady` | in room | `player_list` |
| `set_team` | `C2SSetTeam` `{team}` | `handleSetTeam` | balance rule (`target ≤ other + 1`), waiting only | `player_list`, `error` |
| `start_match` | `C2SStartMatch` | `handleStartMatch` | **host only**; ≥2 ready, connected | `match_start` (full roster + spawns), `error` |
| `player_input` | `C2SPlayerInput` `{moveX, moveZ, yaw, pitch, fire, aim, reload, switchWeapon?, jump, timestamp}` | `handlePlayerInput` | in-progress room; alive; `|moveX|+|moveZ| ≤ 1.5`; `dist ≤ MAX_POSITION_DELTA (10)` | `player_updated` (per input), `shoot_validated`, `player_died`, `score_update`, `reloaded`, `weapon_switched`, `error` |
| `purchase` | `C2SPurchase` `{item: WeaponId \| "armor"}` | `handlePurchase` | round state `buy`; funds check | `weapon_switched` + `score_update`, `error` |
| `chat` | `C2SChat` | **none** — declared in types, unhandled server-side | — | falls to `error` ("Unknown message type") |

⚠ `maxPlayers` is accepted unclamped (a client can request 10,000). `roomName`/`playerName`
have no length/charset limits.

### 2.2 Server → Client

| Type | Payload (interface) | When |
|---|---|---|
| `connection_status` | `{connected, reconnecting}` | on connect; on disconnect with reason |
| `room_created` | `S2CRoomCreated` | creator confirmation |
| `room_joined` | `S2CRoomJoined` (includes current roster + `hostId`) | joiner confirmation |
| `player_list` | `S2CPlayerList` | any roster change |
| `player_left` | `S2CPlayerLeft` | leave/disconnect (player object retained, `disconnectedAt` set) |
| `host_changed` | `S2CHostChanged` | host departed while waiting |
| `room_closed` | `S2CRoomClosed` `{reason:"empty"}` | deferred GC (⚠ room already deleted; roster broadcast) |
| `room_list` | `S2CRoomList` | global broadcast on room create/join/leave |
| `error` | `S2CError` `{message}` | validation failures / unknown type |
| `match_start` | `S2CMatchStart` `{roundState, round, roundTimeLeft, teamScores, players[]}` | host starts |
| `round_state` | `S2CRoundState` | buy→freeze, freeze→active, team-wipe ending |
| `player_updated` | `S2CPlayerUpdated` `{position, rotation}` | every accepted `player_input` |
| `shoot_validated` | `S2CShootValidated` `{hit, targetId, headshot, damage, ammo}` | every shot (hit or miss) |
| `player_died` | `S2CPlayerDied` | kill confirmed |
| `score_update` | `S2CScoreUpdate` `{kills, deaths, credits}` | on death, respawn, purchase |
| `reloaded` | `S2CReloaded` | reload accepted |
| `weapon_switched` | `S2CWeaponSwitched` | valid switch / purchase |
| `player_respawned` | `S2CPlayerRespawned` | 3 s after death (server tick) |
| `player_spawned` | `S2CPlayerSpawned` | **defined but never emitted** (grep-verified) |
| `match_over` | `S2CMatchOver` | **defined but never emitted** — CRIT-2 |

### 2.3 Protocol Invariants To Preserve

1. `playerId === socket.id` everywhere (no session tokens). A reconnect gets a **new** id —
   old `RoomPlayer` entries linger as `disconnectedAt` ghosts; there is no re-join-to-same-player path.
2. Server is the only emitter of health/ammo/credits truth; clients must not extrapolate
   these beyond `shoot_validated`/`score_update` corrections.
3. `player_updated` is fan-out to the whole room per input — clients must tolerate lossy
   ordering (currently they do: last-write-wins interpolation).
4. Round progression state (`RoundState`) names are shared with the client-side
   `RoundManager` — keep both in sync if either changes.

## 3. Error Semantics

Errors are in-band `{type:"error", message}` — never thrown, never disconnecting. Known
messages: "Already in a room", "Server at room capacity", "Invalid room code",
"Match already in progress", "Room is full", "Team would be unbalanced",
"Only host can start match", "Need at least 2 ready players", "Invalid movement",
"Movement too fast", "Insufficient funds", "Unknown message type".

**No error codes, no i18n, no rate-limit feedback.** (Roadmap R-SEC-2 proposes codes.)

## 4. HTTP Surface (dev only)

| Route | Served by | Purpose |
|---|---|---|
| `http://localhost:3000/*` | `vite` dev server | HMR client; proxies nothing |
| `http://localhost:3000/socket.io/*` | not proxied — client connects cross-origin to `:3001` | MP only |
| `vite preview` | static `dist/` | production-shaped client; still needs the game server separately |

There is deliberately no `/api` today. If an HTTP API is ever added (profiles, leaderboards),
follow 06 §4 and keep the socket server as the only game-state authority.

## 5. Sequencing Guarantees

- `match_start` is only sent after both/any clients' `set_ready` processed — tests assert
  a 200 ms propagation wait (`multiplayer2.test.ts:156`), i.e. the protocol has **no ack**
  for ready-state; correctness depends on timing. (Flagged: R-MP-2.)
- `player_input` handling is synchronous per socket event; two rapid inputs interleave
  safely (single-threaded), but per-input `dt` uses `Date.now()` deltas — clock-based,
  vulnerable to client timestamp skew only through `lastInputTime` (server-owned, so safe).
