import { test, expect } from "@playwright/test";

const SERVER = "http://localhost:31339";

function waitForWindow(page: any, expr: string, timeout = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out waiting for window condition: " + expr)), timeout);
    const iv = setInterval(async () => {
      try {
        const v = await page.evaluate(expr);
        if (v != null) { clearTimeout(t); clearInterval(iv); resolve(v); }
      } catch {}
    }, 100);
  });
}

async function getWindow(page: any, expr: string): Promise<any> {
  return page.evaluate(expr);
}

async function setOnWindow(page: any, expr: string): Promise<void> {
  await page.evaluate(expr);
}

test.beforeEach(async ({ page }) => {
  page.on("console", (msg) => console.log("[PAGE CONSOLE]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));
});

test("two browser clients connect to the same multiplayer room and start a match", async ({ page, browser }) => {
  // Client A creates a room (no room param -> onConnect creates one).
  await page.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Alpha`, { waitUntil: "domcontentloaded" });

  const roomCode = await waitForWindow(page, "(window as any).__roomCode");
  expect(typeof roomCode).toBe("string");
  expect(roomCode.length).toBeGreaterThan(0);
  const aPlayerId = await getWindow(page, "(window as any).__networkClient.myPlayerId");
  expect(typeof aPlayerId).toBe("string");
  await setOnWindow(page, "(window as any).__networkClient.onMatchStart = () => { (window as any).__matchStarted = true; };");

  // Client B joins the same room.
  const pageB = await browser.newContext().then((c) => c.newPage());
  await pageB.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Beta&room=${encodeURIComponent(roomCode)}`, {
    waitUntil: "domcontentloaded",
  });
  const bRoomCode = await waitForWindow(pageB, () => (window as any).__roomCode);
  expect(bRoomCode).toBe(roomCode);
  const bPlayerId = await getWindow(pageB, "(window as any).__networkClient.myPlayerId");
  expect(typeof bPlayerId).toBe("string");
  expect(bPlayerId).not.toBe(aPlayerId);
  await setOnWindow(pageB, "(window as any).__networkClient.onMatchStart = () => { (window as any).__matchStarted = true; };");

  // Both clients are connected and in the same room.
  const aConnected = await getWindow(page, "(window as any).__networkClient.isConnected");
  const bConnected = await getWindow(pageB, "(window as any).__networkClient.isConnected");
  expect(aConnected).toBe(true);
  expect(bConnected).toBe(true);

  // Client A hosts and starts the match; both clients observe match_start.
  await setOnWindow(page, "(window as any).__networkClient.startMatch();");
  await waitForWindow(page, "(window as any).__matchStarted === true");
  await waitForWindow(pageB, "(window as any).__matchStarted === true");

  // Client A moves; client B receives the authoritative position update for A.
  await setOnWindow(pageB, `(window as any).__networkClient.onPlayerUpdated = (pid, updates) => { if (pid === "${aPlayerId}") (window as any).__remoteUpdated = updates; };`);
  await setOnWindow(page, `(window as any).__networkClient.sendPlayerInput({ moveX: 0, moveZ: 1, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now() });`);
  await waitForWindow(pageB, "(window as any).__remoteUpdated && (window as any).__remoteUpdated.position", 15000);
  const remotePos = await getWindow(pageB, "(window as any).__remoteUpdated.position");
  expect(remotePos).toBeTruthy();
  expect(Math.hypot(remotePos.x, remotePos.z)).toBeGreaterThan(0);

  await page.close();
  await pageB.close();
});

test("clients in different rooms are isolated", async ({ browser }) => {
  const pageA = await browser.newContext().then((c) => c.newPage());
  await pageA.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Gamma`, { waitUntil: "domcontentloaded" });
  const roomA = await waitForWindow(pageA, "(window as any).__roomCode");

  const pageB = await browser.newContext().then((c) => c.newPage());
  await pageB.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Delta&room=${encodeURIComponent(roomA)}`, {
    waitUntil: "domcontentloaded",
  });
  const roomB = await waitForWindow(pageB, "(window as any).__roomCode");
  expect(roomB).toBe(roomA);

  // A third client in a different room must have a different room code.
  const pageC = await browser.newContext().then((c) => c.newPage());
  await pageC.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Epsilon&room=OTHER_ROOM`, {
    waitUntil: "domcontentloaded",
  });
  const roomC = await waitForWindow(pageC, () => (window as any).__roomCode);
  expect(roomC).toBe("OTHER_ROOM");
  expect(roomC).not.toBe(roomA);

  await pageA.close();
  await pageB.close();
  await pageC.close();
});
