/**
 * server/index.ts — Socket.IO multiplayer server for SANDLINE.
 * Authoritative room/team/match/combat system.
 */

import { createServer } from "node:http";
import { Server as IOServer, Socket } from "socket.io";
import type {
  TeamId, WeaponId, RoundState,
  C2SCreateRoom, C2SJoinRoom, C2SLeaveRoom, C2SSetReady, C2SSetTeam,
  C2SStartMatch, C2SPlayerInput, C2SPurchase,
  S2CRoomCreated, S2CRoomJoined, S2CError, S2CPlayerList, S2CPlayerJoined,
  S2CPlayerLeft, S2CPlayerUpdated, S2CHostChanged, S2CRoomClosed,
  S2CRoomList, S2CMatchStart, S2CRoundState, S2CPlayerSpawned,
  S2CPlayerDied, S2CPlayerRespawned, S2CShootValidated, S2CReloaded,
  S2CWeaponSwitched, S2CScoreUpdate, S2CMatchOver, S2CConnectionStatus,
  S2CPlayerInfo, S2CRoomInfo,
} from "../src/shared/types";
import { calculateDamage } from "../src/game/systems/damage";
import { WEAPONS, EQUIPMENT, ATTACKER_SPAWNS, DEFENDER_SPAWNS } from "../src/game/config";

const PORT = Number(process.env.PORT || 3001);
const MAX_ROOMS = 100;
const ROOM_CODE_LENGTH = 6;
const TICK_RATE = 30;
const SERVER_MOVE_SPEED = 5.4;
const MAX_POSITION_DELTA = 10;
const RESPAWN_DELAY = 3000;

const httpServer = createServer();
const io = new IOServer(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 5000,
  pingInterval: 2500,
});

interface RoomPlayer {
  id: string;
  name: string;
  team: TeamId;
  ready: boolean;
  alive: boolean;
  health: number;
  armor: number;
  position: { x: number; y: number; z: number };
  rotation: number;
  weapon: WeaponId;
  ammo: number;
  reserve: number;
  credits: number;
  kills: number;
  deaths: number;
  lastInputTime: number;
  lastPosition: { x: number; y: number; z: number };
  disconnectedAt: number | null;
  deathTime: number | null;
  _lastShotTime?: number;
}

interface Room {
  roomCode: string;
  roomName: string;
  hostId: string;
  players: Map<string, RoomPlayer>;
  maxPlayers: number;
  status: "waiting" | "starting" | "in_progress" | "finished";
  createdAt: number;
  lastActivity: number;
  roundState: RoundState;
  round: number;
  roundTimer: number;
  teamScores: { attackers: number; defenders: number };
  roundEnded: boolean;
  respawnIndex: number;
}

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>();
const socketToPlayerId = new Map<string, string>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function createPlayerInfo(p: RoomPlayer): S2CPlayerInfo {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    ready: p.ready,
    alive: p.alive,
    health: p.health,
    armor: p.armor,
    weapon: p.weapon,
    position: p.position,
    rotation: p.rotation,
  };
}

function createRoomInfo(r: Room): S2CRoomInfo {
  return {
    roomCode: r.roomCode,
    roomName: r.roomName,
    playerCount: r.players.size,
    maxPlayers: r.maxPlayers,
    status: r.status,
    hostId: r.hostId,
  };
}

function getTeamCounts(r: Room): { attackers: number; defenders: number } {
  let attackers = 0, defenders = 0;
  for (const p of r.players.values()) {
    if (p.team === "attackers") attackers++;
    else defenders++;
  }
  return { attackers, defenders };
}

function oppositeTeam(t: TeamId): TeamId {
  return t === "attackers" ? "defenders" : "attackers";
}

function assignTeam(r: Room, preferTeam?: TeamId): TeamId {
  const counts = getTeamCounts(r);
  if (preferTeam && counts[preferTeam] <= counts[oppositeTeam(preferTeam)]) {
    return preferTeam;
  }
  return counts.attackers <= counts.defenders ? "attackers" : "defenders";
}

function broadcastToRoom(roomCode: string, message: object): void {
  io.to(roomCode).emit("message", message);
}

function sendToSocket(socketId: string, message: object): void {
  io.to(socketId).emit("message", message);
}

function broadcastRoomList(): void {
  const roomsList = Array.from(rooms.values()).map(createRoomInfo);
  io.emit("message", { type: "room_list", rooms: roomsList } as any);
}

function updateRoomPlayers(room: Room): void {
  const players = Array.from(room.players.values()).map(createPlayerInfo);
  broadcastToRoom(room.roomCode, { type: "player_list", players } as any);
}

function startMatch(room: Room): void {
  if (room.status !== "waiting") return;
  room.status = "in_progress";
  room.roundState = "buy";
  room.round = 1;
  room.roundTimer = 20;
  room.teamScores = { attackers: 0, defenders: 0 };
  room.roundEnded = false;

  const attackerSpawns = [[-17, -13], [-10, -13], [-2, -14]];
  const defenderSpawns = [[16, -12], [18, 0], [-17, -1]];
  let aIdx = 0, dIdx = 0;
  for (const p of room.players.values()) {
    const spawns = p.team === "attackers" ? attackerSpawns : defenderSpawns;
    const idx = p.team === "attackers" ? aIdx++ : dIdx++;
    const pos = spawns[idx % spawns.length];
    p.position = { x: pos[0], y: 1.68, z: pos[1] };
    p.lastPosition = { ...p.position };
    p.health = 100;
    p.armor = 0;
    p.alive = true;
    p.weapon = "pistol";
    p.ammo = WEAPONS.pistol.magazine;
    p.reserve = WEAPONS.pistol.reserve;
    p.ready = false;
    p.credits = 800;
    p.kills = 0;
    p.deaths = 0;
    delete (p as any)._lastShotTime;
    p.deathTime = null;
  }

  broadcastToRoom(room.roomCode, {
    type: "match_start",
    roundState: room.roundState,
    round: room.round,
    roundTimeLeft: room.roundTimer,
    teamScores: room.teamScores,
    players: Array.from(room.players.values()).map(createPlayerInfo),
  } as any);
}

// ===== Socket handlers =====

io.on("connection", (socket: Socket) => {
  console.log(`[server] client connected: ${socket.id}`);

  socket.emit("message", { type: "connection_status", connected: true, reconnecting: false } as any);

  socket.on("message", (msg: unknown) => {
    const message = msg as { type?: string; [key: string]: unknown };
    switch (message.type) {
      case "create_room": handleCreateRoom(socket, message as unknown as C2SCreateRoom); break;
      case "join_room": handleJoinRoom(socket, message as unknown as C2SJoinRoom); break;
      case "leave_room": handleLeaveRoom(socket); break;
      case "set_ready": handleSetReady(socket, message as unknown as C2SSetReady); break;
      case "set_team": handleSetTeam(socket, message as unknown as C2SSetTeam); break;
      case "start_match": handleStartMatch(socket); break;
      case "player_input": handlePlayerInput(socket, message as unknown as C2SPlayerInput); break;
      case "purchase": handlePurchase(socket, message as unknown as C2SPurchase); break;
      default:
        sendToSocket(socket.id, { type: "error", message: "Unknown message type" } as any);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socketToRoom.get(socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const playerId = socketToPlayerId.get(socket.id);
        if (playerId) {
          const p = room.players.get(playerId);
          if (p) {
            p.disconnectedAt = Date.now();
            p.alive = false;
          }
          socketToPlayerId.delete(socket.id);
        }
        broadcastToRoom(room.roomCode, { type: "player_left", playerId } as any);

        if (room.hostId === playerId && room.status === "waiting") {
          const remaining = Array.from(room.players.values()).find(p => p.id !== playerId && !p.disconnectedAt);
          if (remaining) {
            room.hostId = remaining.id;
            broadcastToRoom(room.roomCode, { type: "host_changed", newHostId: remaining.id } as any);
          }
        }

        const activePlayers = Array.from(room.players.values()).filter(p => !p.disconnectedAt);
        if (activePlayers.length === 0 && room.status !== "in_progress") {
          setTimeout(() => {
            const r = rooms.get(roomCode);
            if (r && Array.from(r.players.values()).every(p => p.disconnectedAt)) {
              rooms.delete(roomCode);
              broadcastToRoom(roomCode, { type: "room_closed", reason: "empty" } as any);
            }
          }, 10000);
        }
      }
      socketToRoom.delete(socket.id);
    }
    console.log(`[server] client disconnected: ${socket.id}`);
  });
});

// ===== Room handlers =====

function handleCreateRoom(socket: Socket, data: C2SCreateRoom): void {
  const existingRoom = socketToRoom.get(socket.id);
  if (existingRoom) {
    sendToSocket(socket.id, { type: "error", message: "Already in a room" } as any);
    return;
  }

  if (rooms.size >= MAX_ROOMS) {
    sendToSocket(socket.id, { type: "error", message: "Server at room capacity" } as any);
    return;
  }

  let roomCode: string;
  do { roomCode = generateRoomCode(); } while (rooms.has(roomCode));

  const playerId = socket.id;
  const room: Room = {
    roomCode,
    roomName: data.roomName || "Unnamed Room",
    hostId: playerId,
    players: new Map(),
    maxPlayers: data.maxPlayers ?? 10,
    status: "waiting",
    createdAt: Date.now(),
    lastActivity: Date.now(),
    roundState: "menu",
    round: 1,
    roundTimer: 0,
    teamScores: { attackers: 0, defenders: 0 },
    roundEnded: false,
    respawnIndex: 0,
  };

  const team = assignTeam(room);
  const player: RoomPlayer = {
    id: playerId,
    name: data.playerName || "Player",
    team,
    ready: false,
    alive: true,
    health: 100,
    armor: 0,
    position: { x: 0, y: 1.68, z: 0 },
    rotation: 0,
    weapon: "pistol",
    ammo: WEAPONS.pistol.magazine,
    reserve: WEAPONS.pistol.reserve,
    credits: 800,
    kills: 0,
    deaths: 0,
    lastInputTime: Date.now(),
    lastPosition: { x: 0, y: 1.68, z: 0 },
    disconnectedAt: null,
    deathTime: null,
  };
  room.players.set(playerId, player);

  rooms.set(roomCode, room);
  socketToRoom.set(socket.id, roomCode);
  socketToPlayerId.set(socket.id, playerId);
  socket.join(roomCode);

  sendToSocket(socket.id, {
    type: "room_created",
    roomCode,
    roomName: room.roomName,
    playerId,
    playerName: player.name,
    team,
  } as any);

  updateRoomPlayers(room);
  broadcastRoomList();
}

function handleJoinRoom(socket: Socket, data: C2SJoinRoom): void {
  const existingRoom = socketToRoom.get(socket.id);
  if (existingRoom) {
    sendToSocket(socket.id, { type: "error", message: "Already in a room" } as any);
    return;
  }

  const room = rooms.get(data.roomCode);
  if (!room) {
    sendToSocket(socket.id, { type: "error", message: "Invalid room code" } as any);
    return;
  }

  if (room.status !== "waiting") {
    sendToSocket(socket.id, { type: "error", message: "Match already in progress" } as any);
    return;
  }

  if (room.players.size >= room.maxPlayers) {
    sendToSocket(socket.id, { type: "error", message: "Room is full" } as any);
    return;
  }

  const playerId = socket.id;
  const team = assignTeam(room);
  const player: RoomPlayer = {
    id: playerId,
    name: data.playerName || "Player",
    team,
    ready: false,
    alive: true,
    health: 100,
    armor: 0,
    position: { x: 0, y: 1.68, z: 0 },
    rotation: 0,
    weapon: "pistol",
    ammo: WEAPONS.pistol.magazine,
    reserve: WEAPONS.pistol.reserve,
    credits: 800,
    kills: 0,
    deaths: 0,
    lastInputTime: Date.now(),
    lastPosition: { x: 0, y: 1.68, z: 0 },
    disconnectedAt: null,
    deathTime: null,
  };
  room.players.set(playerId, player);

  socketToRoom.set(socket.id, data.roomCode);
  socketToPlayerId.set(socket.id, playerId);
  socket.join(data.roomCode);

  sendToSocket(socket.id, {
    type: "room_joined",
    roomCode: data.roomCode,
    roomName: room.roomName,
    playerId,
    playerName: player.name,
    team,
    players: Array.from(room.players.values()).map(createPlayerInfo),
    hostId: room.hostId,
  } as any);

  updateRoomPlayers(room);
  broadcastRoomList();
}

function handleLeaveRoom(socket: Socket): void {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const playerId = socketToPlayerId.get(socket.id);

  if (room && playerId) {
    room.players.delete(playerId);
    broadcastToRoom(roomCode, { type: "player_left", playerId } as any);

    if (room.hostId === playerId && room.status === "waiting") {
      const remaining = Array.from(room.players.values())[0];
      if (remaining) {
        room.hostId = remaining.id;
        broadcastToRoom(roomCode, { type: "host_changed", newHostId: remaining.id } as any);
      }
    }

    if (room.players.size === 0 && room.status !== "in_progress") {
      rooms.delete(roomCode);
    } else {
      updateRoomPlayers(room);
    }
  }

  socketToRoom.delete(socket.id);
  socketToPlayerId.delete(socket.id);
  socket.leave(roomCode);
  broadcastRoomList();
}

function handleSetReady(socket: Socket, data: C2SSetReady): void {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const playerId = socketToPlayerId.get(socket.id);
  if (!room || !playerId) return;

  const p = room.players.get(playerId);
  if (!p) return;
  p.ready = data.ready;
  room.lastActivity = Date.now();
  updateRoomPlayers(room);
}

function handleSetTeam(socket: Socket, data: C2SSetTeam): void {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const playerId = socketToPlayerId.get(socket.id);
  if (!room || !playerId) return;
  if (room.status !== "waiting") return;

  const p = room.players.get(playerId);
  if (!p) return;

  const counts = getTeamCounts(room);
  const targetCount = p.team === data.team ? counts[data.team] - 1 : counts[data.team];
  const otherCount = p.team === data.team ? counts[oppositeTeam(p.team)] : counts[oppositeTeam(data.team)];

  if (targetCount > otherCount + 1) {
    sendToSocket(socket.id, { type: "error", message: "Team would be unbalanced" } as any);
    return;
  }

  p.team = data.team;
  room.lastActivity = Date.now();
  updateRoomPlayers(room);
}

function handleStartMatch(socket: Socket): void {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const playerId = socketToPlayerId.get(socket.id);
  if (!room || !playerId) return;
  if (room.hostId !== playerId) {
    sendToSocket(socket.id, { type: "error", message: "Only host can start match" } as any);
    return;
  }
  const readyPlayers = Array.from(room.players.values()).filter(p => p.ready && !p.disconnectedAt);
  if (readyPlayers.length < 2) {
    sendToSocket(socket.id, { type: "error", message: "Need at least 2 ready players" } as any);
    return;
  }
  startMatch(room);
}

// ===== Gameplay handlers =====

function handlePlayerInput(socket: Socket, data: C2SPlayerInput): void {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const playerId = socketToPlayerId.get(socket.id);
  if (!room || !playerId || room.status !== "in_progress") return;

  const p = room.players.get(playerId);
  if (!p || !p.alive) return;

  const now = Date.now();
  const dt = (now - p.lastInputTime) / 1000;
  p.lastInputTime = now;

  const speed = Math.abs(data.moveX) + Math.abs(data.moveZ);
  if (speed > 1.5) {
    sendToSocket(socket.id, { type: "error", message: "Invalid movement" } as any);
    return;
  }

  const moveDist = SERVER_MOVE_SPEED * dt * speed;
  if (moveDist > MAX_POSITION_DELTA) {
    sendToSocket(socket.id, { type: "error", message: "Movement too fast" } as any);
    return;
  }

  const angle = data.yaw;
  const dx = Math.sin(angle) * data.moveX * moveDist;
  const dz = Math.cos(angle) * data.moveZ * moveDist;
  p.position.x += dx;
  p.position.z += dz;
  p.rotation = data.yaw;
  p.lastPosition = { ...p.position };

  broadcastToRoom(room.roomCode, {
    type: "player_updated",
    playerId,
    updates: { position: { ...p.position }, rotation: p.rotation },
  } as any);

  if (data.fire) {
    handlePlayerFire(room, p, data.yaw, data.pitch);
  }

  if (data.reload) {
    handlePlayerReload(room, p);
  }

  if (data.switchWeapon && data.switchWeapon !== p.weapon) {
    const spec = WEAPONS[data.switchWeapon];
    if (spec) {
      p.weapon = data.switchWeapon;
      p.ammo = spec.magazine;
      p.reserve = spec.reserve;
      broadcastToRoom(room.roomCode, {
        type: "weapon_switched",
        playerId,
        weapon: data.switchWeapon,
      } as any);
    }
  }
}

function handlePlayerFire(room: Room, shooter: RoomPlayer, yaw: number, pitch: number): void {
  const spec = WEAPONS[shooter.weapon];
  const now = Date.now();
  const lastShot = (shooter as any)._lastShotTime || 0;
  if (now - lastShot < spec.interval * 1000) return;
  (shooter as any)._lastShotTime = now;

  if (shooter.ammo <= 0) return;
  shooter.ammo--;

  const origin = { x: shooter.position.x, y: shooter.position.y + 1.62, z: shooter.position.z };
  const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const ndir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };

  let hitTarget: RoomPlayer | null = null;
  let hitDistance = spec.range;
  let headshot = false;

  for (const other of room.players.values()) {
    if (other.id === shooter.id || !other.alive || other.team === shooter.team) continue;
    const dist = Math.hypot(other.position.x - origin.x, other.position.y - origin.y, other.position.z - origin.z);
    if (dist > spec.range) continue;
    const toTarget = { x: other.position.x - origin.x, y: other.position.y + 0.8 - origin.y, z: other.position.z - origin.z };
    const tLen = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    const dot = (toTarget.x * ndir.x + toTarget.y * ndir.y + toTarget.z * ndir.z) / tLen;
    if (dot > 0.95 && tLen < hitDistance) {
      hitDistance = tLen;
      hitTarget = other;
      headshot = toTarget.y > 0;
    }
  }

  if (hitTarget) {
    const dmg = headshot ? spec.headDamage : spec.damage;
    const result = calculateDamage(dmg, headshot ? "head" : "torso", hitTarget.armor, false);
    hitTarget.armor = result.remainingArmor;
    hitTarget.health = result.remainingHealth;

    if (result.killed) {
      hitTarget.alive = false;
      hitTarget.deathTime = Date.now();
      shooter.kills++;
      hitTarget.deaths++;
      broadcastToRoom(room.roomCode, {
        type: "player_died",
        victimId: hitTarget.id,
        killerId: shooter.id,
        weapon: shooter.weapon,
        headshot,
      } as any);
      broadcastToRoom(room.roomCode, {
        type: "score_update",
        playerId: shooter.id,
        kills: shooter.kills,
        deaths: shooter.deaths,
        credits: shooter.credits,
      } as any);

      const aliveAttackers = Array.from(room.players.values()).filter(p => p.team === "attackers" && p.alive).length;
      const aliveDefenders = Array.from(room.players.values()).filter(p => p.team === "defenders" && p.alive).length;
      if (!room.roundEnded && (aliveAttackers === 0 || aliveDefenders === 0)) {
        room.roundEnded = true;
        const winner = aliveAttackers === 0 ? "defenders" : "attackers";
        room.teamScores[winner]++;
        room.roundState = "ending";
        broadcastToRoom(room.roomCode, {
          type: "round_state",
          state: room.roundState,
          round: room.round,
          roundTimeLeft: room.roundTimer,
          teamScores: room.teamScores,
        } as any);
      }
    }

    broadcastToRoom(room.roomCode, {
      type: "shoot_validated",
      shooterId: shooter.id,
      hit: true,
      targetId: hitTarget.id,
      headshot,
      damage: result.damage,
      ammo: shooter.ammo,
    } as any);
  } else {
    broadcastToRoom(room.roomCode, {
      type: "shoot_validated",
      shooterId: shooter.id,
      hit: false,
      targetId: null,
      headshot: false,
      damage: 0,
      ammo: shooter.ammo,
    } as any);
  }
}

function handlePlayerReload(room: Room, player: RoomPlayer): void {
  const spec = WEAPONS[player.weapon];
  if (player.ammo >= spec.magazine || player.reserve <= 0) return;
  const needed = spec.magazine - player.ammo;
  const moved = Math.min(needed, player.reserve);
  player.ammo += moved;
  player.reserve -= moved;

  broadcastToRoom(room.roomCode, {
    type: "reloaded",
    playerId: player.id,
    ammo: player.ammo,
    reserve: player.reserve,
  } as any);
}

function handlePurchase(socket: Socket, data: C2SPurchase): void {
  const roomCode = socketToRoom.get(socket.id);
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  const playerId = socketToPlayerId.get(socket.id);
  if (!room || !playerId || room.roundState !== "buy") return;

  const p = room.players.get(playerId);
  if (!p) return;

  if (data.item === "armor") {
    const cost = EQUIPMENT.armor.cost;
    if (p.credits < cost) {
      sendToSocket(socket.id, { type: "error", message: "Insufficient funds" } as any);
      return;
    }
    p.credits -= cost;
    p.armor = 50;
    broadcastToRoom(room.roomCode, {
      type: "score_update",
      playerId: p.id,
      kills: p.kills,
      deaths: p.deaths,
      credits: p.credits,
    } as any);
  } else {
    const spec = WEAPONS[data.item];
    if (!spec || spec.cost === 0) return;
    if (p.credits < spec.cost) {
      sendToSocket(socket.id, { type: "error", message: "Insufficient funds" } as any);
      return;
    }
    p.credits -= spec.cost;
    p.weapon = data.item;
    p.ammo = spec.magazine;
    p.reserve = spec.reserve;
    broadcastToRoom(room.roomCode, {
      type: "weapon_switched",
      playerId: p.id,
      weapon: data.item,
    } as any);
    broadcastToRoom(room.roomCode, {
      type: "score_update",
      playerId: p.id,
      kills: p.kills,
      deaths: p.deaths,
      credits: p.credits,
    } as any);
  }
}

// ===== Server tick loop =====

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status !== "in_progress") continue;
    room.roundTimer -= 1 / TICK_RATE;
    if (room.roundTimer <= 0 && room.roundState === "buy") {
      room.roundState = "freeze";
      room.roundTimer = 3;
      broadcastToRoom(room.roomCode, {
        type: "round_state",
        state: room.roundState,
        round: room.round,
        roundTimeLeft: room.roundTimer,
        teamScores: room.teamScores,
      } as any);
    } else if (room.roundTimer <= 0 && room.roundState === "freeze") {
      room.roundState = "active";
      room.roundTimer = 75;
      broadcastToRoom(room.roomCode, {
        type: "round_state",
        state: room.roundState,
        round: room.round,
        roundTimeLeft: room.roundTimer,
        teamScores: room.teamScores,
      } as any);
    }

    // Server-authoritative respawn: dead players return to a team spawn after
    // RESPAWN_DELAY, no more than once per death.
    const now = Date.now();
    for (const p of room.players.values()) {
      if (p.alive || !p.deathTime) continue;
      if (now - p.deathTime < RESPAWN_DELAY) continue;
      const spawns = p.team === "attackers" ? ATTACKER_SPAWNS : DEFENDER_SPAWNS;
      const pos = spawns[room.respawnIndex % spawns.length];
      room.respawnIndex++;
      p.position = { x: pos[0], y: 1.68, z: pos[1] };
      p.lastPosition = { ...p.position };
      p.rotation = 0;
      p.health = 100;
      p.armor = 0;
      p.alive = true;
      p.weapon = "pistol";
      p.ammo = WEAPONS.pistol.magazine;
      p.reserve = WEAPONS.pistol.reserve;
      p.deathTime = null;

      broadcastToRoom(room.roomCode, {
        type: "player_respawned",
        playerId: p.id,
        position: p.position,
        team: p.team,
      } as any);
      broadcastToRoom(room.roomCode, {
        type: "score_update",
        playerId: p.id,
        kills: p.kills,
        deaths: p.deaths,
        credits: p.credits,
      } as any);
    }
  }
}, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`[server] SANDLINE multiplayer server listening on port ${PORT}`);
});

export { httpServer, io };
