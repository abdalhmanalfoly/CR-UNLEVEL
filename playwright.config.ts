import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /\.e2e\.ts$/,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: "bash -c 'PORT=31339 npx tsx server/index.ts'",
      port: 31339,
      timeout: 180000,
      reuseExistingServer: true,
    },
    {
      command: "npx vite preview --port 3000",
      port: 3000,
      timeout: 180000,
      reuseExistingServer: true,
    },
  ],
});
