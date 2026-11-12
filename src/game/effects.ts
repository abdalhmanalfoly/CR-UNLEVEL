import * as THREE from "three";
import { QUALITY, mulberry32 } from "./config";

const MAX_TRACERS = 32;
const MAX_PARTICLES = QUALITY.PARTICLES_HIGH;

export class Effects {
  private readonly tracerGeo = new THREE.BufferGeometry();
  private readonly tracerPos = new Float32Array(MAX_TRACERS * 6);
  private readonly tracerLife = new Float32Array(MAX_TRACERS);
  private tracerCursor = 0;
  private readonly particleGeo = new THREE.BufferGeometry();
  private readonly particlePos = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleVel = new Float32Array(MAX_PARTICLES * 3);
  private readonly particleLife = new Float32Array(MAX_PARTICLES);
  private particleCursor = 0;
  private readonly rng = mulberry32(7712);
  readonly muzzle: THREE.Mesh;
  readonly muzzleLight: THREE.PointLight;
  private muzzleLife = 0;

  constructor(private scene: THREE.Scene, camera: THREE.Camera) {
    this.tracerGeo.setAttribute("position", new THREE.BufferAttribute(this.tracerPos, 3));
    const lines = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffd584, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = false; scene.add(lines);
    this.particleGeo.setAttribute("position", new THREE.BufferAttribute(this.particlePos, 3));
    const particles = new THREE.Points(this.particleGeo, new THREE.PointsMaterial({ color: 0xffc06a, size: 0.075, transparent: true, opacity: 0.9, depthWrite: false }));
    particles.frustumCulled = false; scene.add(particles);
    for (let i = 0; i < MAX_PARTICLES; i++) this.particlePos[i * 3 + 1] = -100;
    this.muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(0.065, 0), new THREE.MeshBasicMaterial({ color: 0xffdf91 }));
    this.muzzle.position.set(0.27, -0.20, -1.05); this.muzzle.visible = false; camera.add(this.muzzle);
    this.muzzleLight = new THREE.PointLight(0xffa43a, 0, 4); this.muzzleLight.position.copy(this.muzzle.position); camera.add(this.muzzleLight);
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3, enemy = false): void {
    const i = this.tracerCursor++ % MAX_TRACERS;
    this.tracerPos[i * 6] = a.x; this.tracerPos[i * 6 + 1] = a.y; this.tracerPos[i * 6 + 2] = a.z;
    this.tracerPos[i * 6 + 3] = b.x; this.tracerPos[i * 6 + 4] = b.y; this.tracerPos[i * 6 + 5] = b.z;
    this.tracerLife[i] = enemy ? 0.16 : 0.085;
    this.tracerGeo.attributes.position.needsUpdate = true;
  }

  burst(p: THREE.Vector3, count = 9, force = 2.2): void {
    const capped = Math.min(count, QUALITY.PARTICLES_LOW);
    for (let n = 0; n < capped; n++) {
      const i = this.particleCursor++ % MAX_PARTICLES;
      this.particlePos[i * 3] = p.x; this.particlePos[i * 3 + 1] = p.y; this.particlePos[i * 3 + 2] = p.z;
      this.particleVel[i * 3] = (this.rng() - 0.5) * force;
      this.particleVel[i * 3 + 1] = this.rng() * force;
      this.particleVel[i * 3 + 2] = (this.rng() - 0.5) * force;
      this.particleLife[i] = 0.22 + this.rng() * 0.28;
    }
  }

  flash(): void { this.muzzleLife = 0.045; this.muzzle.visible = true; this.muzzleLight.intensity = 7; }

  update(dt: number): void {
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] -= dt;
      if (this.tracerLife[i] <= 0) {
        this.tracerPos[i * 6 + 1] = this.tracerPos[i * 6 + 4] = -100;
        this.tracerGeo.attributes.position.needsUpdate = true;
      }
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.particleLife[i] <= 0) continue;
      this.particleLife[i] -= dt;
      this.particleVel[i * 3 + 1] -= dt * 6;
      this.particlePos[i * 3] += this.particleVel[i * 3] * dt;
      this.particlePos[i * 3 + 1] += this.particleVel[i * 3 + 1] * dt;
      this.particlePos[i * 3 + 2] += this.particleVel[i * 3 + 2] * dt;
      if (this.particleLife[i] <= 0) this.particlePos[i * 3 + 1] = -100;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    if (this.muzzleLife > 0) {
      this.muzzleLife -= dt;
      this.muzzleLight.intensity = Math.max(0, this.muzzleLife * 150);
      this.muzzle.scale.setScalar(0.8 + this.rng() * 0.8);
      if (this.muzzleLife <= 0) this.muzzle.visible = false;
    }
  }
}
