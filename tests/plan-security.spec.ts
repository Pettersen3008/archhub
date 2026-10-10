import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { UpdatePlan, PlanAdvisory, Snapshot } from "../src/lib/ipc/bindings";

const stamp = Date.now() / 1000;
function finding(index: number, status: PlanAdvisory["listedFixStatus"]): PlanAdvisory {
  return {
    finding: {
      id: `AVG-fixture-${index}:example-${index}`,
      package: `example-${index}`,
      title: `Fixture advisory ${index}`,
      description: "Tracker affected-range applicability requires review.",
      installedVersion: "1.0-1",
      fixedVersion: status === "no_listed_fix" ? null : "2.0-1",
      severity: "high",
      confidence: "needs-review",
      cves: [`CVE-fixture-${index}`],
      url: index === 1 ? "javascript:alert(1)" : "https://security.archlinux.org/AVG-fixture",
      line: null,
      file: null,
    },
    candidateVersion: status === "below_listed_fix" ? "1.0-1" : "2.0-1",
    candidateRepository: "extra",
    listedFixStatus: status,
  };
}
function plan(count = 3): UpdatePlan {
  const findings = Array.from({ length: count }, (_, i) =>
    finding(i, (["reaches_listed_fix", "below_listed_fix", "no_listed_fix"] as const)[i % 3]!),
  );
  return {
    id: "plan-security-fixture",
    createdAt: stamp,
    fingerprint: "security-fixture",
    packages: [],
    comparisons: [],
    comparisonsComplete: true,
    downloadSize: 0,
    command: "omarchy update",
    preconditions: ["Verify recovery"],
    limitations: ["Read-only plan"],
    security: {
      unavailableReason: null,
      findings,
      audit: {
        scannedAt: stamp,
        fingerprint: "security-fixture",
        source: "Arch Security Tracker",
        sourceUrl: "https://security.archlinux.org/all.json",
        checkedPackages: 100,
        uncoveredPackages: 5,
        findings: findings.map((item) => item.finding),
        limitations: ["AUR and third-party packages are outside advisory coverage."],
      },
    },
  };
}
function snapshot(): Snapshot {
  return {
    capturedAt: stamp,
    fingerprint: "security-fixture",
    hostname: "fixture",
    installedCount: 105,
    explicitCount: 10,
    foreignCount: 5,
    updateCount: 0,
    installedSize: 0,
    repositories: [],
    warnings: [],
    locked: false,
    omarchy: true,
    signaturePolicy: [],
  };
}
async function fixtures(page: Page, value: UpdatePlan) {
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "snapshot") await route.fulfill({ json: snapshot() });
    else if (body.command === "plan") await route.fulfill({ json: value });
    else if (body.command === "packages")
      await route.fulfill({
        json: { items: [], total: 0, offset: 0, limit: 100, capturedAt: stamp },
      });
    else if (body.command === "audit")
      await route.fulfill({ status: 503, json: { error: "Feed fixture unavailable" } });
    else await route.continue();
  });
}
async function open(page: Page) {
  await page.goto("/#/updates");
  await page.getByRole("button", { name: "Create review plan" }).click();
  await expect(page.getByRole("dialog", { name: "Update review plan" })).toBeVisible();
  return page.getByRole("dialog", { name: "Update review plan" });
}
async function exported(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export review plan" }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

test("plan retains installed findings without updates and distinguishes candidate fix context", async ({
  page,
}) => {
  const value = plan();
  await fixtures(page, value);
  const dialog = await open(page);
  await expect(dialog.getByText(/3 installed-version findings/)).toBeVisible();
  await expect(dialog.getByText(/Candidate reaches listed fix/)).toBeVisible();
  await expect(dialog.getByText(/Candidate below listed fix/)).toBeVisible();
  await expect(dialog.getByText(/No fixed version listed/)).toBeVisible();
  await expect(dialog.getByText(/Candidate archives are not audited/)).toBeVisible();
  await expect(dialog.getByText(/outside advisory coverage/)).not.toBeVisible();
  await dialog.locator("summary", { hasText: "Advisory coverage & limitations" }).click();
  await expect(dialog.getByText(/outside advisory coverage/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Tracker advisory" })).toHaveCount(2);
  expect(await exported(page)).toEqual(value);
});

test("unavailable advisory evidence remains unknown and exports a useful metadata plan", async ({
  page,
}) => {
  const value = plan();
  value.security = { audit: null, unavailableReason: "Feed fixture unavailable", findings: [] };
  await fixtures(page, value);
  const dialog = await open(page);
  await expect(dialog.getByRole("status")).toContainText("Advisory status unknown");
  await expect(dialog.getByText(/No installed-version matches/)).toHaveCount(0);
  await expect(dialog.getByText(/Version and metadata review remain available/)).toBeVisible();
  expect(await exported(page)).toEqual(value);
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Main areas", exact: true })
    .getByRole("button", { name: "Security", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
});

test("zero matches and older plans do not acquire a safety verdict", async ({ page }) => {
  await fixtures(page, plan(0));
  let dialog = await open(page);
  await expect(dialog.getByText("No installed-version matches in this feed.")).toBeVisible();
  await expect(dialog.getByText(/5 outside coverage/)).toBeVisible();
  await page.goto("about:blank");
  const older = plan();
  older.security = null;
  await fixtures(page, older);
  dialog = await open(page);
  await expect(dialog.getByText(/Not captured in this plan/)).toBeVisible();
  expect((await exported(page)).security).toBeNull();
});

test("large captures paginate and filter while exporting every advisory", async ({ page }) => {
  const value = plan(61);
  await fixtures(page, value);
  const dialog = await open(page);
  await expect(dialog.locator("article")).toHaveCount(25);
  await dialog.getByRole("button", { name: "Next advisories" }).click();
  await expect(dialog.getByText("26–50 of 61")).toBeVisible();
  await dialog.getByRole("button", { name: "Next advisories" }).click();
  await expect(dialog.locator("article")).toHaveCount(11);
  await dialog.getByRole("textbox", { name: "Filter plan advisories" }).fill("CVE-fixture-60");
  await expect(dialog.locator("article")).toHaveCount(1);
  await expect(dialog.getByText(/Fixture advisory 60/)).toBeVisible();
  expect(await exported(page)).toEqual(value);
});

test("inventory changes while a plan is open mark it as historical evidence", async ({ page }) => {
  await page.clock.install();
  await fixtures(page, plan());
  const dialog = await open(page);
  await page.route("**/api/query", async (route) => {
    if (route.request().postDataJSON().command !== "snapshot") return route.fallback();
    await route.fulfill({ json: { ...snapshot(), fingerprint: "changed" } });
  });
  await page.clock.fastForward(60_001);
  await expect(dialog.getByText(/This is historical evidence/)).toBeVisible();
  expect((await exported(page)).fingerprint).toBe("security-fixture");
});

for (const theme of ["light", "dark"]) {
  test(`${theme} security plan is accessible on desktop and mobile`, async ({ page }) => {
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: true }),
        ),
      theme,
    );
    await fixtures(page, plan());
    await open(page);
    await expect
      .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
      .toBe(theme === "dark");
    for (const viewport of [
      { width: 1440, height: 1080 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(scan.violations).toEqual([]);
    }
    await page.screenshot({ path: `artifacts/plan-security-${theme}-mobile.png`, fullPage: true });
  });
}
