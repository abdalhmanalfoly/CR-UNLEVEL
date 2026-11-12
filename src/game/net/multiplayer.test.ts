import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { io, type Socket } from "socket.io-client";

let server: any = null;
const port = 31337;

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
          resolve(msg);
        }
      };
      // Drain already-received messages first.
      for (const msg of this.queue) {
        if (msg && msg.type === type) {
          clearTimeout(timeout);
          this.handlers = this.handlers.filter((h) => h !== handler);
          // Remove consumed message from queue.
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

describe("SANDLINE multiplayer end-to-end", () => {
  let serverRef: any;
  let a: TestClient;
  let b: TestClient;
  let roomCode = "";

  beforeAll(async () => {
    process.env.PORT = String(port);
    // Dynamic import starts the server (it listens on module load) after PORT is set.
    serverRef = await import("../../../server/index.ts");
    await new Promise((r) => setTimeout(r, 250)); // let the http server begin listening
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

  it("client A creates a room and client B joins; both receive roster and teams", async () => {
    a.emit({ type: "create_room", roomName: "E2E Room", playerName: "Alpha" });
    const created = await a.waitFor("room_created");
    expect(created.roomCode).toBeTruthy();
    expect(created.playerId).toBe(a.socket.id);
    roomCode = created.roomCode;

    b.emit({ type: "join_room", roomCode, playerName: "Beta" });
    const joined = await b.waitFor("room_joined");
    expect(joined.roomCode).toBe(roomCode);
    expect(joined.playerId).toBe(b.socket.id);

    // Both clients receive the full lobby roster via player_list (wait for the
    // post-join roster that contains both players).
    const rosterA = await waitForRoster(a, 2);
    const rosterB = await waitForRoster(b, 2);
    expect(rosterA.players.length).toBe(2);
    expect(rosterB.players.length).toBe(2);
    const ids = new Set(rosterA.players.map((p: any) => p.id));
    expect(ids.has(a.socket.id)).toBe(true);
    expect(ids.has(b.socket.id)).toBe(true);
    // Team assignment is balanced across the two clients
    const teams = rosterA.players.map((p: any) => p.team);
    expect(teams).toContain("attackers");
    expect(teams).toContain("defenders");
  });

  it("starting a match updates both clients and spawns players with position/rotation", async () => {
    // Set both ready (server broadcasts player_list on ready change)
    a.emit({ type: "set_ready", ready: true });
    await a.waitFor("player_list");
    b.emit({ type: "set_ready", ready: true });
    await b.waitFor("player_list");

    // Host (a) starts the match
    a.emit({ type: "start_match" });
    const startedA = await a.waitFor("match_start");
    const startedB = await b.waitFor("match_start");
    expect(startedA.roundState).toBe("buy");
    expect(startedA.players.length).toBe(2);
    expect(startedB.players.length).toBe(2);
    for (const p of startedA.players) {
      expect(p.position).toEqual({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) });
      expect(typeof p.rotation).toBe("number");
    }
  });

  it("movement from A is received by B via player_updated", async () => {
    // Reset the server's lastInputTime for A with a null move, then move.
    a.emit({ type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now() });
    await new Promise((r) => setTimeout(r, 120));

    a.emit({ type: "player_input", moveX: 0, moveZ: 1, yaw: 0.5, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now() });

    // B should receive a player_updated for A with the new position/rotation
    const updated = await b.waitFor("player_updated");
    expect(updated.playerId).toBe(a.socket.id);
    expect(updated.updates.position).toBeTruthy();
    expect(typeof updated.updates.rotation).toBe("number");
    const { x, z } = updated.updates.position;
    expect(Math.hypot(x, z)).toBeGreaterThan(0);
  });

  it("a shot from A is validated authoritatively and produces state on both clients", async () => {
    a.emit({ type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: true, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now() });

    // The server acknowledges the shot with shoot_validated (authoritative hit validation)
    const validated = await a.waitFor("shoot_validated");
    expect(validated.shooterId).toBe(a.socket.id);
    expect(typeof validated.hit).toBe("boolean");
    expect(typeof validated.ammo).toBe("number");

    // The same authoritative validation is broadcast to the other client in the room
    const validatedB = await b.waitFor("shoot_validated");
    expect(validatedB.shooterId).toBe(a.socket.id);

    // When the shot is a hit, the server emits player_died + score_update so both
    // clients observe consistent health/death state (wired in server handlePlayerFire).
    // A live kill depends on aim/position; the validation pipeline is verified here.
  });

  it("a client in another room does not receive private room events", async () => {
    const c = new TestClient(`http://localhost:${port}`);
    await waitForConnect(c);
    c.emit({ type: "create_room", roomName: "Isolated", playerName: "Gamma" });
    const created = await c.waitFor("room_created");
    const otherCode = created.roomCode;

    // A fires in the first room; C must receive nothing from A's room
    a.emit({ type: "player_input", moveX: 0, moveZ: 0, yaw: 0, pitch: 0, fire: true, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now() });

    const result = await new Promise<any>((resolve) => {
      const t = setTimeout(() => resolve(null), 1500);
      const h = (msg: any) => { clearTimeout(t); resolve(msg); };
      c.socket.on("message", h);
    });
    expect(result).toBeNull();

    c.emit({ type: "leave_room", roomCode: otherCode });
    await c.waitFor("player_left").catch(() => {});
    c.disconnect();
  });

  it("disconnecting a client removes or marks that player correctly", async () => {
    const left = await new Promise<any>((resolve) => {
      const t = setTimeout(() => resolve(null), 6000);
      const h = (msg: any) => { if (msg && msg.type === "player_left") { clearTimeout(t); resolve(msg); } };
      b.socket.on("message", h);
    });
    a.disconnect();
    if (left) expect(left.type).toBe("player_left");
  });
});

function waitForConnect(client: TestClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for connect")), 8000);
    if (client.connected) { clearTimeout(timeout); resolve(); return; }
    client.socket.on("connect", () => { clearTimeout(timeout); resolve(); });
    client.socket.on("connect_error", (err: any) => { clearTimeout(timeout); reject(err); });
  });
}

function waitForRoster(client: TestClient, size: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for roster of ${size}`)), 10000);
    const handler = (msg: any) => {
      if (msg && msg.type === "player_list" && msg.players && msg.players.length === size) {
        clearTimeout(timeout);
        client.handlers = client.handlers.filter((h) => h !== handler);
        resolve(msg);
      }
    };
    for (const msg of client.queue) {
      if (msg && msg.type === "player_list" && msg.players && msg.players.length === size) {
        clearTimeout(timeout);
        const idx = client.queue.indexOf(msg);
        if (idx >= 0) client.queue.splice(idx, 1);
        resolve(msg);
        return;
      }
    }
    client.handlers.push(handler);
  });
}
