import { test, expect, type Page } from "@playwright/test";
import type { Package, Snapshot } from "../src/lib/ipc/bindings";

const pkg: Package = {
  id: "core/fixture",
  name: "fixture",
  version: "2-1",
  description: "Inventory before update",
  repository: "core",
  installedVersion: "1-1",
  updateAvailable: true,
  installedSize: 1024,
  downloadSize: 512,
  url: null,
  licenses: ["GPL-3.0-only"],
  dependencies: [],
  groups: [],
  architecture: "x86_64",
  explicit: true,
  signature: "SIGNATURE",
  packageBase: null,
  maintainer: null,
  votes: null,
  outOfDate: false,
  lastModified: null,
};
function snapshot(revision: number): Snapshot {
  return {
    capturedAt: Date.now() / 1000,
    fingerprint: `inventory-${revision}`,
    hostname: "fixture",
    installedCount: 1,
    explicitCount: 1,
    foreignCount: 0,
    updateCount: 1,
    installedSize: 1024,
    repositories: [],
    warnings: [],
    locked: false,
    omarchy: false,
    signaturePolicy: [],
  };
}
async function inventory(page: Page) {
  let revision = 1;
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    const current =
      revision === 1
        ? pkg
        : { ...pkg, installedVersion: "2-1", description: "Inventory after update" };
    if (body.command === "snapshot") await route.fulfill({ json: snapshot(revision) });
    else if (body.command === "packages")
      await route.fulfill({
        json: { items: [current], total: 1, offset: 0, limit: 100, capturedAt: Date.now() / 1000 },
      });
    else if (body.command === "package") await route.fulfill({ json: current });
    else if (body.command === "packages_by_ids")
      await route.fulfill({
        json: {
          items: body.ids.includes(pkg.id) ? [current] : [],
          missingIds: body.ids.filter((id: string) => id !== pkg.id),
          fingerprint: snapshot(revision).fingerprint,
          capturedAt: Date.now() / 1000,
        },
      });
    else await route.continue();
  });
  return () => {
    revision = 2;
  };
}

test("polled inventory changes refresh visible rows and retire an open detail", async ({
  page,
}) => {
  await page.clock.install();
  const change = await inventory(page);
  await page.goto("/#/installed");
  await expect(page.getByText("Inventory before update", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View fixture", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  change();
  await page.clock.runFor(60_001);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Inventory after update", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View fixture", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("2-1", { exact: true })).toHaveCount(3);
});

test("saved packages refresh with inventory without losing bookmarks", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() =>
    localStorage.setItem("archhub.saved", JSON.stringify(["core/fixture"])),
  );
  const change = await inventory(page);
  await page.goto("/#/saved");
  await expect(page.getByText("Inventory before update", { exact: true })).toBeVisible();
  change();
  await page.clock.runFor(60_001);
  await expect(page.getByText("Inventory after update", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("archhub.saved")!))).toEqual([
    pkg.id,
  ]);
});

test("saved service failures show retry and preserve bookmarks", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("archhub.saved", JSON.stringify(["core/fixture"])),
  );
  await inventory(page);
  let failed = true;
  await page.route("**/api/query", async (route) => {
    if (["package", "packages_by_ids"].includes(route.request().postDataJSON().command) && failed) {
      await route.fulfill({ status: 503, json: { error: "Saved inventory unavailable" } });
    } else await route.fallback();
  });
  await page.goto("/#/saved");
  await expect(page.getByRole("alert").getByText("Saved inventory unavailable")).toBeVisible();
  await expect(page.getByText("Your collection starts here")).not.toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "View fixture", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("archhub.saved")!))).toEqual([
    pkg.id,
  ]);
});

test("missing saved identities stay distinct from a service failure", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("archhub.saved", JSON.stringify(["old/fixture"])),
  );
  await inventory(page);
  await page.goto("/#/saved");
  await expect(
    page.getByText("1 saved package is unavailable in the current inventory."),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("archhub.saved")!))).toEqual([
    "old/fixture",
  ]);
  await page.getByRole("button", { name: "Remove unavailable bookmarks", exact: true }).click();
  await expect(page.getByText("Your collection starts here")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("archhub.saved")!))).toEqual([]);
});

test("large saved collections load with bounded concurrency", async ({ page }) => {
  const ids = Array.from({ length: 1000 }, (_, index) => `core/missing-${index}`);
  await page.addInitScript(
    (value) => localStorage.setItem("archhub.saved", JSON.stringify(value)),
    ids,
  );
  await inventory(page);
  let active = 0;
  let peak = 0;
  const batches: number[] = [];
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command !== "packages_by_ids") return route.fallback();
    batches.push(body.ids.length);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await route.fulfill({
      json: {
        items: [],
        missingIds: body.ids,
        fingerprint: "inventory-1",
        capturedAt: Date.now() / 1000,
      },
    });
    active--;
  });
  await page.goto("/#/saved");
  await expect(
    page.getByText("1000 saved packages are unavailable in the current inventory."),
  ).toBeVisible();
  expect(batches).toHaveLength(32);
  expect(Math.max(...batches)).toBeLessThanOrEqual(32);
  expect(peak).toBeLessThanOrEqual(2);
});

test("saved batches from different inventories require retry", async ({ page }) => {
  const ids = Array.from({ length: 33 }, (_, index) => `core/missing-${index}`);
  await page.addInitScript(
    (value) => localStorage.setItem("archhub.saved", JSON.stringify(value)),
    ids,
  );
  await inventory(page);
  let count = 0;
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command !== "packages_by_ids") return route.fallback();
    await route.fulfill({
      json: {
        items: [],
        missingIds: body.ids,
        fingerprint: `inventory-${++count}`,
        capturedAt: Date.now() / 1000,
      },
    });
  });
  await page.goto("/#/saved");
  await expect(
    page.getByRole("alert").getByText("Inventory changed while loading saved packages. Try again."),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("archhub.saved")!).length)).toBe(
    33,
  );
});
