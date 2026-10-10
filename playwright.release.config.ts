import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

// Deterministic local checks: no live AUR or advisory feed dependency.
export default defineConfig(config, {
  testMatch: ["inventory-state.spec.ts", "security-api.spec.ts"],
});
