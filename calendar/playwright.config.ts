import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    // Point at an already-installed Chromium instead of Playwright's own
    // download (e.g. a sandbox with browsers preinstalled elsewhere).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  // "setup" signs in once (tests/e2e/auth.setup.ts); everything else
  // reuses that session cookie.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "app",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: { storageState: "tests/e2e/.auth/user.json" },
    },
  ],
  // Assumes `E2E_TEST_ROUTES=1 npm run dev` is already running against the dev DB — this
  // project has no throwaway test DB, so tests must create/clean up their
  // own rows (by a distinctive title prefix) rather than wiping tables,
  // since real user data (synced Google events) lives there too.
});
