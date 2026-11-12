import { defineConfig } from "@playwright/test";

// Game-night simulation: several users on their own phones against a LOCAL
// Supabase (`supabase start`). Never point this at production.
// Run: npm run test:sim (see e2e-sim/README.md)
const PORT = 3200;

export default defineConfig({
  testDir: "e2e-sim",
  testMatch: /.*\.sim\.ts$/,
  timeout: 6 * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-sim" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    actionTimeout: 15_000,
    locale: "he-IL",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
