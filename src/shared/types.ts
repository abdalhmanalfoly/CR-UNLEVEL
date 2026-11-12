/**
 * shared/types.ts — Shared network message types between client and server.
 * These define the authoritative multiplayer protocol.
 */

export type TeamId = "attackers" | "defenders";
export type WeaponId = "pistol" | "rifle" | "smg" | "shotgun" | "sniper" | "knife";
export type RoundState =
  | "menu" | "loading" | "buy" | "freeze" | "active"
  | "bombPlanted" | "ending" | "summary" | "sideSwitch" | "matchOver";

export interface Vec3 { x: number; y: number; z: number; }

export interface PlayerState {
  id: string;
  name: string;
  team: TeamId;
  position: Vec3;
  rotation: number; // yaw
  health: number;
  armor: number;
  weapon: WeaponId;
  ammo: number;
  reserve: number;
  alive: boolean;
  ready: boolean;
}

/**
 * Client → Server messages
 */
export interface C2SCreateRoom {
  type: "create_room";
  roomName: string;
  playerName: string;
  maxPlayers?: number;
}

export interface C2SJoinRoom {
  type: "join_room";
  roomCode: string;
  playerName: string;
}

export interface C2SLeaveRoom {
  type: "leave_room";
}

export interface C2SSetReady {
  type: "set_ready";
  ready: boolean;
}

export interface C2SSetTeam {
  type: "set_team";
  team: TeamId;
}

export interface C2SStartMatch {
  type: "start_match";
}

export interface C2SPlayerInput {
  type: "player_input";
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  aim: boolean;
  reload: boolean;
  switchWeapon?: WeaponId;
  jump: boolean;
  timestamp: number;
}

export interface C2SPurchase {
  type: "purchase";
  item: WeaponId | "armor";
}

export interface C2SChat {
  type: "chat";
  message: string;
}

/**
 * Server → Client messages
 */
export interface S2CRoomCreated {
  type: "room_created";
  roomCode: string;
  roomName: string;
  playerId: string;
  playerName: string;
  team: TeamId;
}

export interface S2CRoomJoined {
  type: "room_joined";
  roomCode: string;
  roomName: string;
  playerId: string;
  playerName: string;
  team: TeamId;
  players: S2CPlayerInfo[];
  hostId: string;
}

export interface S2CError {
  type: "error";
  message: string;
}

export interface S2CPlayerList {
  type: "player_list";
  players: S2CPlayerInfo[];
}

export interface S2CPlayerJoined {
  type: "player_joined";
  player: S2CPlayerInfo;
}

export interface S2CPlayerLeft {
  type: "player_left";
  playerId: string;
}

export interface S2CPlayerUpdated {
  type: "player_updated";
  playerId: string;
  updates: Partial<S2CPlayerInfo>;
}

export interface S2CHostChanged {
  type: "host_changed";
  newHostId: string;
}

export interface S2CRoomClosed {
  type: "room_closed";
  reason: string;
}

export interface S2CRoomList {
  type: "room_list";
  rooms: S2CRoomInfo[];
}

export interface S2CMatchStart {
  type: "match_start";
  roundState: RoundState;
  round: number;
  roundTimeLeft: number;
  teamScores: { attackers: number; defenders: number };
  players: S2CPlayerInfo[];
}

export interface S2CRoundState {
  type: "round_state";
  state: RoundState;
  round: number;
  roundTimeLeft: number;
  teamScores: { attackers: number; defenders: number };
}

export interface S2CPlayerSpawned {
  type: "player_spawned";
  playerId: string;
  position: Vec3;
  team: TeamId;
  health: number;
  armor: number;
  weapon: WeaponId;
}

export interface S2CPlayerDied {
  type: "player_died";
  victimId: string;
  killerId: string | null;
  weapon: WeaponId;
  headshot: boolean;
}

export interface S2CPlayerRespawned {
  type: "player_respawned";
  playerId: string;
  position: Vec3;
  team: TeamId;
}

export interface S2CShootValidated {
  type: "shoot_validated";
  shooterId: string;
  hit: boolean;
  targetId: string | null;
  headshot: boolean;
  damage: number;
  ammo: number;
}

export interface S2CReloaded {
  type: "reloaded";
  playerId: string;
  ammo: number;
  reserve: number;
}

export interface S2CWeaponSwitched {
  type: "weapon_switched";
  playerId: string;
  weapon: WeaponId;
}

export interface S2CScoreUpdate {
  type: "score_update";
  playerId: string;
  kills: number;
  deaths: number;
  credits: number;
}

export interface S2CMatchOver {
  type: "match_over";
  winner: TeamId | null;
  teamScores: { attackers: number; defenders: number };
}

export interface S2CConnectionStatus {
  type: "connection_status";
  connected: boolean;
  reconnecting: boolean;
}

export type S2CPlayerInfo = {
  id: string;
  name: string;
  team: TeamId;
  ready: boolean;
  alive: boolean;
  health: number;
  armor: number;
  weapon: WeaponId;
  position: { x: number; y: number; z: number };
  rotation: number;
};

export type S2CRoomInfo = {
  roomCode: string;
  roomName: string;
  playerCount: number;
  maxPlayers: number;
  status: "waiting" | "starting" | "in_progress" | "finished";
  hostId: string;
};

export type NetworkMessage = C2SCreateRoom | C2SJoinRoom | C2SLeaveRoom |
  C2SSetReady | C2SSetTeam | C2SStartMatch | C2SPlayerInput |
  C2SPurchase | C2SChat |
  S2CRoomCreated | S2CRoomJoined | S2CError | S2CPlayerList |
  S2CPlayerJoined | S2CPlayerLeft | S2CPlayerUpdated | S2CHostChanged |
  S2CRoomClosed | S2CRoomList | S2CMatchStart | S2CRoundState |
  S2CPlayerSpawned | S2CPlayerDied | S2CPlayerRespawned |
  S2CShootValidated | S2CReloaded | S2CWeaponSwitched |
  S2CScoreUpdate | S2CMatchOver | S2CConnectionStatus;
