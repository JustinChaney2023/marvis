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
  },
  // Assumes `npm run dev` is already running against the dev DB — this
  // project has no throwaway test DB, so tests must create/clean up their
  // own rows (by a distinctive title prefix) rather than wiping tables,
  // since real user data (synced Google events) lives there too.
});
