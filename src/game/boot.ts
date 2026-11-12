import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GameLoop } from "./engine";
import { Input } from "./input";
import { AudioSystem } from "./audio";
import { World } from "./world";
import { Effects } from "./effects";
import { EnemyManager, type Enemy, type EnemyCallbacks } from "./enemies";
import { GAME, WEAPONS, QUALITY, mulberry32, TEAMS, DEFENDER_SPAWNS, type TeamId, type WeaponId } from "./config";
import { highScore } from "./storage";
import { RoundManager, type RoundState } from "./systems/round";
import { EconomyManager } from "./systems/economy";
import { TeamManager } from "./systems/team";
import { WeaponSystem } from "./systems/weapons";
import { applyDamage, type HitRegion, type DamageConfig } from "./systems/damage";
import { initPhysics, createPlayerCapsule, createPlayerCapsuleAsync, getPlayerPosition, setPlayerPosition, movePlayer, jumpPlayer, isPlayerGrounded, raycast, stepPhysics, addWallCollider, disposePhysics } from "./systems/collision";
import { BotManager } from "./ai/bot";
import { networkClient } from "./net/client";
import type { S2CPlayerInfo } from "@/shared/types";

type Mode = "title" | "playing" | "paused" | "buy" | "victory" | "gameover" | "roundSummary";

interface DebugSnapshot { mode: Mode; health: number; armor: number; credits: number; round: number; enemies: number; calls: number; triangles: number; fps: number; assets: number; lastShot: string; weapon: { present: boolean; visible: boolean; center: number[]; size: number[] }; }

interface RemotePlayerData {
  id: string;
  name: string;
  team: TeamId;
  position: { x: number; y: number; z: number };
  rotation: number;
  health: number;
  armor: number;
  weapon: WeaponId;
  alive: boolean;
  mesh: THREE.Group;
  interpolatedPosition: { x: number; y: number; z: number };
  interpolatedRotation: number;
  lastUpdateTime: number;
}

declare global {
  interface Window {
    __GAME_READY__?: boolean;
    __ASSETS_READY__?: boolean;
    __gameProbe?: () => { x: number; y: number; z: number };
    __gameDebug?: () => DebugSnapshot;
    __gameTest?: { start(): void; busy(): void; target(): void; winRound(): void; loseRound(): void; end(victory: boolean): void };
    __roomCode?: string;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _end = new THREE.Vector3();
const _lookAt = new THREE.Vector3(0, 1.2, 0);
let activeGame: Game | null = null;

class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.045, 140);
  private readonly world: World;
  private readonly effects: Effects;
  private readonly input: Input;
  private readonly audio = new AudioSystem();
  private readonly loop: GameLoop;
  private readonly raycaster = new THREE.Raycaster();
  private readonly rng = mulberry32(4102026);
  private readonly playerPos = new THREE.Vector3();
  private readonly weaponRig = new THREE.Group();
  private readonly listeners: Array<() => void> = [];

  // Subsystems
  private readonly roundManager: RoundManager;
  private readonly economy: EconomyManager;
  private readonly teamManager: TeamManager;
  private readonly weaponSystem: WeaponSystem;
  private botManager: BotManager;

  // Enemies (existing system)
  private readonly enemies: EnemyManager;
  private readonly enemyCallbacks: EnemyCallbacks;
  private readonly shootables: THREE.Object3D[] = [];
  private readonly enemyTargets: THREE.Object3D[] = [];

  // Multiplayer
  private networkMode = false;
  private myPlayerId: string | null = null;
  private myTeam: TeamId | null = null;
  private roomCode: string | null = null;
  private readonly remotePlayers = new Map<string, RemotePlayerData>();
  private inputSendTimer = 0;

  // Game state
  private mode: Mode = "title";
  private disposed = false;
  private yaw = 0;
  private pitch = 0;
  private health = 100;
  private armor = 0;
  private hasHelmet = false;
  private credits: number = GAME.START_CREDITS;
  private kills = 0;
  private deaths = 0;
  private shots = 0;
  private hits = 0;
  private currentWeapon: WeaponId = "pistol";
  private triggerHeld = false;
  private triggerPressed = false;
  private aiming = false;
  private fireCooldown = 0;
  private reloadTimer = 0;
  private weaponKick = 0;
  private bob = 0;
  private stepTimer = 0;
  private playerSpeed = 0;
  private grace = 0;
  private uiTimer = 0;
  private bannerTimer = 0;
  private hitTimer = 0;
  private damageTimer = 0;
  private titleTime = 0;
  private pointerWasLocked = false;
  private loadedAssets = 0;
  private lastShot = "none";
  private fps = 60;
  private fpsTime = 0;
  private fpsFrames = 0;
  private lowFpsTime = 0;
  private lastFrame = performance.now();
  private roundStartTime = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    multiplayer?: { serverUrl: string; playerName: string; room?: string },
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.camera);
    this.camera.add(this.weaponRig);
    this.weaponRig.visible = false;
    this.world = new World(this.scene);
    this.effects = new Effects(this.scene, this.camera);
    this.enemies = new EnemyManager(this.scene);
    this.input = new Input(canvas);

    // Initialize subsystems
    this.roundManager = new RoundManager(
      { maxRounds: GAME.MAX_ROUNDS, winScore: Math.ceil(GAME.MAX_ROUNDS / 2) + 1 },
      (state) => this.onRoundStateChanged(state),
      (winner, reason) => this.onRoundEnded(winner, reason),
    );
    this.economy = new EconomyManager({ startCredits: GAME.START_CREDITS, killReward: GAME.KILL_REWARD, winReward: GAME.WIN_REWARD, lossReward: GAME.LOSS_REWARD });
    this.teamManager = new TeamManager();
    this.weaponSystem = new WeaponSystem();
    this.botManager = new BotManager(this.scene, this.world, this.raycaster, {
      onBotFire: (botId, from, to, accuracy) => this.onBotFire(botId, from, to, accuracy),
      onBotKilled: (botId) => this.onBotKilled(botId),
    });

    this.enemyCallbacks = {
      damagePlayer: (amount) => this.damagePlayer(amount),
      enemyShot: (from, to, hit) => { this.effects.tracer(from, to, true); this.audio.enemyShot(); if (!hit) this.effects.burst(to, 3, 0.5); },
      killed: (enemy, headshot) => this.onEnemyKilled(enemy, headshot),
    };

    this.bindUI();
    this.resize();
    this.setMode("title");
    this.camera.position.set(24, 14, 25);
    this.camera.lookAt(_lookAt);
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: () => this.render() });
    this.loop.start();
    void this.loadWeapons();
    window.__gameProbe = () => ({ x: this.playerPos.x, y: this.playerPos.y, z: this.playerPos.z });
    window.__gameDebug = () => {
      const model = this.getWeaponModel();
      const box = model ? new THREE.Box3().setFromObject(model) : null;
      const center = box ? box.getCenter(new THREE.Vector3()).toArray() : [];
      const size = box ? box.getSize(new THREE.Vector3()).toArray() : [];
      return { mode: this.mode, health: this.health, armor: this.armor, credits: this.credits, round: this.roundManager.roundNumber, enemies: this.botManager.getAliveCount(), calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: Math.round(this.fps), assets: this.loadedAssets, lastShot: this.lastShot, weapon: { present: !!model, visible: !!model?.visible, center, size } };
    };
    window.__gameTest = {
      start: () => this.beginMatch(),
      busy: () => { this.beginMatch(); this.spawnBotsForRound(); this.updateUI(); },
      target: () => { const bots = this.botManager.getBots(); const e = bots.find((bot) => bot.isAlive); if (e) { this.yaw = 0; this.pitch = -0.15; e.getGroup().position.set(this.playerPos.x, 0, this.playerPos.z - 3); } },
      winRound: () => { for (const b of this.botManager.getBots()) if (b.isAlive) b.takeDamage(999); },
      loseRound: () => { this.grace = 0; this.damagePlayer(999); },
      end: (victory) => { this.kills = victory ? 2 : 0; this.endMatch(); },
    };

    // Multiplayer setup
    if (multiplayer) {
      this.networkMode = true;
      networkClient.connect(multiplayer.serverUrl);
      networkClient.onConnect = () => {
        console.log("[NET] onConnect fired, room=", multiplayer.room);
        if (multiplayer.room) {
          networkClient.joinRoom(multiplayer.room, multiplayer.playerName);
        } else {
          networkClient.createRoom("Room", multiplayer.playerName);
        }
      };
      networkClient.onRoomCreated = (roomCode, roomName, playerId, playerName, team) => {
        console.log("[NET] onRoomCreated", roomCode);
        window.__roomCode = roomCode;
        this.myPlayerId = playerId;
        this.myTeam = team;
        this.roomCode = roomCode;
      };
      networkClient.onRoomJoined = (roomCode, roomName, playerId, playerName, team, players, hostId) => {
        console.log("[NET] onRoomJoined", roomCode);
        window.__roomCode = roomCode;
        this.myPlayerId = playerId;
        this.myTeam = team;
        this.roomCode = roomCode;
        for (const p of players) {
          if (p.id !== playerId) this.spawnRemotePlayer(p);
        }
      };
      networkClient.onPlayerJoined = (player) => {
        if (player.id !== this.myPlayerId) this.spawnRemotePlayer(player);
      };
      networkClient.onPlayerLeft = (playerId) => {
        const rp = this.remotePlayers.get(playerId);
        if (rp) {
          this.scene.remove(rp.mesh);
          this.remotePlayers.delete(playerId);
        }
      };
      networkClient.onPlayerUpdated = (playerId, updates) => {
        if (playerId === this.myPlayerId) return;
        const rp = this.remotePlayers.get(playerId);
        if (!rp) return;
        if (updates.position) rp.position = updates.position;
        if (typeof updates.rotation === "number") rp.rotation = updates.rotation;
        if (updates.health !== undefined) rp.health = updates.health;
        if (updates.armor !== undefined) rp.armor = updates.armor;
        if (updates.weapon !== undefined) rp.weapon = updates.weapon;
        if (updates.alive !== undefined) rp.alive = updates.alive;
      };
      networkClient.onMatchStart = (roundState, round, roundTimeLeft, teamScores, players) => {
        this.roundManager["round"] = round;
        this.roundManager["roundTimer"] = roundTimeLeft;
        for (const p of players) {
          if (p.id === this.myPlayerId) {
            this.myTeam = p.team;
            this.health = p.health;
            this.armor = p.armor;
            this.currentWeapon = p.weapon;
          }
          if (p.id !== this.myPlayerId) {
            const rp = this.remotePlayers.get(p.id);
            if (rp) {
              rp.team = p.team;
              rp.health = p.health;
              rp.armor = p.armor;
              rp.weapon = p.weapon;
              rp.alive = p.alive;
            } else {
              this.spawnRemotePlayer(p);
            }
          }
        }
        this.setMode("playing");
        this.requestLock();
      };
      networkClient.onPlayerSpawned = (playerId, position, team, health, armor, weapon) => {
        if (playerId === this.myPlayerId) {
          setPlayerPosition(position.x, position.y, position.z);
          this.playerPos.copy(position);
          this.health = health;
          this.armor = armor;
          this.currentWeapon = weapon;
        } else {
          const rp = this.remotePlayers.get(playerId);
          if (rp) {
            rp.position = position;
            rp.health = health;
            rp.armor = armor;
            rp.weapon = weapon;
            rp.alive = true;
            rp.mesh.position.set(position.x, position.y, position.z);
            rp.mesh.rotation.y = 0;
            rp.interpolatedPosition = { ...position };
          }
        }
      };
      networkClient.onPlayerDied = (victimId, killerId, weapon, headshot) => {
        if (victimId === this.myPlayerId) {
          this.health = 0;
          this.deaths++;
        }
        const rp = this.remotePlayers.get(victimId);
        if (rp) { rp.alive = false; rp.mesh.visible = false; }
      };
      networkClient.onShootValidated = (shooterId, hit, targetId, headshot, damage, ammo) => {
        if (shooterId === this.myPlayerId) {
          const w = this.weaponSystem.getCurrentAmmo();
          w.magazine = ammo;
        }
        const rp = this.remotePlayers.get(shooterId);
        if (rp && hit && targetId) {
          const trp = this.remotePlayers.get(targetId);
          if (trp) { trp.health = Math.max(0, trp.health - damage); }
        }
      };
      networkClient.onRoundState = (state, round, roundTimeLeft, teamScores) => {
        this.roundManager["round"] = round;
        this.roundManager["roundTimer"] = roundTimeLeft;
      };
      networkClient.onWeaponSwitched = (playerId, weapon) => {
        if (playerId === this.myPlayerId) {
          this.currentWeapon = weapon;
          this.weaponModels.forEach((m, k) => { m.visible = k === weapon; });
        } else {
          const rp = this.remotePlayers.get(playerId);
          if (rp) rp.weapon = weapon;
        }
      };
      networkClient.onScoreUpdate = (playerId, kills, deaths, credits) => {
        if (playerId === this.myPlayerId) {
          this.kills = kills;
          this.deaths = deaths;
          this.credits = credits;
        }
      };
      networkClient.onPlayerRespawned = (playerId, position, team) => {
        if (playerId === this.myPlayerId) {
          setPlayerPosition(position.x, position.y, position.z);
          this.playerPos.copy(position);
          this.health = 100;
          this.armor = 0;
          this.currentWeapon = "pistol";
          this.weaponSystem.equip("pistol");
          this.setMode("playing");
        } else {
          const rp = this.remotePlayers.get(playerId);
          if (rp) {
            rp.position = position;
            rp.rotation = 0;
            rp.alive = true;
            rp.health = 100;
            rp.armor = 0;
            rp.weapon = "pistol";
            rp.mesh.position.set(position.x, position.y, position.z);
            rp.mesh.rotation.y = 0;
            rp.mesh.visible = true;
            rp.interpolatedPosition = { ...position };
          }
        }
      };
    }

    const params = new URLSearchParams(location.search);
    if (params.get("state") === "play") this.beginMatch();
    if (params.get("state") === "busy") window.__gameTest.busy();
  }

  private on<T extends Event>(target: Window | Document | HTMLElement, type: string, fn: (event: T) => void, options?: AddEventListenerOptions): void {
    const handler = fn as EventListener;
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  private bindUI(): void {
    this.on(window, "resize", () => this.resize());
    this.on(window, "keydown", (event) => {
      const e = event as KeyboardEvent;
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    });
    this.on(this.canvas, "mousedown", (event) => {
      const e = event as MouseEvent;
      if (this.mode !== "playing") return;
      if (!document.pointerLockElement) { this.requestLock(); return; }
      if (e.button === 0) { this.triggerHeld = true; this.triggerPressed = true; }
      if (e.button === 2) this.aiming = true;
    });
    this.on(window, "mouseup", (event) => {
      const e = event as MouseEvent;
      if (e.button === 0) this.triggerHeld = false;
      if (e.button === 2) this.aiming = false;
    });
    this.on(this.canvas, "contextmenu", (event) => event.preventDefault());
    this.on(document, "pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) this.pointerWasLocked = true;
      else {
        if (this.pointerWasLocked && this.mode === "playing") this.pause();
        this.pointerWasLocked = false;
      }
    });
    this.on(document, "visibilitychange", () => { if (document.hidden && this.mode === "playing") this.pause(); });
    this.on($("start-btn"), "click", () => { this.beginMatch(); this.requestLock(); });
    this.on($("next-round-btn"), "click", () => { this.beginRound(); this.requestLock(); });
    this.on($("resume-btn"), "click", () => this.resume());
    this.on($("restart-btn"), "click", () => { this.beginMatch(); this.requestLock(); });
    this.on($("end-restart-btn"), "click", () => { this.beginMatch(); this.requestLock(); });
    this.on($("mute-btn"), "click", () => { const muted = this.audio.toggleMute(); $("mute-btn").textContent = muted ? "الصوت: مكتوم" : "الصوت: يعمل"; });
    $("mute-btn").textContent = this.audio.muted ? "الصوت: مكتوم" : "الصوت: يعمل";
    document.querySelectorAll<HTMLButtonElement>("[data-buy]").forEach((button) => {
      const handler = () => this.buy(button.dataset.buy as WeaponId | "armor");
      button.addEventListener("click", handler);
      this.listeners.push(() => button.removeEventListener("click", handler));
    });
  }

  private requestLock(): void {
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch(() => { /* drag-to-look remains available */ });
    } catch { /* pointer lock is optional in restricted previews */ }
  }

  private weaponModels: Map<WeaponId, THREE.Group> = new Map();

  private async loadWeapons(): Promise<void> {
    await Promise.all((["pistol", "rifle", "sniper"] as WeaponId[]).map(async (id) => {
      try {
        const url = new URL(`assets/weapons/${id}/model.glb`, document.baseURI).href;
        const gltf = await new GLTFLoader().loadAsync(url);
        const root = gltf.scene;
        if (this.disposed) return;
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const align = new THREE.Group(); align.position.copy(center).multiplyScalar(-1); align.add(root);
        const placement = new THREE.Group(); placement.add(align);
        if (size.x > size.z) placement.rotation.y = Math.PI / 2;
        const length = Math.max(size.x, size.z);
        placement.scale.setScalar((id === "rifle" ? 0.93 : 1.16) / Math.max(0.001, length));
        placement.visible = id === this.currentWeapon;
        placement.traverse((obj) => { if (obj instanceof THREE.Mesh) { obj.castShadow = false; obj.receiveShadow = false; } });
        this.weaponModels.set(id, placement);
        this.weaponRig.add(placement);
        this.weaponSystem.getWeapon(id);
        this.loadedAssets++;
        if (this.loadedAssets === 3) window.__ASSETS_READY__ = true;
      } catch (error) {
        console.warn(`Weapon asset ${id} unavailable; using local fallback`, error);
        const fallback = this.makeFallbackWeapon(id);
        this.weaponModels.set(id, fallback);
        this.weaponRig.add(fallback);
        this.loadedAssets++;
        if (this.loadedAssets === 3) window.__ASSETS_READY__ = true;
      }
    }));
  }

  private makeFallbackWeapon(id: WeaponId): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: id === "rifle" ? 0x364644 : 0x596044, roughness: 0.55, metalness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, id === "rifle" ? 0.75 : 1.0), mat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 8), mat);
    barrel.rotation.x = Math.PI / 2; barrel.position.z = -0.55; group.add(body, barrel);
    group.visible = id === this.currentWeapon;
    return group;
  }

  private getWeaponModel(): THREE.Group | undefined {
    return this.weaponModels.get(this.currentWeapon);
  }

  private setMode(mode: Mode): void {
    this.mode = mode; document.body.dataset.mode = mode;
    for (const id of ["title-screen", "buy-screen", "pause-screen", "end-screen"]) $(id).classList.remove("active");
    if (mode === "title") $("title-screen").classList.add("active");
    if (mode === "buy") $("buy-screen").classList.add("active");
    if (mode === "paused") $("pause-screen").classList.add("active");
    if (mode === "victory" || mode === "gameover") $("end-screen").classList.add("active");
    this.weaponRig.visible = mode === "playing" || mode === "paused";
    if (mode !== "playing") { this.triggerHeld = false; this.triggerPressed = false; this.aiming = false; $("scope").classList.remove("active"); }
    this.updateUI();
  }

  private onRoundStateChanged(state: RoundState): void {
    if (state === "buy") this.openBuy();
    else if (state === "freeze") this.setMode("playing");
    else if (state === "matchOver") this.endMatch();
  }

  private onRoundEnded(winner: TeamId, reason: string): void {
    this.showBanner(`جولة انتهت`, winner === "attackers" ? "الهجوم فاز" : "الدفاع فاز", `السبب: ${reason}`, 3.0);
  }

  private beginMatch(): void {
    this.health = 100; this.armor = 0; this.hasHelmet = false;
    this.kills = 0; this.deaths = 0; this.shots = 0; this.hits = 0;
    this.credits = GAME.START_CREDITS;
    this.economy.resetMatch();
    this.teamManager.resetMatch();
    this.weaponSystem.resetMatch();
    this.roundManager.startMatch();
    this.audio.startMusic();
    this.spawnBotsForRound();
    this.teamManager.setAlive("attackers", 1);
    this.teamManager.setAlive("defenders", this.botManager.getAliveCount());
    this.setMode("playing");
    this.resetPlayerState();
  }

  private beginRound(): void {
    this.roundManager.startRound();
    this.resetPlayerState();
    this.spawnBotsForRound();
    this.teamManager.setAlive("attackers", 1);
    this.teamManager.setAlive("defenders", this.botManager.getAliveCount());
    this.setMode("playing");
    this.showBanner(`الجولة ${this.roundManager.roundNumber}`, "ابدأ العملية", `الأعداء المتبقون: ${this.botManager.getAliveCount()}`, 2.0);
  }

  private spawnBotsForRound(): void {
    if (!this.botManager) return;
    const round = this.roundManager.roundNumber;
    const count = Math.min(2 + round * 2, 7);
    const spawns = DEFENDER_SPAWNS;
    for (let i = 0; i < count; i++) {
      const [x, z] = spawns[i % spawns.length];
      const difficulty: "easy" | "normal" | "hard" | "expert" = round >= 3 ? "hard" : round >= 2 ? "normal" : "easy";
      const role: "entry" | "support" | "defense" = i % 3 === 0 ? "entry" : i % 3 === 1 ? "support" : "defense";
      this.botManager.spawnBot(i + 100, "defenders", difficulty, role, { x, z }, "rifle");
    }
  }

  private resetPlayerState(): void {
    const spawn = this.world.playerSpawn;
    setPlayerPosition(spawn.x, spawn.y, spawn.z);
    this.playerPos.copy(spawn);
    this.yaw = 0; this.pitch = 0;
    this.fireCooldown = 0; this.reloadTimer = 0; this.grace = 2.2; this.weaponKick = 0;
    this.health = 100; this.armor = 0; this.hasHelmet = false;
    this.currentWeapon = "pistol";
    this.aiming = false;
    this.triggerHeld = false; this.triggerPressed = false;
  }

  private pause(): void {
    if (this.mode === "playing" && !this.roundManager.isMatchOver) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.setMode("paused");
    }
  }
  private resume(): void { if (this.mode === "paused") { this.setMode("playing"); this.requestLock(); } }

  private finishRound(won: boolean): void {
    if (this.roundManager.stateName === "ending" || this.roundManager.stateName === "matchOver") return;
    const winner = won ? "attackers" : "defenders";
    const reason = won ? "elimination" : "time_expired";
    this.roundManager.endRound(winner, reason);
  }

  private openBuy(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.setMode("buy");
    $("round-result").textContent = `النتيجة الآن ${this.roundManager.scores.attackers} — ${this.roundManager.scores.defenders}. جهّز نفسك للجولة ${this.roundManager.roundNumber}.`;
    this.updateBuyUI();
  }

  private endMatch(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.botManager) this.botManager.dispose();
    const victory = this.roundManager.scores.attackers > this.roundManager.scores.defenders;
    this.setMode(victory ? "victory" : "gameover");
    $("end-title").textContent = victory ? "تم تأمين المجمع" : "فشلت العملية";
    $("end-subtitle").textContent = victory ? "أداء تكتيكي ممتاز. خط الرمل تحت السيطرة." : "الخصم حسم المواجهة. أعد تنظيم معداتك وحاول مجددًا.";
    $("end-badge").textContent = victory ? "MISSION COMPLETE" : "MISSION FAILED";
    $("stat-kills").textContent = String(this.kills);
    $("stat-accuracy").textContent = `${this.shots ? Math.round(this.hits / this.shots * 100) : 0}%`;
    $("stat-rounds").textContent = String(this.roundManager.scores.attackers);
    if (this.kills > highScore.get()) highScore.set(this.kills);
    this.audio.sfx(victory ? "win" : "lose");
  }

  private buy(item: WeaponId | "armor"): void {
    if (this.mode !== "buy") return;
    const team = "attackers" as TeamId;
    if (item === "armor") {
      const result = this.weaponSystem.purchaseEquipment("armor", 650, this.credits);
      if (result.success) { this.credits = result.remaining; this.armor = Math.min(100, this.armor + 50); this.audio.sfx("pickup"); }
      else this.audio.dry();
    } else {
      const result = this.weaponSystem.purchaseWeapon(item, WEAPONS[item].cost, this.credits);
      if (result.success) { this.credits = result.remaining; this.weaponSystem.equip(item); this.currentWeapon = item; this.audio.sfx("pickup"); }
      else this.audio.dry();
    }
    this.updateUI(); this.updateBuyUI();
  }

  private updateBuyUI(): void {
    $("buy-credits").textContent = `$${this.credits.toLocaleString("en-US")}`;
    const sniper = document.querySelector<HTMLButtonElement>('[data-buy="sniper"]')!;
    const w = this.weaponSystem.getWeapon("sniper");
    sniper.disabled = !w.owned && this.credits < WEAPONS.sniper.cost;
    const footer = sniper.querySelector("footer")!;
    footer.querySelector("b")!.textContent = w.owned ? "مملوك" : `$${WEAPONS.sniper.cost}`;
    footer.querySelector("em")!.textContent = w.owned ? "تجهيز" : "شراء وتجهيز";
    const armor = document.querySelector<HTMLButtonElement>('[data-buy="armor"]')!;
    armor.disabled = this.credits < 650 || this.armor >= 100;
    armor.querySelector("footer em")!.textContent = this.armor >= 100 ? "الدرع مكتمل" : "+50 درع";
  }

  private switchWeapon(id: WeaponId): void {
    if (!this.weaponSystem.getWeapon(id).owned) return;
    this.currentWeapon = id;
    this.reloadTimer = 0;
    this.fireCooldown = 0.25;
    this.aiming = false;
    this.weaponModels.forEach((model, key) => { model.visible = key === id; });
    this.weaponSystem.equip(id);
    this.audio.sfx("ui");
    this.updateUI();
  }

  private reload(): void {
    if (this.weaponSystem.reload()) {
      this.reloadTimer = WEAPONS[this.currentWeapon].reload;
      this.aiming = false;
      this.audio.reload();
    }
    this.updateUI();
  }

  private fire(): void {
    const spec = WEAPONS[this.currentWeapon];
    if (this.fireCooldown > 0 || this.reloadTimer > 0 || this.roundManager.stateName !== "active") return;
    if (!this.weaponSystem.hasAmmo()) { this.audio.dry(); this.fireCooldown = 0.28; return; }

    this.weaponSystem.consumeAmmo();
    this.shots++;
    this.fireCooldown = spec.interval;

    _origin.copy(getPlayerPosition() || this.playerPos);
    _origin.y -= 0.03;
    const cp = Math.cos(this.pitch);
    _direction.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);

    let spread = spec.spread + this.playerSpeed * spec.moveSpread * 0.16 + this.weaponKick * 0.012;
    if (this.aiming) spread *= this.currentWeapon === "sniper" ? 0.08 : 0.45;
    else if (this.currentWeapon === "sniper") spread += 0.018;
    _direction.x += (this.rng() - 0.5) * spread * 2;
    _direction.y += (this.rng() - 0.5) * spread * 2;
    _direction.z += (this.rng() - 0.5) * spread * 2;
    _direction.normalize();

    this.raycaster.set(_origin, _direction);
    this.raycaster.far = spec.range;
    this.enemies.targets(this.enemyTargets);
    this.shootables.length = 0;
    this.shootables.push(...this.world.collisionMeshes, ...this.enemyTargets, ...this.botManager.getShootableTargets());
    const hit = this.raycaster.intersectObjects(this.shootables, true)[0];

    if (hit) {
      _end.copy(hit.point);
      const enemy = hit.object.userData.enemy as Enemy | undefined;
      const botId = hit.object.userData.botId as number | undefined;
      this.lastShot = `${hit.object.name || "mesh"}:${hit.object.userData.part || "world"}:${enemy ? `${enemy.hp}/${enemy.role}` : botId ? `bot:${botId}` : "obstacle"}@${hit.distance.toFixed(2)}`;

      if (botId !== undefined) {
        const headshot = hit.object.userData.part === "head";
        const dmg = headshot ? spec.headDamage : spec.damage;
        const killed = this.botManager.damageBot(botId, dmg, headshot);
        this.hits++;
        if (killed) {
          this.showHitmarker(true);
          this.effects.burst(_end, 14, 2.8);
        } else {
          this.showHitmarker(false);
          this.effects.burst(_end, 8, 2.8);
        }
        this.audio.sfx("hit");
        this.updateUI();
      } else if (enemy?.alive) {
        const headshot = hit.object.userData.part === "head";
        const dmg = headshot ? spec.headDamage : spec.damage;
        const killed = enemy.damage(dmg, headshot, this.enemyCallbacks) === "dead";
        if (killed) {
          this.hits++;
          this.kills++;
          this.economy.rewardKill("attackers");
          this.credits = this.economy.getCredits("attackers");
          this.showHitmarker(true);
          this.effects.burst(_end, 14, 2.8);
          this.audio.sfx("hit");
        } else {
          this.hits++;
          this.showHitmarker(false);
          this.effects.burst(_end, 8, 2.8);
          this.audio.sfx("hit");
        }
      } else {
        this.effects.burst(_end, 7, 1.8);
      }
    } else {
      this.lastShot = "miss";
      _end.copy(_origin).addScaledVector(_direction, 65);
    }

    _origin.addScaledVector(_direction, 0.55);
    _origin.y -= 0.17;
    this.effects.tracer(_origin, _end);
    this.effects.flash();
    this.audio.shot(this.currentWeapon === "sniper");

    this.pitch = Math.min(1.45, this.pitch + spec.recoil);
    this.yaw += (this.rng() - 0.5) * spec.recoil * 0.55;
    this.weaponKick = Math.min(1.5, this.weaponKick + (this.currentWeapon === "sniper" ? 1.1 : 0.32));
    this.updateUI();

    if (this.botManager.getAliveCount() === 0 && this.roundManager.stateName === "active") this.finishRound(true);
  }

  private damagePlayer(amount: number): void {
    if (this.mode !== "playing" || this.grace > 0) return;
    const result = applyDamage(this.health, this.armor, amount, "torso", this.hasHelmet);
    this.health = result.health;
    this.armor = result.armor;
    this.damageTimer = 0.22;
    $("damage-flash").classList.add("active");
    this.audio.hurt();
    if (result.killed) {
      this.deaths++;
      this.finishRound(false);
    }
    this.updateUI();
  }

  private onBotFire(botId: number, from: THREE.Vector3, to: THREE.Vector3, accuracy: number): void {
    this.effects.tracer(from, to, true);
    this.audio.enemyShot();
    const playerPos = getPlayerPosition();
    if (!playerPos) return;
    const eye = new THREE.Vector3(playerPos.x, playerPos.y + GAME.PLAYER_EYE_HEIGHT, playerPos.z);
    const dist = from.distanceTo(eye);
    if (dist > this.weaponSystem.getCurrentSpec().range) return;
    if (this.world.lineOfSight(from, eye, this.raycaster)) {
      this.damagePlayer(WEAPONS.rifle.damage);
    }
  }

private onBotKilled(botId: number): void {
    this.kills++;
    this.credits += GAME.KILL_REWARD;
    this.economy.rewardKill("attackers");
    this.credits = this.economy.getCredits("attackers");

    const item = document.createElement("div");
    item.innerHTML = `<b>أنت</b> › 특수 요원 <span>+$${GAME.KILL_REWARD}</span>`;
    $("killfeed").prepend(item);
    while ($("killfeed").children.length > 4) $("killfeed").lastElementChild?.remove();
    setTimeout(() => item.remove(), 4200);
    this.updateUI();

    if (this.botManager.getAliveCount() === 0 && this.roundManager.stateName === "active") {
      this.finishRound(true);
    }
  }

  spawnRemotePlayer(player: S2CPlayerInfo): void {
    const remote = this.remotePlayers.get(player.id);
    if (remote) {
      remote.mesh.visible = true;
      remote.health = player.health;
      remote.armor = player.armor;
      remote.weapon = player.weapon;
      remote.alive = player.alive;
      return;
    }
    const defaultPosition = { x: 0, y: GAME.PLAYER_HEIGHT, z: 0 };
    const group = new THREE.Group();
    group.position.set(defaultPosition.x, defaultPosition.y, defaultPosition.z);
    group.rotation.y = 0;
    const mat = new THREE.MeshStandardMaterial({ color: player.team === "attackers" ? 0x173f3d : 0x5c4a3a, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 4, 8), mat);
    body.position.y = 1.1;
    body.userData.botId = player.id;
    body.userData.part = "body";
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 8, 6), mat);
    head.position.y = 1.82;
    head.userData.botId = player.id;
    head.userData.part = "head";
    group.add(head);
    group.visible = player.alive;
    this.scene.add(group);
    this.remotePlayers.set(player.id, { id: player.id, name: player.name, team: player.team, position: defaultPosition, rotation: 0, health: player.health, armor: player.armor, weapon: player.weapon, alive: player.alive, mesh: group, interpolatedPosition: { ...defaultPosition }, interpolatedRotation: 0, lastUpdateTime: Date.now() });
  }

  private onEnemyKilled(enemy: Enemy, headshot: boolean): void {
    const role = enemy.role === "heavy" ? "ثقيل" : enemy.role === "rusher" ? "مهاجم" : "مقاتل";
    const item = document.createElement("div");
    item.innerHTML = `<b>أنت</b> ${headshot ? "◈" : "›"} ${role} <span>+$${GAME.KILL_REWARD}</span>`;
    $("killfeed").prepend(item);
    while ($("killfeed").children.length > 4) $("killfeed").lastElementChild?.remove();
    setTimeout(() => item.remove(), 4200);
    this.updateUI();
  }

  private showHitmarker(kill: boolean): void {
    this.hitTimer = kill ? 0.2 : 0.11;
    $("hitmarker").classList.toggle("kill", kill);
    $("hitmarker").classList.add("active");
  }

  private showBanner(small: string, strong: string, span: string, duration: number): void {
    const banner = $("round-banner");
    banner.querySelector("small")!.textContent = small;
    banner.querySelector("strong")!.textContent = strong;
    banner.querySelector("span")!.textContent = span;
    banner.classList.add("active");
    this.bannerTimer = duration;
  }

  private handleActions(): void {
    if (this.input.consumeAction("Space")) {
      if (this.mode === "title") { this.beginMatch(); this.requestLock(); }
      else if (this.mode === "buy") { this.beginRound(); this.requestLock(); }
    }
    if (this.input.consumeAction("Escape") || this.input.consumeAction("KeyP")) {
      if (this.mode === "playing") this.pause();
      else if (this.mode === "paused") this.resume();
    }
    if (this.mode !== "playing") return;
    if (this.input.consumeAction("KeyR")) this.reload();
    if (this.input.consumeAction("Digit1")) this.switchWeapon("rifle");
    if (this.input.consumeAction("Digit2")) this.switchWeapon("sniper");
  }

  private update(dt: number): void {
    if (this.disposed) return;
    this.world.update(dt);
    this.effects.update(dt);
    this.handleActions();
    stepPhysics(dt);

    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) $("round-banner").classList.remove("active");
    if (this.hitTimer > 0 && (this.hitTimer -= dt) <= 0) $("hitmarker").classList.remove("active");
    if (this.damageTimer > 0 && (this.damageTimer -= dt) <= 0) $("damage-flash").classList.remove("active");

    this.roundManager.update(dt);

    if (this.mode === "title") {
      this.titleTime += dt * 0.09;
      this.camera.position.set(Math.cos(this.titleTime) * 29, 13.5, Math.sin(this.titleTime) * 29);
      this.camera.lookAt(_lookAt);
      this.input.consumeLook();
      return;
    }
    if (this.mode !== "playing") { this.input.consumeLook(); return; }

    const pos = getPlayerPosition();
    if (pos) this.playerPos.copy(pos);

    if (this.roundManager.stateName === "ending" || this.roundManager.stateName === "matchOver") {
      this.input.consumeLook();
      return;
    }

    const look = this.input.consumeLook();
    this.yaw += look.yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.pitch, -1.42, 1.42);

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.grace = Math.max(0, this.grace - dt);
    this.weaponKick = Math.max(0, this.weaponKick - dt * 2.7);

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const w = WEAPONS[this.currentWeapon];
        const needed = w.magazine - this.weaponSystem.getCurrentAmmo().magazine;
        const moved = Math.min(needed, this.weaponSystem.getCurrentAmmo().reserve);
        const ammo = this.weaponSystem.getCurrentAmmo();
        ammo.magazine += moved;
        ammo.reserve -= moved;
        this.audio.sfx("pickup");
      }
    }

    const mx = this.input.moveX;
    const mz = this.input.moveZ;
    const magnitude = Math.hypot(mx, mz);
    const sprint = this.input.isHeld("ShiftLeft") && mz > 0 && !this.aiming;
    const speed = (sprint ? GAME.SPRINT_SPEED : GAME.WALK_SPEED) * (this.aiming ? 0.7 : 1);

    if (magnitude > 0.01) {
      const nx = mx / Math.max(1, magnitude);
      const nz = mz / Math.max(1, magnitude);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const vx = (rx * nx + fx * nz) * speed;
      const vz = (rz * nx + fz * nz) * speed;
      movePlayer(vx, 0, vz);
      this.playerSpeed = speed;
      this.bob += dt * speed * 1.7;
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { this.audio.step(); this.stepTimer = sprint ? 0.31 : 0.43; }
    } else {
      this.playerSpeed = 0;
      this.stepTimer = 0;
    }

    if (this.input.isHeld("Space")) {
      if (isPlayerGrounded()) jumpPlayer(GAME.JUMP_SPEED);
    }

    if (this.triggerHeld || this.triggerPressed) {
      if (WEAPONS[this.currentWeapon].automatic || this.triggerPressed) this.fire();
    }
    this.triggerPressed = false;

    if (this.botManager && this.roundManager.stateName === "active") {
      this.botManager.update(dt, this.playerPos, this.health > 0);
    }

    if (this.networkMode && networkClient.isConnected && this.mode === "playing") {
      networkClient.sendPlayerInput({
        moveX: this.input.moveX,
        moveZ: this.input.moveZ,
        yaw: this.yaw,
        pitch: this.pitch,
        fire: this.triggerHeld || this.triggerPressed,
        aim: this.aiming,
        reload: this.input.consumeAction("KeyR"),
        switchWeapon: this.currentWeapon,
        jump: this.input.isHeld("Space"),
        timestamp: Date.now(),
      });
      for (const rp of this.remotePlayers.values()) {
        rp.interpolatedPosition.x += (rp.position.x - rp.interpolatedPosition.x) * Math.min(1, dt * 10);
        rp.interpolatedPosition.y += (rp.position.y - rp.interpolatedPosition.y) * Math.min(1, dt * 10);
        rp.interpolatedPosition.z += (rp.position.z - rp.interpolatedPosition.z) * Math.min(1, dt * 10);
        rp.interpolatedRotation += (rp.rotation - rp.interpolatedRotation) * Math.min(1, dt * 10);
        rp.mesh.position.copy(rp.interpolatedPosition);
        rp.mesh.rotation.y = rp.interpolatedRotation;
        rp.mesh.visible = rp.alive;
      }
    }

    this.updateCamera(dt);
    this.updateUI();
  }

  private updateCamera(dt: number): void {
    const bobY = Math.abs(Math.sin(this.bob)) * Math.min(0.035, this.playerSpeed * 0.005);
    const pos = getPlayerPosition() || this.playerPos;
    this.camera.position.set(pos.x, pos.y + GAME.PLAYER_EYE_HEIGHT + bobY, pos.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;

    const spec = WEAPONS[this.currentWeapon];
    const targetFov = this.aiming ? spec.fov : 75;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 12));
    this.camera.updateProjectionMatrix();

    const aimX = this.aiming ? 0.0 : 0.30;
    const aimY = this.aiming ? -0.235 : -0.31;
    this.weaponRig.position.x = THREE.MathUtils.lerp(this.weaponRig.position.x, aimX + Math.sin(this.bob * 0.5) * 0.006, dt * 12);
    this.weaponRig.position.y = THREE.MathUtils.lerp(this.weaponRig.position.y, aimY - Math.abs(Math.sin(this.bob)) * 0.008, dt * 12);
    this.weaponRig.position.z = -0.67 + this.weaponKick * 0.075;
    this.weaponRig.rotation.x = -this.weaponKick * 0.055;
    $("scope").classList.toggle("active", this.aiming && this.currentWeapon === "sniper" && this.mode === "playing");
    this.weaponRig.visible = !(this.aiming && this.currentWeapon === "sniper") && (this.mode === "playing" || this.mode === "paused");
  }

  private render(): void {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.mode !== "title") this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.fpsTime += dt;
    this.fpsFrames++;
    if (this.fpsTime >= 0.75) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsTime = 0;
      this.fpsFrames = 0;
    }
    if (this.fps < QUALITY.DEGRADE_FPS && this.mode === "playing") this.lowFpsTime += dt;
    else this.lowFpsTime = 0;
    if (this.lowFpsTime > 2 && this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.resize();
      this.lowFpsTime = 0;
    }
    if (!window.__GAME_READY__) window.__GAME_READY__ = true;
  }

  private updateUI(): void {
    $("health").textContent = String(Math.ceil(this.health));
    $("armor").textContent = String(Math.ceil(this.armor));
    $("credits").textContent = `$${this.credits.toLocaleString("en-US")}`;
    const scores = this.roundManager.scores;
    $("player-rounds").textContent = String(scores.attackers);
    $("enemy-rounds").textContent = String(scores.defenders);
    $("round-label").textContent = `الجولة ${this.roundManager.roundNumber} / ${GAME.MAX_ROUNDS}`;
    const seconds = Math.max(0, Math.ceil(this.roundManager.roundTimeLeft));
    $("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    $("timer").style.color = seconds <= 15 ? "#ff8454" : "";
    const alive = this.botManager.getAliveCount();
    $("enemies-left").textContent = `${alive} ${alive === 1 ? "خصم" : "خصوم"}`;
    const w = WEAPONS[this.currentWeapon];
    const ammo = this.weaponSystem.getCurrentAmmo();
    $("weapon-name").textContent = w.name;
    $("ammo").textContent = String(ammo.magazine);
    $("reserve").textContent = String(ammo.reserve);
    $("reload-label").textContent = this.reloadTimer > 0 ? "جارٍ التلقيم…" : ammo.magazine === 0 ? "R للتلقيم" : "";
    const gap = 7 + this.weaponKick * 9 + this.playerSpeed * 0.8;
    $("crosshair").style.setProperty("--gap", `${gap.toFixed(1)}px`);
    if (this.mode === "buy") this.updateBuyUI();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    if (this.botManager) this.botManager.dispose();
    disposePhysics();
    for (const off of this.listeners) off();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
          mat.dispose();
        }
      }
    });
    this.renderer.dispose();
    delete window.__gameProbe;
    delete window.__gameDebug;
    delete window.__gameTest;
  }
}

export async function startGame(canvas: HTMLCanvasElement, multiplayer?: { serverUrl: string; playerName: string; room?: string }): Promise<void> {
  stopGame();
  window.__GAME_READY__ = false;
  window.__ASSETS_READY__ = false;
  activeGame = new Game(canvas, multiplayer);
  await initPhysics({ x: 0, y: -GAME.GRAVITY, z: 0 });
  await createPlayerCapsuleAsync({ x: 0, y: GAME.PLAYER_HEIGHT, z: 13.5 }, GAME.PLAYER_RADIUS, GAME.PLAYER_HEIGHT);
}
export function stopGame(): void { activeGame?.dispose(); activeGame = null; }
