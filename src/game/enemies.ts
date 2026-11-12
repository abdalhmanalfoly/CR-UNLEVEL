import * as THREE from "three";
import { ENEMY_SPAWNS, mulberry32 } from "./config";
import type { World } from "./world";

export type EnemyRole = "rusher" | "rifle" | "heavy";
export interface EnemyCallbacks {
  damagePlayer(amount: number): void;
  enemyShot(from: THREE.Vector3, to: THREE.Vector3, hit: boolean): void;
  killed(enemy: Enemy, headshot: boolean): void;
}

const ROLE = {
  rusher: { hp: 72, speed: 3.5, range: 4.5, cooldown: 0.85, damage: 8, color: 0xd9643d },
  rifle: { hp: 100, speed: 2.5, range: 10, cooldown: 1.15, damage: 11, color: 0xb94b3c },
  heavy: { hp: 165, speed: 1.75, range: 7.5, cooldown: 1.45, damage: 16, color: 0x713d3c },
} as const;

const headGeo = new THREE.SphereGeometry(0.23, 10, 8);
const bodyGeo = new THREE.CapsuleGeometry(0.31, 0.62, 4, 8);
const limbGeo = new THREE.CapsuleGeometry(0.085, 0.52, 3, 6);
const gunGeo = new THREE.BoxGeometry(0.11, 0.12, 0.72);
const armorGeo = new THREE.BoxGeometry(0.66, 0.55, 0.25);

let enemyId = 0;
export class Enemy {
  readonly id = ++enemyId;
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly head: THREE.Mesh;
  readonly leftLeg: THREE.Mesh;
  readonly rightLeg: THREE.Mesh;
  readonly lastSeen = new THREE.Vector3();
  role: EnemyRole = "rifle";
  hp = 0;
  maxHp = 0;
  alive = false;
  dying = 0;
  seesPlayer = false;
  cooldown = 0;
  think = 0;
  strafe = 1;
  phase = 0;
  flash = 0;
  private readonly rng = mulberry32(3000 + this.id * 97);
  private readonly bodyMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color: ROLE.rifle.color, roughness: 0.82 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x263333, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9b7559, roughness: 0.9 });
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat); this.body.position.y = 1.12;
    this.head = new THREE.Mesh(headGeo, skin); this.head.position.y = 1.82;
    const vest = new THREE.Mesh(armorGeo, dark); vest.position.set(0, 1.22, 0.12);
    this.leftLeg = new THREE.Mesh(limbGeo, dark); this.leftLeg.position.set(-0.16, 0.43, 0);
    this.rightLeg = new THREE.Mesh(limbGeo, dark); this.rightLeg.position.set(0.16, 0.43, 0);
    const gun = new THREE.Mesh(gunGeo, dark); gun.position.set(0.29, 1.28, 0.38);
    for (const mesh of [this.body, this.head, vest, this.leftLeg, this.rightLeg, gun]) {
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.enemy = this;
      mesh.userData.part = mesh === this.head ? "head" : "body";
      this.group.add(mesh);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  reset(role: EnemyRole, x: number, z: number, round: number): void {
    this.role = role;
    this.maxHp = ROLE[role].hp + (round - 1) * 8;
    this.hp = this.maxHp;
    this.alive = true; this.dying = 0; this.seesPlayer = false;
    this.cooldown = 1.2 + this.rng(); this.think = this.rng() * 0.2;
    this.strafe = this.rng() > 0.5 ? 1 : -1; this.phase = this.rng() * 6;
    this.group.position.set(x, 0, z); this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(role === "heavy" ? 1.1 : 1);
    this.group.visible = true;
    this.bodyMat.color.setHex(ROLE[role].color);
    this.bodyMat.emissive.setHex(0x000000);
  }

  damage(amount: number, headshot: boolean, cb: EnemyCallbacks): "dead" | "hit" | null {
    if (!this.alive) return null;
    this.hp -= amount; this.flash = 0.1;
    this.bodyMat.emissive.setHex(0xff5b36); this.bodyMat.emissiveIntensity = 0.9;
    if (this.hp <= 0) {
      this.alive = false; this.dying = 0.65;
      cb.killed(this, headshot);
      return "dead";
    }
    return "hit";
  }

  update(dt: number, player: THREE.Vector3, playerSpeed: number, world: World, raycaster: THREE.Raycaster, cb: EnemyCallbacks): void {
    if (!this.alive) {
      if (this.dying > 0) {
        this.dying -= dt;
        this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, 1.45, dt * 8);
        this.group.position.y -= dt * 0.25;
        if (this.dying <= 0) this.group.visible = false;
      }
      return;
    }
    if (this.flash > 0) {
      this.flash -= dt;
      if (this.flash <= 0) this.bodyMat.emissive.setHex(0x000000);
    }
    this.cooldown -= dt; this.think -= dt;
    const dx = player.x - this.group.position.x;
    const dz = player.z - this.group.position.z;
    const dist = Math.max(0.001, Math.hypot(dx, dz));
    if (this.think <= 0) {
      this.think = 0.18 + this.rng() * 0.12;
      const eyeY = this.group.position.y + 1.65;
      const origin = _eye.set(this.group.position.x, eyeY, this.group.position.z);
      this.seesPlayer = world.lineOfSight(origin, player, raycaster);
      if (this.seesPlayer) this.lastSeen.copy(player);
      else this.lastSeen.copy(player); // shared last-known position keeps the compact arena active
      if (this.rng() < 0.22) this.strafe *= -1;
    }
    const spec = ROLE[this.role];
    let move = 0;
    if (!this.seesPlayer || dist > spec.range) move = 1;
    else if (dist < spec.range * 0.55) move = -0.65;
    const strafeAmount = this.seesPlayer && dist < 18 ? this.strafe * 0.72 : 0;
    const nx = dx / dist, nz = dz / dist;
    const speed = spec.speed * (this.seesPlayer ? 1 : 0.82);
    const mx = (nx * move + -nz * strafeAmount) * speed * dt;
    const mz = (nz * move + nx * strafeAmount) * speed * dt;
    world.moveCircle(this.group.position, mx, mz, 0.36);
    this.group.rotation.y = Math.atan2(dx, dz);
    this.phase += dt * (Math.abs(move) + Math.abs(strafeAmount)) * speed * 4;
    this.leftLeg.rotation.x = Math.sin(this.phase) * 0.48;
    this.rightLeg.rotation.x = -Math.sin(this.phase) * 0.48;
    this.body.position.y = 1.12 + Math.abs(Math.sin(this.phase)) * 0.025;

    if (this.seesPlayer && this.cooldown <= 0 && dist < 25) {
      this.cooldown = spec.cooldown * (0.85 + this.rng() * 0.45);
      const accuracy = THREE.MathUtils.clamp(0.84 - dist * 0.018 - playerSpeed * 0.035, 0.25, 0.78);
      const hit = this.rng() < accuracy;
      _shotFrom.set(this.group.position.x, this.group.position.y + 1.36, this.group.position.z);
      _shotTo.copy(player);
      if (!hit) {
        _shotTo.x += (this.rng() - 0.5) * 3.5;
        _shotTo.y += (this.rng() - 0.5) * 2.0;
        _shotTo.z += (this.rng() - 0.5) * 3.5;
      }
      cb.enemyShot(_shotFrom, _shotTo, hit);
      if (hit) cb.damagePlayer(spec.damage);
    }
  }
}

const _eye = new THREE.Vector3();
const _shotFrom = new THREE.Vector3();
const _shotTo = new THREE.Vector3();

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  constructor(scene: THREE.Scene, count = ENEMY_SPAWNS.length) {
    for (let i = 0; i < count; i++) this.enemies.push(new Enemy(scene));
  }
  reset(round: number): void {
    const count = Math.min(2 + round * 2, this.enemies.length);
    for (let i = 0; i < this.enemies.length; i++) {
      if (i < count) {
        const role: EnemyRole = i === count - 1 && round >= 2 ? "heavy" : i % 3 === 1 ? "rusher" : "rifle";
        this.enemies[i].reset(role, ENEMY_SPAWNS[i][0], ENEMY_SPAWNS[i][1], round);
      } else {
        this.enemies[i].alive = false; this.enemies[i].dying = 0; this.enemies[i].group.visible = false;
      }
    }
  }
  update(dt: number, player: THREE.Vector3, playerSpeed: number, world: World, raycaster: THREE.Raycaster, cb: EnemyCallbacks): void {
    for (const enemy of this.enemies) if (enemy.alive || enemy.dying > 0) enemy.update(dt, player, playerSpeed, world, raycaster, cb);
  }
  aliveCount(): number { let n = 0; for (const e of this.enemies) if (e.alive) n++; return n; }
  targets(out: THREE.Object3D[]): THREE.Object3D[] {
    out.length = 0;
    for (const e of this.enemies) if (e.alive) out.push(e.group);
    return out;
  }
}
