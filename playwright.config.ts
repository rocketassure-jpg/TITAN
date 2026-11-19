import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  reporter: [["list"], ["json", { outputFile: "test-results/playwright-results.json" }]],
  use: {
    baseURL: "http://localhost:8081",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-1440",
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "tablet-768",
      use: {
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "mobile-375",
      use: {
        viewport: { width: 375, height: 667 },
      },
    },
  ],
});
