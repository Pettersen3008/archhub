import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Audit, DependencyPackage, DependencyReport } from "../src/lib/ipc/bindings";

const pkg = (name: string, repository = "core"): DependencyPackage => ({
  name,
  version: "1-1",
  repository,
  explicit: false,
  signature: "unknown",
});
function graph(): DependencyReport {
  return {
    root: pkg("pacman"),
    capturedAt: 1791220000,
    fingerprint: "dependency-fixture",
    direct: [
      { spec: "virtual>=2", description: null, providers: [pkg("node-000"), pkg("node-001")] },
      { spec: "missing-required>=3", description: null, providers: [] },
    ],
    optional: [
      { spec: "optional-missing", description: "Enables an optional feature", providers: [] },
      { spec: "optional-provider", description: "Extra integration", providers: [pkg("node-001")] },
    ],
    requires: Array.from({ length: 205 }, (_, i) => ({
      package: pkg(`node-${String(i).padStart(3, "0")}`, i === 4 ? "local" : "core"),
      path:
        i < 3
          ? ["pacman", `node-${String(i).padStart(3, "0")}`]
          : ["pacman", "node-000", `node-${String(i).padStart(3, "0")}`],
      requirements: i < 3 ? ["virtual>=2"] : ["virtual>=2", `node-${String(i).padStart(3, "0")}`],
      alternativeProviders: i !== 2,
    })),
    requiredBy: [
      {
        package: pkg("fixture-consumer"),
        path: ["pacman", "fixture-consumer"],
        requirements: ["libalpm.so=16-64"],
        alternativeProviders: false,
      },
    ],
    unresolved: [{ package: "pacman", requirement: "missing-required>=3" }],
    requiresComplete: false,
    requiredByComplete: true,
    limitations: [
      "All matching installed providers are included. One representative path per package.",
      "Dependency metadata does not establish runtime reachability or removal safety.",
    ],
  };
}
function advisory(g = graph()): Audit {
  return {
    scannedAt: 1791220001,
    source: "Arch Security Tracker",
    sourceUrl: "https://security.archlinux.org/all.json",
    checkedPackages: 1000,
    uncoveredPackages: 4,
    fingerprint: g.fingerprint,
    findings: [
      {
        id: "ASA-fixture:node-000",
        package: "node-000",
        severity: "high",
        title: "Fixture advisory in node-000",
        description: "Version range requires review",
        installedVersion: "1-1",
        fixedVersion: "2-1",
        cves: ["CVE-fixture"],
        url: null,
        confidence: "version-match",
        line: null,
        file: null,
      },
    ],
    limitations: ["Feed publication freshness and complete affected ranges are unknown."],
  };
}
async function fixtures(page: Page, g = graph(), a = advisory(g)) {
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "dependencies") await route.fulfill({ json: g });
    else if (body.command === "audit") await route.fulfill({ json: a });
    else await route.continue();
  });
}
async function inspect(page: Page) {
  await page.goto("/#/dependencies");
  await page.getByRole("button", { name: "Inspect dependencies", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installed paths · pacman" })).toBeVisible();
}
async function exported(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export dependency evidence" }).click();
  const file = await waiting;
  expect(file.suggestedFilename()).toBe("archhub-dependencies-pacman.json");
  return JSON.parse(await readFile((await file.path())!, "utf8")) as {
    graph: DependencyReport;
    advisories: { state: string; reason: string | null; findings: Audit["findings"] };
  };
}

test("real installed paths link from package details and retain all evidence in exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/installed?q=pacman");
  await page.getByRole("button", { name: "View pacman", exact: true }).click();
  await expect(page.getByText(/Declared for available version/)).toBeVisible();
  await page.getByRole("button", { name: "Inspect installed dependency paths" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText("Make the relationships visible.")).toBeVisible();
  await page.getByRole("button", { name: "Inspect dependencies", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installed paths · pacman" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trace openssl", exact: true })).toBeVisible();
  const evidence = await exported(page);
  expect(evidence.graph.root.name).toBe("pacman");
  expect(evidence.graph.requires.length).toBeGreaterThan(0);
  expect(evidence.graph.requires.map((p) => p.package.name)).toContain("openssl");
  expect(evidence.graph.direct.some((r) => r.spec.startsWith("libcrypto.so="))).toBe(true);
  expect(evidence.graph.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await page.screenshot({ path: "artifacts/dependencies-live.png", fullPage: true });
  await page.getByRole("button", { name: "Trace openssl", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search installed packages" })).toHaveValue(
    "openssl",
  );
  await page.getByRole("button", { name: "Inspect dependencies", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installed paths · openssl" })).toBeVisible();
  await page.getByRole("tab", { name: "Required by", exact: true }).click();
  await expect(page.getByRole("button", { name: "Trace pacman", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("paths remain searchable and paged, with alternatives, gaps and distinct optional declarations", async ({
  page,
}) => {
  await fixtures(page);
  await inspect(page);
  await expect(page.getByText("Matching package snapshot", { exact: true })).toBeVisible();
  await expect(page.getByText("1–50 of 205 paths")).toBeVisible();
  await page.getByRole("button", { name: "Next dependency page" }).click();
  await expect(page.getByText("51–100 of 205 paths")).toBeVisible();
  await page.getByRole("button", { name: "Direct only", exact: true }).click();
  await expect(page.getByRole("button", { name: "Trace node-002", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trace node-003", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "All captured paths", exact: true }).click();
  await page.getByRole("textbox", { name: "Search dependency paths" }).fill("node-204");
  await expect(page.getByRole("button", { name: "Trace node-204", exact: true })).toBeVisible();
  expect((await exported(page)).graph.requires).toHaveLength(205);
  await page.getByRole("tab", { name: "Optional", exact: true }).click();
  await expect(page.getByText("Not installed", { exact: true })).toBeVisible();
  await page.getByText("Direct runtime declarations · 2", { exact: true }).click();
  await expect(page.getByText("No matching installed provider", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Required by", exact: true }).click();
  await expect(page.getByText("libalpm.so=16-64", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trace fixture-consumer", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search installed packages" })).toHaveValue(
    "fixture-consumer",
  );
});

test("stale advisories remain unknown and failed refresh invalidates previously matching evidence", async ({
  page,
}) => {
  let refreshes = 0;
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "dependencies") await route.fulfill({ json: graph() });
    else if (body.command === "audit") {
      if (!body.refresh)
        await route.fulfill({ json: { ...advisory(), fingerprint: "older-snapshot" } });
      else if (++refreshes === 2)
        await route.fulfill({ status: 503, json: { error: "Advisory fixture unavailable" } });
      else await route.fulfill({ json: advisory() });
    } else await route.continue();
  });
  await inspect(page);
  await expect(page.getByText("Advisory state unknown", { exact: true })).toBeVisible();
  expect((await exported(page)).advisories.state).toBe("unknown");
  await page.getByRole("button", { name: "Refresh advisories", exact: true }).click();
  await expect(page.getByText("Matching package snapshot", { exact: true })).toBeVisible();
  expect((await exported(page)).advisories.findings).toHaveLength(1);
  await page.getByRole("button", { name: "Refresh advisories", exact: true }).click();
  await expect(page.getByText("Advisory state unknown", { exact: true })).toBeVisible();
  const failed = await exported(page);
  expect(failed.advisories.state).toBe("unknown");
  expect(failed.advisories.findings).toHaveLength(0);
  expect(failed.advisories.reason).toContain("unavailable");
  await expect(page.getByRole("heading", { name: "Installed paths · pacman" })).toBeVisible();
});

test("a mismatched installed advisory version cannot be correlated even with a matching fingerprint", async ({
  page,
}) => {
  const a = advisory();
  a.findings[0]!.installedVersion = "older-version";
  await fixtures(page, graph(), a);
  await inspect(page);
  await expect(page.getByText("Advisory state unknown", { exact: true })).toBeVisible();
  const evidence = await exported(page);
  expect(evidence.advisories.state).toBe("unknown");
  expect(evidence.advisories.findings).toHaveLength(0);
});

test("failed dependency reads clear previous evidence and retry explicitly", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "dependencies") {
      if (++reads === 2)
        await route.fulfill({
          status: 400,
          json: { error: "Refresh inventory before inspecting this changed package version" },
        });
      else await route.fulfill({ json: graph() });
    } else if (body.command === "audit") await route.fulfill({ json: advisory() });
    else await route.continue();
  });
  await inspect(page);
  await page.getByRole("button", { name: "Inspect dependencies", exact: true }).click();
  await expect(page.getByText("We couldn’t complete this check")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export dependency evidence" })).toBeDisabled();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installed paths · pacman" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(page.getByText("Make the relationships visible.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect dependencies", exact: true }),
  ).toBeEnabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} dependency paths and optional views are accessible on desktop and mobile`, async ({
    page,
  }) => {
    await page.addInitScript(
      (theme) =>
        localStorage.setItem("archhub.preferences", JSON.stringify({ theme, compact: false })),
      theme,
    );
    await fixtures(page);
    await inspect(page);
    await expect(page.getByText("Matching package snapshot", { exact: true })).toBeVisible();
    for (const view of ["Requires", "Required by", "Optional"]) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
    }
    await page.getByRole("tab", { name: "Requires", exact: true }).click();
    await page.screenshot({ path: `artifacts/dependencies-${theme}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: `artifacts/dependencies-${theme}-mobile.png`, fullPage: true });
  });
}

test("dependency API rejects stale, uninstalled and injected identities", async ({ request }) => {
  for (const data of [
    { command: "dependencies", name: "pacman", version: "stale-1" },
    { command: "dependencies", name: "../etc/passwd", version: "1" },
    { command: "dependencies", name: "--help", version: "1" },
    { command: "dependencies", name: "pacman;id", version: "1" },
    { command: "dependencies", name: "not-an-archhub-installed-package", version: "1" },
  ])
    expect((await request.post("/api/query", { data })).status()).toBe(400);
});
