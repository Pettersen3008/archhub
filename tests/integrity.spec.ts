import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { IntegrityReport, PackagePage } from "../src/lib/ipc/bindings";

function evidence(): IntegrityReport {
  return {
    name: "pacman",
    version: "fixture-1",
    startedAt: 1791220000,
    finishedAt: 1791220001,
    command: "/usr/bin/pacman --query --check --check --color never -- pacman",
    metadataDigest: "a".repeat(64),
    ownedFiles: 250,
    totalEntries: 250,
    pacmanAlteredFiles: 206,
    exitCode: 1,
    complete: false,
    issues: [
      ...Array.from({ length: 205 }, (_, i) => ({
        path: `/usr/bin/tool-${String(i).padStart(3, "0")}`,
        kind: "changed" as const,
        backup: false,
        messages: ["SHA256 checksum mismatch", "Size mismatch"],
      })),
      {
        path: "/etc/pacman.conf",
        kind: "configuration",
        backup: true,
        messages: ["SHA256 checksum mismatch"],
      },
      {
        path: "/etc/private-config",
        kind: "unavailable",
        backup: true,
        messages: ["failed to calculate SHA256 checksum"],
      },
    ],
    warnings: ["A fixture database lock changed during this check. Check again."],
    limitations: [
      "Local metadata is not independently authenticated.",
      "Files can change during a scan. No security verdict.",
    ],
  };
}
async function mock(page: Page, report: IntegrityReport) {
  await page.route("**/api/query", async (route) => {
    if (route.request().postDataJSON().command === "integrity") {
      await route.fulfill({ json: report });
    } else await route.continue();
  });
}

test("installed package trust links to a real check and JSON export", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/installed?q=pacman");
  await page.getByRole("button", { name: "View pacman", exact: true }).click();
  await page.getByRole("tab", { name: "Origin & trust" }).click();
  await page.getByRole("button", { name: "Inspect installed files", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "File integrity", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select pacman", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("A closer look at installed files.")).toBeVisible();
  await page.getByRole("button", { name: "Check files", exact: true }).click();
  await expect(page.getByRole("heading", { name: "File evidence · pacman" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference & coverage" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export evidence" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("archhub-integrity-pacman.json");
  const report = JSON.parse(await readFile((await file.path())!, "utf8")) as IntegrityReport;
  expect(report.name).toBe("pacman");
  expect(report.totalEntries).toBeGreaterThan(0);
  expect(report.metadataDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(report.limitations.join(" ")).toContain("not independently authenticated");
  await page.screenshot({ path: "artifacts/integrity-live.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("filters, search and paging preserve complete grouped evidence in exports", async ({
  page,
}) => {
  await mock(page, evidence());
  await page.goto("/#/integrity");
  await page.getByRole("button", { name: "Check files", exact: true }).click();
  await expect(page.getByText("Incomplete coverage", { exact: true })).toBeVisible();
  await expect(page.getByText("Some checks remain unknown.")).toBeVisible();
  await expect(page.getByText("1–100 of 207 paths")).toBeVisible();
  await page.getByRole("button", { name: "Next evidence page" }).click();
  await expect(page.getByText("101–200 of 207 paths")).toBeVisible();
  await page.getByRole("button", { name: "Configuration 1", exact: true }).click();
  await expect(page.getByText("/etc/pacman.conf", { exact: true })).toBeVisible();
  await expect(page.getByText("/usr/bin/tool-100", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Unavailable 1", exact: true }).click();
  await expect(page.getByText("/etc/private-config", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All 207", exact: true }).click();
  await page.getByRole("textbox", { name: "Search file evidence" }).fill("tool-204");
  await expect(page.getByText("/usr/bin/tool-204", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export evidence" }).click();
  const report = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  ) as IntegrityReport;
  expect(report.issues).toHaveLength(207);
  await page.getByRole("textbox", { name: "Search file evidence" }).fill("does-not-exist");
  await expect(page.getByText("No paths match these filters", { exact: true })).toBeVisible();
});

test("failed checks clear previous evidence, remain unknown and can retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/query", async (route) => {
    if (route.request().postDataJSON().command !== "integrity") return route.continue();
    attempts++;
    if (attempts === 2)
      await route.fulfill({
        status: 400,
        json: {
          error: "The installed version changed. Refresh the inventory before checking files.",
        },
      });
    else await route.fulfill({ json: evidence() });
  });
  await page.goto("/#/integrity");
  await page.getByRole("button", { name: "Check files", exact: true }).click();
  await expect(page.getByText("Incomplete coverage", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check files", exact: true }).click();
  await expect(page.getByText("We couldn’t complete this check")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export evidence" })).toBeDisabled();
  await expect(page.getByText("Incomplete coverage", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Incomplete coverage", { exact: true })).toBeVisible();
});

test("no differences remain evidence with explicit limits", async ({ page }) => {
  await mock(page, {
    ...evidence(),
    issues: [],
    warnings: [],
    complete: true,
    exitCode: 0,
    pacmanAlteredFiles: 0,
  });
  await page.goto("/#/integrity");
  await page.getByRole("button", { name: "Check files", exact: true }).click();
  await expect(page.getByText("No package-file differences reported.")).toBeVisible();
  await expect(page.getByText("No differences reported", { exact: true })).toBeVisible();
  await expect(page.getByText("File checks use unauthenticated local metadata.")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search installed packages" })
    .fill("no-archhub-package-123456");
  await expect(page.getByText("No installed packages match. Try another name.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check files", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export evidence" })).toBeDisabled();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} integrity evidence is accessible and fits a narrow screen`, async ({ page }) => {
    await page.addInitScript(
      (theme) =>
        localStorage.setItem("archhub.preferences", JSON.stringify({ theme, compact: false })),
      theme,
    );
    await mock(page, evidence());
    await page.goto("/#/integrity");
    await expect(page.getByRole("button", { name: "Check files", exact: true })).toBeEnabled();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.getByRole("button", { name: "Check files", exact: true }).click();
    await expect(page.getByText("Incomplete coverage", { exact: true })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `artifacts/integrity-${theme}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: `artifacts/integrity-${theme}-mobile.png`, fullPage: true });
  });
}

test("integrity API rejects uninstalled, stale and injected identities", async ({ request }) => {
  for (const data of [
    { command: "integrity", name: "pacman", version: "stale-1" },
    { command: "integrity", name: "../etc/passwd", version: "1" },
    { command: "integrity", name: "--help", version: "1" },
    { command: "integrity", name: "pacman;id", version: "1" },
    { command: "integrity", name: "pacman", version: "../../etc/passwd" },
    { command: "integrity", name: "no-archhub-package-123456", version: "1" },
  ])
    expect((await request.post("/api/query", { data })).status()).toBe(400);
});

test("inventory refresh recovers from a changed installed version", async ({ page }) => {
  let refreshed = false;
  const versions: string[] = [];
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "packages") {
      const response = await route.fetch();
      const data = (await response.json()) as PackagePage;
      data.items = data.items.map((pkg) =>
        pkg.name === "pacman"
          ? { ...pkg, installedVersion: refreshed ? "fixture-2" : "fixture-1" }
          : pkg,
      );
      await route.fulfill({ json: data });
    } else if (body.command === "snapshot" && body.refresh) {
      refreshed = true;
      await route.continue();
    } else if (body.command === "integrity") {
      versions.push(body.version);
      if (body.version !== "fixture-2")
        await route.fulfill({
          status: 400,
          json: {
            error: "The installed version changed. Refresh the inventory before checking files.",
          },
        });
      else await route.fulfill({ json: { ...evidence(), version: "fixture-2" } });
    } else await route.continue();
  });
  await page.goto("/#/integrity");
  await page.getByRole("button", { name: "Check files", exact: true }).click();
  await expect(page.getByText("We couldn’t complete this check")).toBeVisible();
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select pacman", exact: true })).toContainText(
    "fixture-2",
  );
  await page.getByRole("button", { name: "Check files", exact: true }).click();
  await expect(page.getByRole("heading", { name: "File evidence · pacman" })).toBeVisible();
  expect(versions).toEqual(["fixture-1", "fixture-2"]);
});
