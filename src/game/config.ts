export const INPUT_CONFIG = {
  MOUSE_SENS_X: 0.0022,
  MOUSE_SENS_Y: 0.0020,
  INVERT_X: false,
  INVERT_Y: false,
} as const;

export const QUALITY = {
  PARTICLES_HIGH: 240,
  PARTICLES_LOW: 90,
  DEGRADE_FPS: 42,
} as const;

export const COLORS = {
  background: 0x9db4b2,
  sand: 0xc5a46d,
  wall: 0xa77d4f,
  dark: 0x16282a,
  teal: 0x36e1cb,
  orange: 0xff7b45,
} as const;

export const GAME = {
  MAX_ROUNDS: 3,
  ROUND_SECONDS: 75,
  BUY_SECONDS: 20,
  FREEZE_SECONDS: 3,
  PLAYER_HEIGHT: 1.68,
  PLAYER_RADIUS: 0.38,
  PLAYER_EYE_HEIGHT: 1.62,
  WALK_SPEED: 5.4,
  SPRINT_SPEED: 7.2,
  CROUCH_SPEED: 3.0,
  JUMP_SPEED: 6.5,
  GRAVITY: 26.0,
  MAP_X: 22,
  MAP_Z: 17,
  START_CREDITS: 800,
  KILL_REWARD: 150,
  WIN_REWARD: 1400,
  LOSS_REWARD: 900,
  BOMB_TIMER: 40,
  PLANT_SECONDS: 3,
  DEFUSE_SECONDS: 5,
  DEFUSE_KIT_SECONDS: 3,
} as const;

export type TeamId = "attackers" | "defenders";

export const TEAMS: Record<TeamId, { name: string; color: number; short: string }> = {
  attackers: { name: "Sandline Vanguard", color: 0x173f3d, short: "VANG" },
  defenders: { name: "Desert Lock", color: 0x5c4a3a, short: "LOCK" },
} as const;

export type WeaponId = "pistol" | "rifle" | "smg" | "shotgun" | "sniper" | "knife";
export type EquipmentId = "grenade" | "smoke" | "flashbang" | "defuseKit" | "armor" | "helmet";

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  category: "pistol" | "smg" | "rifle" | "shotgun" | "sniper" | "melee";
  damage: number;
  headDamage: number;
  interval: number;
  magazine: number;
  reserve: number;
  reload: number;
  spread: number;
  moveSpread: number;
  recoil: number;
  automatic: boolean;
  cost: number;
  fov: number;
  range: number;
  armorPen: number;
  team?: TeamId;
  icon: string;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: {
    id: "pistol", name: "SP-9", category: "pistol",
    damage: 36, headDamage: 110, interval: 0.15,
    magazine: 12, reserve: 36, reload: 1.4, spread: 0.006, moveSpread: 0.012,
    recoil: 0.012, automatic: false, cost: 300, fov: 60, range: 55, armorPen: 0.85, team: undefined, icon: "pistol",
  },
  rifle: {
    id: "rifle", name: "AR-4", category: "rifle",
    damage: 34, headDamage: 100, interval: 0.105,
    magazine: 30, reserve: 90, reload: 1.65, spread: 0.0045, moveSpread: 0.014,
    recoil: 0.010, automatic: true, cost: 1500, fov: 54, range: 75, armorPen: 0.95, team: undefined, icon: "rifle",
  },
  smg: {
    id: "smg", name: "MPX-7", category: "smg",
    damage: 26, headDamage: 78, interval: 0.085,
    magazine: 30, reserve: 90, reload: 1.5, spread: 0.007, moveSpread: 0.016,
    recoil: 0.009, automatic: true, cost: 1000, fov: 58, range: 45, armorPen: 0.80, team: undefined, icon: "smg",
  },
  shotgun: {
    id: "shotgun", name: "M12", category: "shotgun",
    damage: 18, headDamage: 50, interval: 0.4,
    magazine: 8, reserve: 32, reload: 2.2, spread: 0.045, moveSpread: 0.025,
    recoil: 0.025, automatic: false, cost: 700, fov: 62, range: 22, armorPen: 0.60, team: undefined, icon: "shotgun",
  },
  sniper: {
    id: "sniper", name: "LR-8", category: "sniper",
    damage: 110, headDamage: 180, interval: 1.05,
    magazine: 5, reserve: 15, reload: 2.35, spread: 0.001, moveSpread: 0.035,
    recoil: 0.040, automatic: false, cost: 2400, fov: 28, range: 110, armorPen: 1.15, team: undefined, icon: "sniper",
  },
  knife: {
    id: "knife", name: "Combat Knife", category: "melee",
    damage: 55, headDamage: 100, interval: 0.4,
    magazine: 1, reserve: 0, reload: 0, spread: 0, moveSpread: 0,
    recoil: 0, automatic: false, cost: 0, fov: 60, range: 1.8, armorPen: 1.0, team: undefined, icon: "knife",
  },
};

export interface EquipmentSpec {
  id: EquipmentId;
  name: string;
  cost: number;
  maxPerRound: number;
  icon: string;
}

export const EQUIPMENT: Record<EquipmentId, EquipmentSpec> = {
  grenade: { id: "grenade", name: "Frag Grenade", cost: 400, maxPerRound: 1, icon: "grenade" },
  smoke: { id: "smoke", name: "Smoke Grenade", cost: 300, maxPerRound: 1, icon: "smoke" },
  flashbang: { id: "flashbang", name: "Flashbang", cost: 250, maxPerRound: 1, icon: "flashbang" },
  defuseKit: { id: "defuseKit", name: "Defuse Kit", cost: 400, maxPerRound: 1, icon: "defuse" },
  armor: { id: "armor", name: "Tactical Armor", cost: 650, maxPerRound: 1, icon: "armor" },
  helmet: { id: "helmet", name: "Helmet", cost: 350, maxPerRound: 1, icon: "helmet" },
};

export interface MapBlock {
  x: number; z: number; w: number; d: number; h: number;
  kind: "wall" | "crate" | "barrier";
}

export const MAP_BLOCKS: readonly MapBlock[] = [
  { x: -22.6, z: 0, w: 1.2, d: 36, h: 3.6, kind: "wall" },
  { x: 22.6, z: 0, w: 1.2, d: 36, h: 3.6, kind: "wall" },
  { x: 0, z: -17.6, w: 46, d: 1.2, h: 3.6, kind: "wall" },
  { x: 0, z: 17.6, w: 46, d: 1.2, h: 3.6, kind: "wall" },
  { x: -8, z: -4, w: 1.2, d: 12, h: 2.8, kind: "wall" },
  { x: 7, z: 2, w: 1.2, d: 13, h: 2.8, kind: "wall" },
  { x: -15, z: 4, w: 7, d: 1.0, h: 2.4, kind: "wall" },
  { x: 14, z: -6, w: 8, d: 1.0, h: 2.4, kind: "wall" },
  { x: 0, z: -9, w: 7, d: 0.8, h: 1.25, kind: "barrier" },
  { x: -1, z: 8, w: 6, d: 0.8, h: 1.15, kind: "barrier" },
  { x: -15, z: -8, w: 2.2, d: 2.2, h: 2.0, kind: "crate" },
  { x: -12.5, z: -8, w: 2.2, d: 2.2, h: 1.25, kind: "crate" },
  { x: 14, z: 8, w: 2.4, d: 2.4, h: 2.0, kind: "crate" },
  { x: 11.4, z: 8, w: 2.4, d: 2.4, h: 1.25, kind: "crate" },
  { x: 1, z: -2, w: 2.3, d: 2.3, h: 1.4, kind: "crate" },
  { x: -2, z: 1, w: 1.8, d: 1.8, h: 1.1, kind: "crate" },
  { x: 15, z: -13, w: 2.1, d: 2.1, h: 1.35, kind: "crate" },
  { x: -16, z: 12, w: 2.0, d: 2.0, h: 1.25, kind: "crate" },
] as const;

export const ATTACKER_SPAWNS = [
  [-17, -13], [-10, -13], [-2, -14],
] as const;

export const DEFENDER_SPAWNS = [
  [16, -12], [18, 0], [-17, -1],
] as const;

export const ENEMY_SPAWNS = [
  [-17, -13], [-10, -13], [-2, -14], [6, -13], [16, -12], [18, 0], [-17, -1],
] as const;

export const BOMB_SITES = [
  { id: "A", name: "Site A", position: { x: 14, z: -11 }, radius: 4 },
  { id: "B", name: "Site B", position: { x: -14, z: 11 }, radius: 4 },
] as const;

export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
