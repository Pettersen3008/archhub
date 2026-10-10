import { defineConfig } from "@playwright/test";

const browserName = process.env.PLAYWRIGHT_BROWSER ?? "chromium";
if (browserName !== "chromium" && browserName !== "firefox") {
  throw new Error("PLAYWRIGHT_BROWSER must be chromium or firefox.");
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName,
    baseURL: "http://127.0.0.1:1420",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1080 },
    launchOptions:
      browserName === "chromium"
        ? {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium",
            args: ["--no-sandbox"],
          }
        : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:1420/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
