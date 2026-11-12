import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io, type Socket } from "socket.io-client";

let serverRef: any;
const port = 31338;

// A socket wrapper that never misses a server message: every "message"
// payload is queued on connect, and waitFor drains the queue first.
class TestClient {
  socket: Socket;
  queue: any[] = [];
  handlers: Array<(msg: any) => void> = [];
  connected = false;

  constructor(url: string) {
    this.socket = io(url, { transports: ["websocket", "polling"] });
    this.socket.on("connect", () => { this.connected = true; });
    this.socket.on("disconnect", () => { this.connected = false; });
    this.socket.on("message", (msg: any) => {
      this.queue.push(msg);
      for (const h of this.handlers) h(msg);
    });
  }

  waitFor(type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.handlers = this.handlers.filter((h) => h !== handler);
        reject(new Error(`timed out waiting for server event "${type}"`));
      }, 10000);
      const handler = (msg: any) => {
        if (msg && msg.type === type) {
          clearTimeout(timeout);
          this.handlers = this.handlers.filter((h) => h !== handler);
          const idx = this.queue.indexOf(msg);
          if (idx >= 0) this.queue.splice(idx, 1);
          resolve(msg);
          return;
        }
      };
      for (const msg of this.queue) {
        if (msg && msg.type === type) {
          clearTimeout(timeout);
          this.handlers = this.handlers.filter((h) => h !== handler);
          const idx = this.queue.indexOf(msg);
          if (idx >= 0) this.queue.splice(idx, 1);
          resolve(msg);
          return;
        }
      }
      this.handlers.push(handler);
    });
  }

  /** Resolves if NO message of `type` arrives within `ms`; rejects if one does. */
  expectNo(type: string, ms = 800): Promise<void> {
    return new Promise((resolve, reject) => {
      const before = this.queue.filter((m) => m && m.type === type).length;
      const timeout = setTimeout(() => {
        this.handlers = this.handlers.filter((h) => h !== handler);
        const after = this.queue.filter((m) => m && m.type === type).length;
        if (after === before) resolve();
        else reject(new Error(`unexpected "${type}" message arrived`));
      }, ms);
      const handler = (msg: any) => {
        if (msg && msg.type === type) {
          clearTimeout(timeout);
          this.handlers = this.handlers.filter((h) => h !== handler);
          reject(new Error(`unexpected "${type}" message arrived`));
        }
      };
      this.handlers.push(handler);
    });
  }

  waitForRoster(size: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.handlers = this.handlers.filter((h) => h !== handler);
        reject(new Error(`timed out waiting for roster of ${size}`));
      }, 10000);
      const handler = (msg: any) => {
        if (msg && msg.type === "player_list" && msg.players && msg.players.length === size) {
          clearTimeout(timeout);
          this.handlers = this.handlers.filter((h) => h !== handler);
          const idx = this.queue.indexOf(msg);
          if (idx >= 0) this.queue.splice(idx, 1);
          resolve(msg);
          return;
        }
      };
      for (const msg of this.queue) {
        if (msg && msg.type === "player_list" && msg.players && msg.players.length === size) {
          clearTimeout(timeout);
          this.handlers = this.handlers.filter((h) => h !== handler);
          const idx = this.queue.indexOf(msg);
          if (idx >= 0) this.queue.splice(idx, 1);
          resolve(msg);
          return;
        }
      }
      this.handlers.push(handler);
    });
  }

  emit(message: any): void {
    this.socket.emit("message", message);
  }

  disconnect(): void {
    try { this.socket.disconnect(); } catch {}
  }
}

function waitForConnect(client: TestClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for connect")), 8000);
    if (client.connected) { clearTimeout(timeout); resolve(); return; }
    client.socket.on("connect", () => { clearTimeout(timeout); resolve(); });
    client.socket.on("connect_error", (err: any) => { clearTimeout(timeout); reject(err); });
  });
}

describe("SANDLINE multiplayer combat, respawn and weapons", () => {
  let a: TestClient;
  let b: TestClient;
  let roomCode = "";

  async function startMatchInRoom(roomName: string, playerA: string, playerB: string): Promise<void> {
    // Leave any room left over from a previous test so we can create/join fresh.
    a.emit({ type: "leave_room" });
    b.emit({ type: "leave_room" });
    await new Promise((r) => setTimeout(r, 150));
    // Drop stale queued messages from the previous room so every waitFor below
    // observes the fresh room only.
    a.queue = [];
    b.queue = [];

    a.emit({ type: "create_room", roomName, playerName: playerA });
    const created = await a.waitFor("room_created");
    expect(created.roomCode).toBeTruthy();
    expect(created.playerId).toBe(a.socket.id);
    roomCode = created.roomCode;

    b.emit({ type: "join_room", roomCode, playerName: playerB });
    const joined = await b.waitFor("room_joined");
    expect(joined.roomCode).toBe(roomCode);
    expect(joined.playerId).toBe(b.socket.id);

    await a.waitForRoster(2);
    await b.waitForRoster(2);

    a.emit({ type: "set_ready", ready: true });
    b.emit({ type: "set_ready", ready: true });
    // Let both set_ready messages propagate to the server before starting.
    await new Promise((r) => setTimeout(r, 200));

    a.emit({ type: "start_match" });
    const started = await a.waitFor("match_start");
    expect(started.players.length).toBe(2);
    await b.waitFor("match_start");
  }

  beforeAll(async () => {
    process.env.PORT = String(port);
    serverRef = await import("../../../server/index.ts");
    await new Promise((r) => setTimeout(r, 250));
    a = new TestClient(`http://localhost:${port}`);
    b = new TestClient(`http://localhost:${port}`);
    await Promise.all([waitForConnect(a), waitForConnect(b)]);
  });

  afterAll(async () => {
    a.disconnect();
    b.disconnect();
    try { serverRef.io.close(); } catch {}
    try { serverRef.httpServer.close(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
  });

  it("weapon switching: invalid id is ignored, valid switches broadcast to both clients", async () => {
    await startMatchInRoom("Weapon Room", "Alpha", "Beta");

    // Invalid weapon id must produce no weapon_switched event.
    a.emit({ type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: "nonexistent", jump: false, timestamp: Date.now() });
    await a.expectNo("weapon_switched", 800);
    await b.expectNo("weapon_switched", 800);

    // Switch to rifle: both clients are notified.
    a.emit({ type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: "rifle", jump: false, timestamp: Date.now() });
    const rifleA = await a.waitFor("weapon_switched");
    const rifleB = await b.waitFor("weapon_switched");
    expect(rifleA.playerId).toBe(a.socket.id);
    expect(rifleA.weapon).toBe("rifle");
    expect(rifleB.playerId).toBe(a.socket.id);
    expect(rifleB.weapon).toBe("rifle");

    // Switch to sniper: both clients are notified.
    a.emit({ type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: "sniper", jump: false, timestamp: Date.now() });
    const sniperA = await a.waitFor("weapon_switched");
    const sniperB = await b.waitFor("weapon_switched");
    expect(sniperA.weapon).toBe("sniper");
    expect(sniperB.weapon).toBe("sniper");
  });

  it("combat: authoritative sniper hit kills the target, who then respawns; aiming away misses", async () => {
    await startMatchInRoom("Combat Room", "Alpha", "Beta");

    // Equip the sniper (one body shot deals 110 damage, enough to kill from full health).
    a.emit({ type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: "sniper", jump: false, timestamp: Date.now() });
    await a.waitFor("weapon_switched");
    await b.waitFor("weapon_switched");

    // Alpha aims at Beta (spawns: attackers [-17,-13], defenders [16,-12]) and fires.
    // Fire direction for yaw=-PI/2 is approx (+X, 0, 0), which points at Beta.
    a.emit({
      type: "player_input", moveX: 0, moveZ: 0, yaw: -Math.PI / 2, pitch: 0,
      fire: true, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now(),
    });

    const validatedA = await a.waitFor("shoot_validated");
    expect(validatedA.shooterId).toBe(a.socket.id);
    expect(validatedA.hit).toBe(true);
    expect(validatedA.targetId).toBe(b.socket.id);
    expect(typeof validatedA.damage).toBe("number");
    expect(validatedA.damage).toBeGreaterThanOrEqual(100);

    const validatedB = await b.waitFor("shoot_validated");
    expect(validatedB.hit).toBe(true);
    expect(validatedB.targetId).toBe(b.socket.id);

    // Both clients observe the death.
    const diedA = await a.waitFor("player_died");
    expect(diedA.victimId).toBe(b.socket.id);
    expect(diedA.killerId).toBe(a.socket.id);
    const diedB = await b.waitFor("player_died");
    expect(diedB.victimId).toBe(b.socket.id);

    // Score state updates on both clients.
    const scoreA = await a.waitFor("score_update");
    expect(scoreA.playerId).toBe(a.socket.id);
    expect(scoreA.kills).toBeGreaterThanOrEqual(1);
    await b.waitFor("score_update");

    // The victim respawns after RESPAWN_DELAY and both clients are notified.
    const respawnedA = await a.waitFor("player_respawned");
    expect(respawnedA.playerId).toBe(b.socket.id);
    const respawnedB = await b.waitFor("player_respawned");
    expect(respawnedB.playerId).toBe(b.socket.id);

    // Negative: aiming away from a live target produces a miss.
    a.emit({
      type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
      fire: true, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now(),
    });
    const missA = await a.waitFor("shoot_validated");
    expect(missA.hit).toBe(false);
    expect(missA.targetId).toBeNull();
    const missB = await b.waitFor("shoot_validated");
    expect(missB.hit).toBe(false);
  });
});
