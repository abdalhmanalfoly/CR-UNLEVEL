/**
 * collision.ts — Physics and collision.
 * Uses @dimforge/rapier3d-compat for the player capsule and ground detection.
 * Falls back to Three.js AABB collision for world geometry (from World).
 */

import * as RAPIER from "@dimforge/rapier3d-compat";

let world: RAPIER.World | null = null;
let playerBody: RAPIER.RigidBody | null = null;
let playerCollider: RAPIER.Collider | null = null;

export async function initPhysics(gravity = { x: 0, y: -26, z: 0 }): Promise<void> {
  if (world) return;
  await (RAPIER as { init: (opts?: { module_or_path: string }) => Promise<void> }).init({ module_or_path: "/rapier_wasm3d_bg.wasm" });
  world = new RAPIER.World({ x: gravity.x, y: gravity.y, z: gravity.z });
}

export async function createPlayerCapsuleAsync(
  position: { x: number; y: number; z: number },
  radius = 0.38,
  height = 1.68,
): Promise<void> {
  if (!world) return;
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.5)
    .setAngularDamping(1.0)
    .setCanSleep(false);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.capsule(radius, height)
    .setDensity(1.0)
    .setFriction(0.6)
    .setRestitution(0.0);
  const collider = world.createCollider(colliderDesc, body);
  playerBody = body;
  playerCollider = collider;
}

export function createPlayerCapsule(
  position: { x: number; y: number; z: number },
  radius = 0.38,
  height = 1.68,
): void {
  if (!world) return;
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.5)
    .setAngularDamping(1.0)
    .setCanSleep(false);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.capsule(radius, height)
    .setDensity(1.0)
    .setFriction(0.6)
    .setRestitution(0.0);
  const collider = world.createCollider(colliderDesc, body);
  playerBody = body;
  playerCollider = collider;
}

export function getPlayerPosition(): { x: number; y: number; z: number } | null {
  if (!playerBody) return null;
  const t = playerBody.translation();
  return { x: t.x, y: t.y, z: t.z };
}

export function setPlayerPosition(x: number, y: number, z: number): void {
  if (!playerBody) return;
  playerBody.setTranslation({ x, y, z }, true);
}

export function getPlayerVelocity(): { x: number; y: number; z: number } | null {
  if (!playerBody) return null;
  const v = playerBody.linvel();
  return { x: v.x, y: v.y, z: v.z };
}

export function setPlayerVelocity(x: number, y: number, z: number): void {
  if (!playerBody) return;
  playerBody.setLinvel({ x, y, z }, true);
}

export function applyPlayerImpulse(x: number, y: number, z: number): void {
  if (!playerBody) return;
  playerBody.applyImpulse({ x, y, z }, true);
}

export function isPlayerGrounded(): boolean {
  if (!playerCollider || !world) return false;
  const pos = playerCollider.translation();
  const ray = new RAPIER.Ray(new RAPIER.Vector3(pos.x, pos.y, pos.z), new RAPIER.Vector3(0, -1, 0));
  const hit = world.castRay(ray, 0.45, true);
  return hit !== null;
}

export function movePlayer(vx: number, vy: number, vz: number): void {
  if (!playerBody) return;
  const current = playerBody.linvel();
  playerBody.setLinvel({ x: vx, y: current.y, z: vz }, true);
}

export function jumpPlayer(force: number): void {
  if (!playerBody) return;
  if (!isPlayerGrounded()) return;
  const current = playerBody.linvel();
  playerBody.setLinvel({ x: current.x, y: force, z: current.z }, true);
}

export function addWallCollider(
  x: number, y: number, z: number,
  halfWidth: number, halfHeight: number, halfDepth: number,
): RAPIER.Collider | null {
  if (!world) return null;
  const desc = RAPIER.ColliderDesc.cuboid(halfWidth, halfHeight, halfDepth)
    .setTranslation(x, y, z)
    .setFriction(0.6)
    .setRestitution(0.0);
  return world.createCollider(desc);
}

export function addCapsuleCollider(
  x: number, y: number, z: number,
  radius: number, height: number,
): RAPIER.Collider | null {
  if (!world) return null;
  const desc = RAPIER.ColliderDesc.capsule(radius, height)
    .setTranslation(x, y, z)
    .setFriction(0.6)
    .setRestitution(0.0);
  return world.createCollider(desc);
}

export function raycast(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  maxDistance: number,
): { hit: boolean; distance: number; position: { x: number; y: number; z: number } } | null {
  if (!world) return null;
  const ray = new RAPIER.Ray(
    new RAPIER.Vector3(origin.x, origin.y, origin.z),
    new RAPIER.Vector3(direction.x, direction.y, direction.z),
  );
  const hit = world.castRay(ray, maxDistance, true);
  if (!hit) return null;
  const hitPoint = ray.pointAt(hit.timeOfImpact);
  return {
    hit: true,
    distance: hit.timeOfImpact,
    position: { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z },
  };
}

export function stepPhysics(dt: number): void {
  if (!world) return;
  world.timestep = dt;
  world.step(undefined as any);
}

export function disposePhysics(): void {
  world = null;
  playerBody = null;
  playerCollider = null;
}
