import * as THREE from "three";
import { COLORS, GAME, MAP_BLOCKS, mulberry32, type MapBlock } from "./config";

export interface Obstacle {
  minX: number; maxX: number; minZ: number; maxZ: number; h: number;
  mesh: THREE.Mesh;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const tmpColor = new THREE.Color();

export class World {
  readonly obstacles: Obstacle[] = [];
  readonly collisionMeshes: THREE.Mesh[] = [];
  readonly playerSpawn = new THREE.Vector3(0, GAME.PLAYER_HEIGHT, 13.5);
  readonly dust: THREE.Points;
  private readonly dustPositions: Float32Array;
  private readonly rng = mulberry32(90210);
  private readonly losDirection = new THREE.Vector3();

  constructor(readonly scene: THREE.Scene) {
    scene.background = new THREE.Color(COLORS.background);
    scene.fog = new THREE.FogExp2(0xb6b69f, 0.0135);

    const hemi = new THREE.HemisphereLight(0xd9f4ef, 0x6b492c, 2.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe4b5, 3.1);
    sun.position.set(-12, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -28; sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.00025;
    scene.add(sun);

    const sand = this.makeSandTexture();
    const floorMat = new THREE.MeshStandardMaterial({ map: sand, color: 0xd4bb87, roughness: 0.96 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 80), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const laneMat = new THREE.MeshStandardMaterial({ color: 0x9f895f, roughness: 1, transparent: true, opacity: 0.36 });
    for (const x of [-14, 0, 14]) {
      const lane = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 33), laneMat);
      lane.rotation.x = -Math.PI / 2; lane.position.set(x, 0.006, 0); scene.add(lane);
    }

    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.88 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x516362, roughness: 0.7, metalness: 0.15 });
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0xc8b384, roughness: 0.9 });
    for (const block of MAP_BLOCKS) this.addBlock(block, block.kind === "wall" ? wallMat : block.kind === "crate" ? crateMat : barrierMat);
    this.addArchitecture();
    this.addSiteMarker();

    const dustGeo = new THREE.BufferGeometry();
    this.dustPositions = new Float32Array(210 * 3);
    for (let i = 0; i < 210; i++) {
      this.dustPositions[i * 3] = (this.rng() - 0.5) * 54;
      this.dustPositions[i * 3 + 1] = 0.15 + this.rng() * 5;
      this.dustPositions[i * 3 + 2] = (this.rng() - 0.5) * 44;
    }
    dustGeo.setAttribute("position", new THREE.BufferAttribute(this.dustPositions, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffe1a3, size: 0.045, transparent: true, opacity: 0.48, depthWrite: false }));
    scene.add(this.dust);
  }

  private addBlock(b: MapBlock, material: THREE.Material): void {
    const mesh = new THREE.Mesh(boxGeo, material);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.blocker = true;
    this.scene.add(mesh);
    this.obstacles.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, h: b.h, mesh });
    this.collisionMeshes.push(mesh);

    if (b.kind === "crate") {
      const trim = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x243a3a, roughness: 0.55, metalness: 0.35 }));
      trim.position.set(b.x, b.h * 0.58, b.z);
      trim.scale.set(b.w * 1.015, 0.09, b.d * 1.018);
      trim.castShadow = true; this.scene.add(trim);
    }
  }

  private addArchitecture(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c4242, roughness: 0.52, metalness: 0.5 });
    const teal = new THREE.MeshStandardMaterial({ color: 0x173f3d, emissive: COLORS.teal, emissiveIntensity: 1.8 });
    for (const [x, z] of [[-21, -16], [21, -16], [-21, 16], [21, 16]] as const) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 8), metal);
      pole.position.set(x, 3, z); pole.castShadow = true; this.scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.3), teal);
      lamp.position.set(x, 5.7, z); this.scene.add(lamp);
    }
    const duneMat = new THREE.MeshStandardMaterial({ color: 0xb9955f, roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const dune = new THREE.Mesh(new THREE.ConeGeometry(9 + this.rng() * 7, 6 + this.rng() * 5, 7), duneMat);
      dune.position.set(Math.cos(a) * (42 + this.rng() * 12), -1.4, Math.sin(a) * (38 + this.rng() * 10));
      dune.rotation.y = this.rng() * Math.PI; this.scene.add(dune);
    }
    const grid = new THREE.GridHelper(44, 22, 0x8d744e, 0xb39a6c);
    grid.position.y = 0.012;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.12;
    this.scene.add(grid);
  }

  private addSiteMarker(): void {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.55, 48), new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 0.72, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(14, 0.025, -11); this.scene.add(ring);
    for (let i = 0; i < 4; i++) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 1.0), new THREE.MeshBasicMaterial({ color: COLORS.orange, side: THREE.DoubleSide }));
      stripe.rotation.x = -Math.PI / 2; stripe.rotation.z = i * Math.PI / 2;
      stripe.position.set(14 + Math.cos(i * Math.PI / 2) * 3.2, 0.028, -11 + Math.sin(i * Math.PI / 2) * 3.2);
      this.scene.add(stripe);
    }
  }

  private makeSandTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c7ac78"; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4200; i++) {
      const v = 125 + Math.floor(this.rng() * 80);
      tmpColor.setRGB(v / 255, (v * 0.88) / 255, (v * 0.64) / 255);
      ctx.fillStyle = `#${tmpColor.getHexString()}`;
      const s = this.rng() * 1.6 + 0.25;
      ctx.fillRect(this.rng() * 256, this.rng() * 256, s, s);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(18, 16);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  update(dt: number): void {
    for (let i = 0; i < 210; i++) {
      this.dustPositions[i * 3] += dt * (0.16 + (i % 7) * 0.025);
      if (this.dustPositions[i * 3] > 27) this.dustPositions[i * 3] = -27;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  /** Circle-vs-AABB collision with axis separation for smooth wall sliding. */
  moveCircle(pos: THREE.Vector3, dx: number, dz: number, radius: number): void {
    pos.x += dx;
    for (const o of this.obstacles) {
      if (pos.z + radius <= o.minZ || pos.z - radius >= o.maxZ) continue;
      if (pos.x + radius > o.minX && pos.x - radius < o.maxX) pos.x = dx > 0 ? o.minX - radius : o.maxX + radius;
    }
    pos.z += dz;
    for (const o of this.obstacles) {
      if (pos.x + radius <= o.minX || pos.x - radius >= o.maxX) continue;
      if (pos.z + radius > o.minZ && pos.z - radius < o.maxZ) pos.z = dz > 0 ? o.minZ - radius : o.maxZ + radius;
    }
    pos.x = THREE.MathUtils.clamp(pos.x, -GAME.MAP_X + radius, GAME.MAP_X - radius);
    pos.z = THREE.MathUtils.clamp(pos.z, -GAME.MAP_Z + radius, GAME.MAP_Z - radius);
  }

  lineOfSight(from: THREE.Vector3, to: THREE.Vector3, raycaster: THREE.Raycaster): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    this.losDirection.set(dx / dist, dy / dist, dz / dist);
    raycaster.set(from, this.losDirection);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(this.collisionMeshes, false);
    return hits.length === 0;
  }
}
