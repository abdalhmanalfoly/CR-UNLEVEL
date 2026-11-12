/**
 * src/game/net/client.ts — Socket.IO multiplayer client.
 * Connects to the server, sends player input, receives authoritative state.
 */

import { io, type Socket } from "socket.io-client";
import type {
  NetworkMessage, S2CPlayerInfo, S2CRoomInfo, TeamId, WeaponId, RoundState,
  C2SPlayerInput, C2SSetReady, C2SSetTeam, C2SStartMatch, C2SJoinRoom,
  C2SCreateRoom, C2SLeaveRoom, C2SPurchase,
} from "@/shared/types";

interface RemotePlayer {
  id: string;
  name: string;
  team: TeamId;
  position: { x: number; y: number; z: number };
  rotation: number;
  health: number;
  armor: number;
  weapon: WeaponId;
  alive: boolean;
  ready: boolean;
  mesh?: any;
  interpolatedPosition: { x: number; y: number; z: number };
  interpolatedRotation: number;
  lastUpdateTime: number;
}

export class NetworkClient {
  private socket: Socket | null = null;
  private connected = false;
  private reconnecting = false;
  private roomCode: string | null = null;
  private playerId: string | null = null;

  // Callbacks
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (message: string) => void;
  onRoomCreated?: (roomCode: string, roomName: string, playerId: string, playerName: string, team: TeamId) => void;
  onRoomJoined?: (roomCode: string, roomName: string, playerId: string, playerName: string, team: TeamId, players: S2CPlayerInfo[], hostId: string) => void;
  onPlayerList?: (players: S2CPlayerInfo[]) => void;
  onPlayerJoined?: (player: S2CPlayerInfo) => void;
  onPlayerLeft?: (playerId: string) => void;
  onPlayerUpdated?: (playerId: string, updates: Partial<S2CPlayerInfo>) => void;
  onHostChanged?: (newHostId: string) => void;
  onRoomClosed?: (reason: string) => void;
  onRoomList?: (rooms: S2CRoomInfo[]) => void;
  onMatchStart?: (roundState: RoundState, round: number, roundTimeLeft: number, teamScores: { attackers: number; defenders: number }, players: S2CPlayerInfo[]) => void;
  onRoundState?: (state: RoundState, round: number, roundTimeLeft: number, teamScores: { attackers: number; defenders: number }) => void;
  onPlayerSpawned?: (playerId: string, position: { x: number; y: number; z: number }, team: TeamId, health: number, armor: number, weapon: WeaponId) => void;
  onPlayerDied?: (victimId: string, killerId: string | null, weapon: WeaponId, headshot: boolean) => void;
  onPlayerRespawned?: (playerId: string, position: { x: number; y: number; z: number }, team: TeamId) => void;
  onShootValidated?: (shooterId: string, hit: boolean, targetId: string | null, headshot: boolean, damage: number, ammo: number) => void;
  onReloaded?: (playerId: string, ammo: number, reserve: number) => void;
  onWeaponSwitched?: (playerId: string, weapon: WeaponId) => void;
  onScoreUpdate?: (playerId: string, kills: number, deaths: number, credits: number) => void;
  onMatchOver?: (winner: TeamId | null, teamScores: { attackers: number; defenders: number }) => void;
  onConnectionStatus?: (connected: boolean, reconnecting: boolean) => void;

  private messageHandler = (msg: any) => this.handleServerMessage(msg);

  connect(serverUrl: string): void {
    console.log("[NET] connect() called", serverUrl);
    if (this.socket) this.disconnect();
    this.socket = io(serverUrl, { transports: ["websocket", "polling"] });
    console.log("[NET] io() created", this.socket ? "yes" : "no");
    this.socket.on("connect", () => {
      console.log("[NET] socket connect");
      this.connected = true;
      this.reconnecting = false;
      this.onConnectionStatus?.(true, false);
      this.onConnect?.();
    });
    this.socket.on("disconnect", (reason: string) => {
      console.log("[NET] socket disconnect", reason);
      this.connected = false;
      if (reason === "io client disconnect") return;
      this.reconnecting = true;
      this.onConnectionStatus?.(false, true);
      this.onDisconnect?.();
    });
    this.socket.on("connect_error", (err: Error) => {
      console.log("[NET] socket connect_error", err.message);
      this.connected = false;
      this.onError?.(err.message);
      this.onConnectionStatus?.(false, false);
    });
    this.socket.on("message", this.messageHandler);
  }

  private handleServerMessage(msg: any): void {
    switch (msg.type) {
      case "room_created":
        this.onRoomCreated?.(msg.roomCode, msg.roomName, msg.playerId, msg.playerName, msg.team);
        break;
      case "room_joined":
        this.playerId = msg.playerId;
        this.roomCode = msg.roomCode;
        this.onRoomJoined?.(msg.roomCode, msg.roomName, msg.playerId, msg.playerName, msg.team, msg.players, msg.hostId);
        break;
      case "error":
        this.onError?.(msg.message);
        break;
      case "player_list":
        this.onPlayerList?.(msg.players);
        break;
      case "player_joined":
        this.onPlayerJoined?.(msg.player);
        break;
      case "player_left":
        this.onPlayerLeft?.(msg.playerId);
        break;
      case "player_updated":
        this.onPlayerUpdated?.(msg.playerId, msg.updates);
        break;
      case "host_changed":
        this.onHostChanged?.(msg.newHostId);
        break;
      case "room_closed":
        this.onRoomClosed?.(msg.reason);
        break;
      case "room_list":
        this.onRoomList?.(msg.rooms);
        break;
      case "match_start":
        this.onMatchStart?.(msg.roundState, msg.round, msg.roundTimeLeft, msg.teamScores, msg.players);
        break;
      case "round_state":
        this.onRoundState?.(msg.state, msg.round, msg.roundTimeLeft, msg.teamScores);
        break;
      case "player_spawned":
        this.onPlayerSpawned?.(msg.playerId, msg.position, msg.team, msg.health, msg.armor, msg.weapon);
        break;
      case "player_died":
        this.onPlayerDied?.(msg.victimId, msg.killerId, msg.weapon, msg.headshot);
        break;
      case "player_respawned":
        this.onPlayerRespawned?.(msg.playerId, msg.position, msg.team);
        break;
      case "shoot_validated":
        this.onShootValidated?.(msg.shooterId, msg.hit, msg.targetId, msg.headshot, msg.damage, msg.ammo);
        break;
      case "reloaded":
        this.onReloaded?.(msg.playerId, msg.ammo, msg.reserve);
        break;
      case "weapon_switched":
        this.onWeaponSwitched?.(msg.playerId, msg.weapon);
        break;
      case "score_update":
        this.onScoreUpdate?.(msg.playerId, msg.kills, msg.deaths, msg.credits);
        break;
      case "match_over":
        this.onMatchOver?.(msg.winner, msg.teamScores);
        break;
      case "connection_status":
        this.onConnectionStatus?.(msg.connected, msg.reconnecting);
        break;
    }
  }

  send<T extends { type: string }>(message: T): void {
    if (!this.socket || !this.connected) return;
    this.socket.emit("message", message);
  }

  createRoom(roomName: string, playerName: string, maxPlayers?: number): void {
    this.send({ type: "create_room", roomName, playerName, maxPlayers } as any);
  }

  joinRoom(roomCode: string, playerName: string): void {
    this.send({ type: "join_room", roomCode, playerName } as C2SJoinRoom);
  }

  leaveRoom(): void {
    this.send({ type: "leave_room" } as C2SLeaveRoom);
  }

  setReady(ready: boolean): void {
    this.send({ type: "set_ready", ready } as C2SSetReady);
  }

  setTeam(team: TeamId): void {
    this.send({ type: "set_team", team } as C2SSetTeam);
  }

  startMatch(): void {
    this.send({ type: "start_match" } as C2SStartMatch);
  }

  sendPlayerInput(input: Omit<C2SPlayerInput, "type"> & { timestamp?: number }): void {
    this.send({
      type: "player_input",
      ...input,
      timestamp: input.timestamp ?? Date.now(),
    } as C2SPlayerInput);
  }

  purchase(item: WeaponId | "armor"): void {
    this.send({ type: "purchase", item } as C2SPurchase);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeListener("message", this.messageHandler);
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.reconnecting = false;
    this.roomCode = null;
    this.playerId = null;
  }

  get isConnected(): boolean { return this.connected; }
  get isInRoom(): boolean { return !!this.roomCode; }
  get myPlayerId(): string | null { return this.playerId; }
}

export const networkClient = new NetworkClient();

// Test/dev hook: allow browser automation to drive the multiplayer client.
if (typeof window !== "undefined") {
  (window as any).__networkClient = networkClient;
}
