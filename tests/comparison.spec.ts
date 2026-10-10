import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Audit, PackageComparison, Snapshot, UpdatePlan } from "../src/lib/ipc/bindings";

function comparison(): PackageComparison {
  return {
    name: "pacman",
    repository: "core",
    installedVersion: "9.0-1",
    candidateVersion: "1:1.0-1",
    versionRelation: "newer",
    installedArchitecture: "x86_64",
    candidateArchitecture: "x86_64",
    installedValidation: "SIGNATURE",
    filename: "pacman-1:1.0-1-x86_64.pkg.tar.zst",
    declaredSha256: "a".repeat(64),
    embeddedSignature: true,
    capturedAt: 1791220000,
    fingerprint: "candidate-fixture",
    complete: false,
    changes: [
      {
        kind: "Required dependencies",
        added: ["new-provider>=2"],
        removed: ["old-provider"],
        unchangedCount: 8,
        omittedCount: 0,
      },
      {
        kind: "Conflicts",
        added: ["old-implementation"],
        removed: [],
        unchangedCount: 0,
        omittedCount: 2,
      },
      { kind: "Optional dependencies", added: [], removed: [], unchangedCount: 1, omittedCount: 0 },
    ],
    limitations: [
      "The candidate archive is not downloaded or scanned. Declared hashes and signatures are not verification.",
    ],
  };
}
function snapshot(): Snapshot {
  return {
    capturedAt: 1791220000,
    fingerprint: "candidate-fixture",
    hostname: "fixture",
    installedCount: 1,
    explicitCount: 1,
    foreignCount: 0,
    updateCount: 1,
    installedSize: 0,
    repositories: [],
    warnings: [],
    locked: false,
    omarchy: true,
    signaturePolicy: [],
  };
}
function audit(): Audit {
  return {
    scannedAt: 1791220001,
    source: "Arch Security Tracker",
    sourceUrl: "https://security.archlinux.org/all.json",
    checkedPackages: 1,
    uncoveredPackages: 0,
    fingerprint: "candidate-fixture",
    limitations: ["Feed publication freshness unknown"],
    findings: [
      {
        id: "fixture:pacman",
        package: "pacman",
        severity: "high",
        title: "Fixture installed advisory",
        description: "Installed version match",
        installedVersion: "9.0-1",
        fixedVersion: "1:1.0-1",
        cves: [],
        url: null,
        confidence: "version-match",
        line: null,
        file: null,
      },
    ],
  };
}
async function fixtures(page: Page, report = comparison(), feed = audit()) {
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "snapshot") await route.fulfill({ json: snapshot() });
    else if (body.command === "comparison") await route.fulfill({ json: report });
    else if (body.command === "audit") await route.fulfill({ json: feed });
    else await route.continue();
  });
}
async function compare(page: Page) {
  await page.goto("/#/updates");
  await page.getByRole("tab", { name: "Compare package", exact: true }).click();
  await page.getByRole("button", { name: "Compare package", exact: true }).click();
  await expect(page.getByRole("heading", { name: "pacman · candidate review" })).toBeVisible();
}
async function exported(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison", exact: true }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("archhub-comparison-pacman.json");
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}

test("real candidate comparison exports local metadata and rejects stale or malformed input", async ({
  page,
  request,
}) => {
  await compare(page);
  await page.locator("summary").filter({ hasText: "Artifact metadata · unverified" }).click();
  await expect(page.getByText("Declared SHA-256 · bytes unverified")).toBeVisible();
  const output = await exported(page);
  expect(output.comparison.name).toBe("pacman");
  expect(output.comparison.changes.map((change: { kind: string }) => change.kind)).toContain(
    "Required dependencies",
  );
  expect(output.currentSnapshotMatches).toBe(true);
  expect(output.advisoryState).toBe("unknown");
  expect(output.audit).toBeNull();
  for (const body of [
    { command: "comparison", name: "pacman", fingerprint: "stale" },
    { command: "comparison", name: "../etc/passwd", fingerprint: output.comparison.fingerprint },
  ]) {
    expect((await request.post("/api/query", { data: body })).status()).toBe(400);
  }
});

test("candidate changes and partial coverage stay visible in matching advisory exports", async ({
  page,
}) => {
  await fixtures(page);
  await compare(page);
  await expect(page.getByText("new-provider>=2", { exact: true })).toBeVisible();
  await expect(page.getByText("old-provider", { exact: true })).toBeVisible();
  await expect(page.getByText("2 declarations omitted from this category")).toBeVisible();
  await page.locator("summary").filter({ hasText: "Artifact metadata · unverified" }).click();
  await expect(page.getByText("Present · not verified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check advisories", exact: true }).click();
  await expect(page.getByText("Fixture installed advisory")).toBeVisible();
  const output = await exported(page);
  expect(output.comparison).toEqual(comparison());
  expect(output.advisoryState).toBe("matching-installed-version-evidence");
  expect(output.audit.findings[0].fixedVersion).toBe("1:1.0-1");
});

test("failed forced advisory refresh hides old successful evidence and preserves comparison", async ({
  page,
}) => {
  await fixtures(page);
  let requests = 0;
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command !== "audit") return route.fallback();
    requests++;
    if (requests === 1) await route.fulfill({ json: audit() });
    else {
      expect(body.refresh).toBe(true);
      await route.fulfill({
        status: 503,
        json: { error: "Candidate advisory fixture unavailable" },
      });
    }
  });
  await compare(page);
  await page.getByRole("button", { name: "Check advisories", exact: true }).click();
  await expect(page.getByText("Fixture installed advisory")).toBeVisible();
  await page.getByRole("button", { name: "Recheck advisories", exact: true }).click();
  await expect(page.getByText(/Candidate advisory fixture unavailable/)).toBeVisible();
  await expect(page.getByText("Fixture installed advisory")).toHaveCount(0);
  const output = await exported(page);
  expect(output.advisoryState).toBe("unknown");
  expect(output.audit).toBeNull();
  expect(output.comparison).toEqual(comparison());
});

test("mismatched advisory identity and custom repositories never become matching evidence", async ({
  page,
}) => {
  const feed = audit();
  feed.fingerprint = "different-inventory";
  await fixtures(page, comparison(), feed);
  await compare(page);
  await page.getByRole("button", { name: "Check advisories", exact: true }).click();
  await expect(
    page.getByText("Advisory status unknown · no current matching evidence"),
  ).toBeVisible();
  expect((await exported(page)).audit).toBeNull();
  await page.goto("about:blank");
  const report = comparison();
  report.repository = "custom";
  await fixtures(page, report);
  await compare(page);
  await expect(page.getByText("Outside official Arch advisory coverage")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check advisories", exact: true })).toBeDisabled();
});

test("review plan displays package declarations and exports all captured comparisons", async ({
  page,
}) => {
  await fixtures(page);
  let plan: UpdatePlan;
  await page.route("**/api/query", async (route) => {
    if (route.request().postDataJSON().command !== "plan") return route.fallback();
    plan = {
      id: "plan-fixture",
      createdAt: 1791220000,
      fingerprint: "candidate-fixture",
      packages: [],
      comparisons: [comparison()],
      comparisonsComplete: false,
      security: null,
      downloadSize: 0,
      command: "omarchy update",
      preconditions: ["Verify recovery"],
      limitations: ["Read-only inventory"],
    };
    await route.fulfill({ json: plan });
  });
  await page.goto("/#/updates");
  await page.getByRole("button", { name: "Create review plan" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("summary").filter({ hasText: "pacman ·" }).click();
  await expect(dialog.getByText("new-provider>=2", { exact: true })).toBeVisible();
  const waiting = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export review plan" }).click();
  const data = JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
  expect(data).toEqual(plan!);
});

for (const theme of ["light", "dark"]) {
  test(`candidate review is accessible at mobile width in ${theme} appearance`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: false }),
        ),
      theme,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await fixtures(page);
    await compare(page);
    await page.getByRole("heading", { name: "pacman · candidate review" }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `artifacts/candidate-review-${theme}-mobile.png` });
  });
}

test("failed background inventory refresh marks cached comparisons and exports as unknown", async ({
  page,
}) => {
  await page.clock.install();
  await fixtures(page);
  let failSnapshot = false;
  await page.route("**/api/query", async (route) => {
    if (route.request().postDataJSON().command !== "snapshot" || !failSnapshot)
      return route.fallback();
    await route.fulfill({ status: 503, json: { error: "Snapshot unavailable" } });
  });
  await compare(page);
  await page.getByRole("button", { name: "Check advisories", exact: true }).click();
  await expect(page.getByText("Fixture installed advisory")).toBeVisible();
  failSnapshot = true;
  const firstFailure = page.waitForResponse(
    (response) =>
      response.request().postDataJSON()?.command === "snapshot" && response.status() === 503,
  );
  await page.clock.fastForward(61_000);
  await firstFailure;
  await page.clock.fastForward(2_000);
  await expect(
    page.getByText("Current package state unavailable. Refresh the inventory and compare again."),
  ).toBeVisible();
  const data = await exported(page);
  expect(data.currentSnapshotMatches).toBe(false);
  expect(data.advisoryState).toBe("unknown");
  expect(data.audit).toBeNull();
});
