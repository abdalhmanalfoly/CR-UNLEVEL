/**
 * ai.ts — Bot AI: finite-state machine with perception, navigation, tactics.
 * States: idle, guard, patrol, moveToObjective, seekCover, investigate, search,
 *         acquireTarget, aiming, engaging, reloading, retreating, flanking,
 *         supportTeammate, planting, defusing, rotate, dead.
 */

import * as THREE from "three";
import { WEAPONS, type WeaponId, mulberry32, TEAMS, type TeamId } from "../config";
import type { World } from "../world";
import type { WeaponSpec } from "../config";

export interface BotCallbacks {
  onBotFire: (botId: number, from: THREE.Vector3, to: THREE.Vector3, accuracy: number) => void;
  onBotKilled: (botId: number) => void;
}

export type BotState =
  | "idle" | "guard" | "patrol" | "moveToObjective" | "seekCover"
  | "investigate" | "search" | "acquireTarget" | "aiming" | "engaging"
  | "reloading" | "retreating" | "flanking" | "supportTeammate"
  | "planting" | "defusing" | "rotate" | "dead";

export type BotDifficulty = "easy" | "normal" | "hard" | "expert";

export interface BotConfig {
  difficulty: BotDifficulty;
  team: TeamId;
  role: "entry" | "support" | "defense";
  hp: number;
  speed: number;
  weapon: WeaponId;
}

const DIFFICULTY: Record<BotDifficulty, {
  detectionDelay: number;
  reactionTime: number;
  aimAccuracy: number;
  recoilControl: number;
  mistakeFrequency: number;
  coverUsage: number;
  aggression: number;
}> = {
  easy: { detectionDelay: 0.8, reactionTime: 0.6, aimAccuracy: 0.45, recoilControl: 0.4, mistakeFrequency: 0.35, coverUsage: 0.3, aggression: 0.5 },
  normal: { detectionDelay: 0.45, reactionTime: 0.35, aimAccuracy: 0.65, recoilControl: 0.6, mistakeFrequency: 0.2, coverUsage: 0.55, aggression: 0.65 },
  hard: { detectionDelay: 0.25, reactionTime: 0.2, aimAccuracy: 0.80, recoilControl: 0.78, mistakeFrequency: 0.1, coverUsage: 0.75, aggression: 0.8 },
  expert: { detectionDelay: 0.12, reactionTime: 0.12, aimAccuracy: 0.92, recoilControl: 0.9, mistakeFrequency: 0.04, coverUsage: 0.9, aggression: 0.9 },
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export class BotController {
  readonly id: number;
  readonly state: BotState = "idle";
  private _state: BotState = "idle";
  get currentState(): BotState { return this._state; }

  private readonly group: THREE.Group;
  private readonly sceneGroup: THREE.Scene;
  private readonly world: World;
  private readonly raycaster: THREE.Raycaster;
  private readonly rng: () => number;
  private readonly config: BotConfig;
  private readonly callbacks: BotCallbacks;
  private readonly difficulty: {
    detectionDelay: number;
    reactionTime: number;
    aimAccuracy: number;
    recoilControl: number;
    mistakeFrequency: number;
    coverUsage: number;
    aggression: number;
  };

  private hp: number;
  private alive = true;
  private dying = 0;
  private position = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private targetPosition = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private lastSeenPlayer = new THREE.Vector3();
  private playerKnown = false;
  private playerKnownTime = 0;

  private cooldown = 0;
  private think = 0;
  private stateTimer = 0;
  private reloadTimer = 0;
  private detectionTimer = 0;
  private patrolIndex = 0;
  private strafeDir = 1;
  private phase = 0;

  private ammo: number;
  private reserve: number;
  private weaponSpec = WEAPONS.pistol;

  constructor(
    id: number,
    scene: THREE.Scene,
    world: World,
    raycaster: THREE.Raycaster,
    config: BotConfig,
    callbacks: BotCallbacks,
    startPos: { x: number; z: number },
  ) {
    this.id = id;
    this.sceneGroup = scene;
    this.world = world;
    this.raycaster = raycaster;
    this.rng = mulberry32(10000 + id * 97);
    this.config = config;
    this.callbacks = callbacks;
    this.difficulty = DIFFICULTY[config.difficulty];
    this.hp = config.hp;
    this.ammo = config.weapon === "knife" ? 0 : WEAPONS[config.weapon].magazine;
    this.reserve = config.weapon === "knife" ? 0 : WEAPONS[config.weapon].reserve;
    this.weaponSpec = WEAPONS[config.weapon];

    this.group = new THREE.Group();
    this.group.position.set(startPos.x, 0, startPos.z);
    this.position.copy(this.group.position);
    scene.add(this.group);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 0.8 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x9b7559, roughness: 0.9 });
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.6, 4, 8);
    const headGeo = new THREE.SphereGeometry(0.23, 8, 6);

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.1;
    body.userData.botId = this.id;
    body.userData.part = "body";
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.82;
    head.userData.botId = this.id;
    head.userData.part = "head";
    head.castShadow = true;
    head.receiveShadow = true;
    this.group.add(head);
  }

  get isAlive(): boolean { return this.alive; }
  get positionVec(): THREE.Vector3 { return this.position; }
  get botState(): BotState { return this._state; }
  get team(): TeamId { return this.config.team; }
  get hpValue(): number { return this.hp; }

  private setState(next: BotState): void {
    if (this._state === next) return;
    this._state = next;
    this.stateTimer = 0;
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      this._state = "dead";
      this.dying = 0.8;
      this.callbacks.onBotKilled(this.id);
      return true;
    }
    return false;
  }

  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean, world: World): void {
    if (this._state === "dead") {
      this.dying -= dt;
      return;
    }

    this.stateTimer += dt;
    this.think -= dt;
    this.cooldown -= dt;
    this.detectionTimer -= dt;
    this.reloadTimer -= dt;

    this.perceive(playerPos, playerAlive, dt);

    // State machine
    switch (this._state) {
      case "idle": this.updateIdle(dt); break;
      case "guard": this.updateGuard(dt); break;
      case "patrol": this.updatePatrol(dt); break;
      case "moveToObjective": this.updateMoveToObjective(dt); break;
      case "seekCover": this.updateSeekCover(dt); break;
      case "investigate": this.updateInvestigate(dt); break;
      case "search": this.updateSearch(dt); break;
      case "acquireTarget": this.updateAcquireTarget(dt, playerPos); break;
      case "aiming": this.updateAiming(dt, playerPos); break;
      case "engaging": this.updateEngaging(dt, playerPos, world); break;
      case "reloading": this.updateReloading(dt); break;
      case "retreating": this.updateRetreating(dt, playerPos); break;
      case "flanking": this.updateFlanking(dt, playerPos); break;
      case "supportTeammate": this.updateSupportTeammate(dt); break;
      case "planting": this.updatePlanting(dt); break;
      case "defusing": this.updateDefusing(dt); break;
      case "rotate": this.updateRotate(dt); break;
    }

    this.applyMovement(dt);
  }

  private perceive(playerPos: THREE.Vector3, playerAlive: boolean, dt: number): void {
    // Simple distance + FOV check
    _v1.copy(this.position).add(new THREE.Vector3(0, 1.5, 0));
    _v2.copy(playerPos).add(new THREE.Vector3(0, 1.5, 0));
    const dist = _v1.distanceTo(_v2);
    _v3.subVectors(_v2, _v1).normalize();

    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
    const dot = facing.dot(_v3);
    const inFov = dot > 0.3; // ~72 degree FOV

    if (playerAlive && dist < 40 && inFov) {
      this.detectionTimer -= dt;
      if (this.detectionTimer <= 0) {
        this.playerKnown = true;
        this.lastSeenPlayer.copy(playerPos);
        this.playerKnownTime = 0;
        this.detectionTimer = this.difficulty.detectionDelay;
      }
    } else if (this.playerKnown) {
      this.playerKnownTime += dt;
      if (this.playerKnownTime > 5) this.playerKnown = false;
    }
  }

  private updateIdle(dt: number): void {
    if (this.playerKnown) { this.setState("acquireTarget"); return; }
    if (this.stateTimer > 4) { this.setState("patrol"); }
  }

  private updateGuard(dt: number): void {
    if (this.playerKnown) { this.setState("acquireTarget"); return; }
  }

  private updatePatrol(dt: number): void {
    if (this.playerKnown) { this.setState("acquireTarget"); return; }
    this.moveTowards(this.targetPosition, dt * 0.5);
    if (this.position.distanceTo(this.targetPosition) < 1) {
      this.setState("idle");
    }
  }

  private updateMoveToObjective(dt: number): void {
    this.moveTowards(this.targetPosition, dt * 0.8);
    if (this.playerKnown) this.setState("acquireTarget");
  }

  private updateSeekCover(dt: number): void {
    this.moveTowards(this.targetPosition, dt * 0.7);
  }

  private updateInvestigate(dt: number): void {
    this.moveTowards(this.lastSeenPlayer, dt * 0.6);
    if (this.position.distanceTo(this.lastSeenPlayer) < 1.5) this.setState("search");
  }

  private updateSearch(dt: number): void {
    this.phase += dt;
    if (this.stateTimer > 6) this.setState("idle");
  }

  private updateAcquireTarget(dt: number, playerPos: THREE.Vector3): void {
    if (!this.playerKnown) { this.setState("search"); return; }
    this.lookAt(playerPos);
    if (this.position.distanceTo(playerPos) < this.weaponSpec.range) {
      this.setState("aiming");
    } else {
      this.setState("moveToObjective");
    }
  }

  private updateAiming(dt: number, playerPos: THREE.Vector3): void {
    this.lookAt(playerPos);
    if (!this.playerKnown) { this.setState("search"); return; }
    if (this.stateTimer > this.difficulty.reactionTime && this.cooldown <= 0) {
      this.setState("engaging");
    }
  }

  private updateEngaging(dt: number, playerPos: THREE.Vector3, world: World): void {
    this.lookAt(playerPos);
    if (!this.playerKnown) { this.setState("search"); return; }
    if (this.cooldown <= 0) {
      this.cooldown = this.weaponSpec.interval * (1.2 - this.difficulty.recoilControl * 0.4);
      const accuracy = this.difficulty.aimAccuracy;
      const hit = this.rng() < accuracy;
      const dir = new THREE.Vector3().subVectors(playerPos, this.position).normalize();
      const to = playerPos.clone();
      if (!hit) {
        to.x += (this.rng() - 0.5) * 3.0;
        to.y += (this.rng() - 0.5) * 2.0;
        to.z += (this.rng() - 0.5) * 3.0;
      }
      const from = this.position.clone().add(new THREE.Vector3(0, 1.5, 0));
      this.callbacks.onBotFire(this.id, from, to, accuracy);
      this.ammo--;
    }
    if (this.ammo <= 0) this.setState("reloading");
    if (this.hp < 40 && this.rng() < this.difficulty.mistakeFrequency * 0.5) this.setState("retreating");
  }

  private updateReloading(dt: number): void {
    if (this.reloadTimer <= 0) {
      this.ammo = this.weaponSpec.magazine;
      this.setState("idle");
    }
  }

  private updateRetreating(dt: number, playerPos: THREE.Vector3): void {
    _v1.subVectors(this.position, playerPos).normalize();
    this.targetPosition.copy(this.position).addScaledVector(_v1, 8);
    this.moveTowards(this.targetPosition, dt * 0.9);
    if (this.stateTimer > 5) this.setState("guard");
  }

  private updateFlanking(dt: number, playerPos: THREE.Vector3): void {
    this.moveTowards(this.targetPosition, dt * 0.7);
    if (this.playerKnown) this.setState("acquireTarget");
  }

  private updateSupportTeammate(dt: number): void {
    if (this.playerKnown) this.setState("acquireTarget");
  }

  private updatePlanting(dt: number): void {
    // Bomb planting handled by game system
  }

  private updateDefusing(dt: number): void {
    // Bomb defusal handled by game system
  }

  private updateRotate(dt: number): void {
    if (this.playerKnown) this.setState("acquireTarget");
  }

  private lookAt(target: THREE.Vector3): void {
    _v1.subVectors(target, this.position);
    _v1.y = 0;
    if (_v1.lengthSq() > 0.0001) {
      this.group.lookAt(this.position.clone().add(_v1));
    }
  }

  private moveTowards(target: THREE.Vector3, speed: number): void {
    _v1.subVectors(target, this.position);
    _v1.y = 0;
    const dist = _v1.length();
    if (dist > 0.05) {
      _v1.normalize();
      this.velocity.copy(_v1).multiplyScalar(speed);
      this.position.addScaledVector(this.velocity, 0.016);
      this.group.position.copy(this.position);
    }
  }

  private applyMovement(dt: number): void {
    // Velocity already applied in moveTowards for simplicity
    this.phase += dt * (Math.abs(this.velocity.x) + Math.abs(this.velocity.z)) * 4;
  }

  getAimAccuracy(): number { return this.difficulty.aimAccuracy; }
  getWeaponSpec(): WeaponSpec { return this.weaponSpec; }
  getAmmo(): number { return this.ammo; }
  getGroup(): THREE.Group { return this.group; }
}

export class BotManager {
  private bots: BotController[] = [];
  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly raycaster: THREE.Raycaster;
  private readonly callbacks: BotCallbacks;
  private readonly shootableTargets: THREE.Object3D[] = [];

  constructor(scene: THREE.Scene, world: World, raycaster: THREE.Raycaster, callbacks: BotCallbacks) {
    this.scene = scene;
    this.world = world;
    this.raycaster = raycaster;
    this.callbacks = callbacks;
  }

  spawnBot(
    id: number,
    team: TeamId,
    difficulty: BotDifficulty,
    role: "entry" | "support" | "defense",
    position: { x: number; z: number },
    weapon: WeaponId = "rifle",
  ): BotController {
    const spec = WEAPONS[weapon];
    const bot = new BotController(id, this.scene, this.world, this.raycaster, {
      difficulty, team, role,
      hp: team === "defenders" ? 100 : 100,
      speed: 4.5,
      weapon,
    }, this.callbacks, position);
    this.bots.push(bot);
    this.shootableTargets.push(bot.getGroup());
    return bot;
  }

  update(dt: number, playerPos: THREE.Vector3, playerAlive: boolean): void {
    for (const bot of this.bots) {
      bot.update(dt, playerPos, playerAlive, this.world);
    }
  }

  getBots(): BotController[] { return this.bots; }
  getAliveCount(): number { return this.bots.filter(b => b.isAlive).length; }
  getShootableTargets(): THREE.Object3D[] { return this.shootableTargets; }

  damageBot(botId: number, amount: number, headshot: boolean): boolean {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot || !bot.isAlive) return false;
    return bot.takeDamage(amount);
  }

  dispose(): void {
    for (const bot of this.bots) this.scene.remove(bot.getGroup());
    this.bots.length = 0;
    this.shootableTargets.length = 0;
  }
}
