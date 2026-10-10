import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Audit, Snapshot } from "../src/lib/ipc/bindings";

function inventory(): Snapshot {
  return {
    capturedAt: Date.now() / 1000,
    fingerprint: "triage-fixture",
    hostname: "fixture",
    installedCount: 100,
    explicitCount: 10,
    foreignCount: 4,
    updateCount: 0,
    installedSize: 1000,
    repositories: [],
    warnings: [],
    locked: false,
    omarchy: true,
    signaturePolicy: [],
  };
}
function evidence(count = 57): Audit {
  return {
    scannedAt: Date.now() / 1000,
    fingerprint: "triage-fixture",
    source: "Arch Security Tracker",
    sourceUrl: "https://security.archlinux.org/all.json",
    checkedPackages: 96,
    uncoveredPackages: 4,
    limitations: ["Feed publication freshness and complete affected ranges are unknown."],
    findings: Array.from({ length: count }, (_, index) => ({
      id: `ASA-test-${index}`,
      package: index === 56 ? "pacman" : `package-${index}`,
      title: `Captured advisory ${index}`,
      description: `Captured evidence ${index}`,
      severity: index % 2 ? "medium" : "high",
      confidence: index % 3 ? "version-match" : "needs-review",
      installedVersion: "1.0-1",
      fixedVersion: index === 56 ? "9.2-1" : null,
      cves: [`CVE-test-${index}`, "CVE-secondary", `CVE-hidden-${index}`],
      url: null,
      line: null,
      file: null,
    })),
  };
}
async function fixtures(page: Page, getAudit = () => evidence(), failRefresh = false) {
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "snapshot") await route.fulfill({ json: inventory() });
    else if (body.command === "audit") {
      if (body.refresh && failRefresh)
        await route.fulfill({ status: 503, json: { error: "Advisory refresh unavailable" } });
      else await route.fulfill({ json: getAudit() });
    } else await route.continue();
  });
}

test("large advisory captures page, search all CVEs and versions, and export full evidence", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/#/security");
  await expect(page.getByRole("article")).toHaveCount(25);
  await expect(page.getByRole("status")).toHaveText("1–25 of 57 findings");
  await page.getByRole("button", { name: "Next advisory page" }).click();
  await expect(page.getByRole("status")).toHaveText("26–50 of 57 findings");
  await page.getByRole("button", { name: "Next advisory page" }).click();
  await expect(page.getByRole("article")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "Next advisory page" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous advisory page" }).click();
  await expect(page.getByRole("status")).toHaveText("26–50 of 57 findings");
  const search = page.getByRole("textbox", { name: "Search advisory findings" });
  for (const query of [" CVE-hidden-56 ", "asa-TEST-56", "9.2-1", "PACMAN"]) {
    await search.fill(query);
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText("CVE-hidden-56");
    await expect(page.getByRole("status")).toHaveText("1–1 of 1 findings · 57 captured");
  }
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await waiting;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(exported).toEqual(evidenceWithStamp(exported.scannedAt));
  await search.fill("missing-query");
  await expect(page.getByText("No findings match this filter", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No matches in the available evidence", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Clear advisory search" }).click();
  await expect(page.getByRole("status")).toHaveText("1–25 of 57 findings");
  await page.getByRole("button", { name: "High & critical", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(25);
  await expect(page.getByRole("status")).toHaveText("1–25 of 29 findings · 57 captured");
  await page.getByRole("button", { name: "Needs review", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(19);
});
function evidenceWithStamp(stamp: number) {
  return { ...evidence(), scannedAt: stamp };
}

test("deep-link search carries exact affected package into installed and dependency workspaces", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/#/security?q=pacman");
  await expect(page.getByRole("textbox", { name: "Search advisory findings" })).toHaveValue(
    "pacman",
  );
  await page.getByRole("button", { name: "Review installed package", exact: true }).click();
  await expect(page).toHaveURL(/#\/installed\?q=pacman$/);
  await expect(page.getByRole("textbox", { name: "Search packages", exact: true })).toHaveValue(
    "pacman",
  );
  await page.goBack();
  await page.getByRole("button", { name: "Inspect dependency paths", exact: true }).click();
  await expect(page).toHaveURL(/#\/dependencies\?q=pacman$/);
  await expect(
    page.getByRole("textbox", { name: "Search installed packages", exact: true }),
  ).toHaveValue("pacman");
  await expect(
    page.getByRole("button", { name: "Inspect dependencies", exact: true }),
  ).toBeEnabled();
});

test("successful refresh from a later page resets paging for a smaller capture", async ({
  page,
}) => {
  let capture = evidence();
  await fixtures(page, () => capture);
  await page.goto("/#/security");
  await page.getByRole("button", { name: "Next advisory page" }).click();
  capture = evidence(1);
  await page.getByRole("button", { name: "Run advisory check" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("1–1 of 1 findings");
});

test("failed refresh hides findings, counts, inspection links and exports", async ({ page }) => {
  await fixtures(page, () => evidence(), true);
  await page.goto("/#/security");
  await expect(page.getByRole("article")).toHaveCount(25);
  await page.getByRole("button", { name: "Run advisory check" }).click();
  await expect(page.getByText("Advisory refresh unavailable")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Inspect dependency paths" })).toHaveCount(0);
  await expect(page.getByText("1–25 of 57 findings")).not.toBeVisible();
});

test("mismatched inventory leaves captured findings unavailable", async ({ page }) => {
  await fixtures(page, () => ({ ...evidence(), fingerprint: "old-inventory" }));
  await page.goto("/#/security");
  await expect(page.getByRole("heading", { name: "Advisory status unknown" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
});

for (const theme of ["light", "dark"]) {
  test(`${theme} advisory investigation is accessible on desktop and 390px`, async ({ page }) => {
    await fixtures(page);
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: true }),
        ),
      theme,
    );
    await page.goto("/#/security?q=pacman");
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: `artifacts/advisory-triage-${theme}-${width}.png`,
        fullPage: true,
      });
    }
  });
}
