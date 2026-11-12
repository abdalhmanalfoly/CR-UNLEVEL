# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multiplayer.e2e.ts >> two browser clients connect to the same multiplayer room and start a match
- Location: tests\multiplayer.e2e.ts:30:1

# Error details

```
Error: timed out waiting for window condition: (window as any).__roomCode
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - generic:
    - generic: ×
    - generic:
      - strong
    - generic [ref=e5]:
      - generic [ref=e6]:
        - generic [ref=e7]: عملية تكتيكية فردية
        - heading "SANDLINE" [level=1] [ref=e9]
        - heading "بروتوكول خط الرمل" [level=2] [ref=e10]
        - paragraph [ref=e11]: ادخل مجمعًا صحراويًا محصنًا. ثلاث جولات، موارد محدودة، وخصم لا يقف في مكانه.
        - generic [ref=e12]:
          - generic [ref=e13]: تصويب تكتيكي
          - generic [ref=e14]: اقتصاد جولات
          - generic [ref=e15]: 3 أنواع خصوم
        - button "ابدأ المهمة SPACE" [ref=e16] [cursor=pointer]:
          - generic [ref=e17]: ابدأ المهمة
          - generic [ref=e18]: SPACE
        - generic [ref=e19]: انقر داخل اللعبة لتثبيت الماوس • ESC للإيقاف
      - generic [ref=e21]:
        - text: الموقع 07
        - strong [ref=e22]: مجمع السيليكا
        - text: الصحراء الغربية
        - generic [ref=e24]:
          - generic [ref=e25]:
            - term [ref=e26]: المهمة
            - definition [ref=e27]: تصفية
          - generic [ref=e28]:
            - term [ref=e29]: الجولات
            - definition [ref=e30]: "3"
          - generic [ref=e31]:
            - term [ref=e32]: الحالة
            - definition [ref=e33]: جاهز
      - generic [ref=e34]: WASD للحركة الماوس للتصويب زر أيسر لإطلاق النار زر أيمن للمنظار
    - button "كتم الصوت" [ref=e35] [cursor=pointer]: "الصوت: يعمل"
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | 
  3   | const SERVER = "http://localhost:31339";
  4   | 
  5   | function waitForWindow(page: any, expr: string, timeout = 15000): Promise<any> {
  6   |   return new Promise((resolve, reject) => {
> 7   |     const t = setTimeout(() => reject(new Error("timed out waiting for window condition: " + expr)), timeout);
      |                                       ^ Error: timed out waiting for window condition: (window as any).__roomCode
  8   |     const iv = setInterval(async () => {
  9   |       try {
  10  |         const v = await page.evaluate(expr);
  11  |         if (v != null) { clearTimeout(t); clearInterval(iv); resolve(v); }
  12  |       } catch {}
  13  |     }, 100);
  14  |   });
  15  | }
  16  | 
  17  | async function getWindow(page: any, expr: string): Promise<any> {
  18  |   return page.evaluate(expr);
  19  | }
  20  | 
  21  | async function setOnWindow(page: any, expr: string): Promise<void> {
  22  |   await page.evaluate(expr);
  23  | }
  24  | 
  25  | test.beforeEach(async ({ page }) => {
  26  |   page.on("console", (msg) => console.log("[PAGE CONSOLE]", msg.type(), msg.text()));
  27  |   page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));
  28  | });
  29  | 
  30  | test("two browser clients connect to the same multiplayer room and start a match", async ({ page, browser }) => {
  31  |   // Client A creates a room (no room param -> onConnect creates one).
  32  |   await page.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Alpha`, { waitUntil: "domcontentloaded" });
  33  | 
  34  |   const roomCode = await waitForWindow(page, "(window as any).__roomCode");
  35  |   expect(typeof roomCode).toBe("string");
  36  |   expect(roomCode.length).toBeGreaterThan(0);
  37  |   const aPlayerId = await getWindow(page, "(window as any).__networkClient.myPlayerId");
  38  |   expect(typeof aPlayerId).toBe("string");
  39  |   await setOnWindow(page, "(window as any).__networkClient.onMatchStart = () => { (window as any).__matchStarted = true; };");
  40  | 
  41  |   // Client B joins the same room.
  42  |   const pageB = await browser.newContext().then((c) => c.newPage());
  43  |   await pageB.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Beta&room=${encodeURIComponent(roomCode)}`, {
  44  |     waitUntil: "domcontentloaded",
  45  |   });
  46  |   const bRoomCode = await waitForWindow(pageB, () => (window as any).__roomCode);
  47  |   expect(bRoomCode).toBe(roomCode);
  48  |   const bPlayerId = await getWindow(pageB, "(window as any).__networkClient.myPlayerId");
  49  |   expect(typeof bPlayerId).toBe("string");
  50  |   expect(bPlayerId).not.toBe(aPlayerId);
  51  |   await setOnWindow(pageB, "(window as any).__networkClient.onMatchStart = () => { (window as any).__matchStarted = true; };");
  52  | 
  53  |   // Both clients are connected and in the same room.
  54  |   const aConnected = await getWindow(page, "(window as any).__networkClient.isConnected");
  55  |   const bConnected = await getWindow(pageB, "(window as any).__networkClient.isConnected");
  56  |   expect(aConnected).toBe(true);
  57  |   expect(bConnected).toBe(true);
  58  | 
  59  |   // Client A hosts and starts the match; both clients observe match_start.
  60  |   await setOnWindow(page, "(window as any).__networkClient.startMatch();");
  61  |   await waitForWindow(page, "(window as any).__matchStarted === true");
  62  |   await waitForWindow(pageB, "(window as any).__matchStarted === true");
  63  | 
  64  |   // Client A moves; client B receives the authoritative position update for A.
  65  |   await setOnWindow(pageB, `(window as any).__networkClient.onPlayerUpdated = (pid, updates) => { if (pid === "${aPlayerId}") (window as any).__remoteUpdated = updates; };`);
  66  |   await setOnWindow(page, `(window as any).__networkClient.sendPlayerInput({ moveX: 0, moveZ: 1, yaw: 0, pitch: 0, fire: false, aim: false, reload: false, switchWeapon: undefined, jump: false, timestamp: Date.now() });`);
  67  |   await waitForWindow(pageB, "(window as any).__remoteUpdated && (window as any).__remoteUpdated.position", 15000);
  68  |   const remotePos = await getWindow(pageB, "(window as any).__remoteUpdated.position");
  69  |   expect(remotePos).toBeTruthy();
  70  |   expect(Math.hypot(remotePos.x, remotePos.z)).toBeGreaterThan(0);
  71  | 
  72  |   await page.close();
  73  |   await pageB.close();
  74  | });
  75  | 
  76  | test("clients in different rooms are isolated", async ({ browser }) => {
  77  |   const pageA = await browser.newContext().then((c) => c.newPage());
  78  |   await pageA.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Gamma`, { waitUntil: "domcontentloaded" });
  79  |   const roomA = await waitForWindow(pageA, "(window as any).__roomCode");
  80  | 
  81  |   const pageB = await browser.newContext().then((c) => c.newPage());
  82  |   await pageB.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Delta&room=${encodeURIComponent(roomA)}`, {
  83  |     waitUntil: "domcontentloaded",
  84  |   });
  85  |   const roomB = await waitForWindow(pageB, "(window as any).__roomCode");
  86  |   expect(roomB).toBe(roomA);
  87  | 
  88  |   // A third client in a different room must have a different room code.
  89  |   const pageC = await browser.newContext().then((c) => c.newPage());
  90  |   await pageC.goto(`http://localhost:3000/?mp=1&server=${SERVER}&name=Epsilon&room=OTHER_ROOM`, {
  91  |     waitUntil: "domcontentloaded",
  92  |   });
  93  |   const roomC = await waitForWindow(pageC, () => (window as any).__roomCode);
  94  |   expect(roomC).toBe("OTHER_ROOM");
  95  |   expect(roomC).not.toBe(roomA);
  96  | 
  97  |   await pageA.close();
  98  |   await pageB.close();
  99  |   await pageC.close();
  100 | });
  101 | 
```