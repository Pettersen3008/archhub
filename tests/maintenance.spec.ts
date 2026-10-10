import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type {
  Package,
  Snapshot,
  MaintenanceReport,
  RepositoryUpdates,
  ForeignUpdates,
} from "../src/lib/ipc/bindings";

const stamp = Date.now() / 1000;
function pkg(name: string, repository = "extra", installed = true): Package {
  return {
    id: `${repository}/${name}`,
    name,
    version: "1-1",
    installedVersion: installed ? "1-1" : null,
    description: `Description of ${name}`,
    repository,
    updateAvailable: false,
    installedSize: 1234,
    downloadSize: 100,
    url: null,
    licenses: [],
    dependencies: [],
    groups: [],
    architecture: "any",
    explicit: false,
    signature: "unknown",
    packageBase: repository === "aur" ? name : null,
    maintainer: null,
    votes: null,
    outOfDate: false,
    lastModified: null,
  };
}
function snapshot(omarchy = false): Snapshot {
  return {
    capturedAt: stamp,
    fingerprint: "maintenance-fixture",
    hostname: "fixture",
    installedCount: 100,
    explicitCount: 10,
    foreignCount: 3,
    updateCount: 0,
    installedSize: 12345678,
    locked: false,
    omarchy,
    repositories: [
      { name: "extra", packageCount: 100, updatedAt: stamp - 30 * 86400, signaturePolicy: [] },
    ],
    warnings: [],
    signaturePolicy: [],
  };
}
function report(): MaintenanceReport {
  return {
    capturedAt: stamp,
    fingerprint: "maintenance-fixture",
    orphans: Array.from({ length: 29 }, (_, i) => pkg(`orphan-${String(i).padStart(2, "0")}`)),
    largest: [pkg("example-app")],
    foreign: [
      pkg("foreign-newer", "local"),
      pkg("foreign-same", "local"),
      pkg("local-only", "local"),
    ],
    caches: [
      { path: "/var/cache/pacman/pkg", bytes: 789000, files: 4, complete: true, warnings: [] },
      {
        path: "/unreadable/cache",
        bytes: 0,
        files: 0,
        complete: false,
        warnings: ["Cache directory unavailable"],
      },
    ],
    checkupdatesAvailable: true,
    paccacheAvailable: true,
    aurHelper: "yay",
    limitations: ["Fixture limits"],
  };
}
function repo(): RepositoryUpdates {
  return {
    checkedAt: stamp,
    fingerprint: "maintenance-fixture",
    packages: Array.from({ length: 57 }, (_, i) => ({
      name: `repo-${String(i).padStart(2, "0")}`,
      installedVersion: "1-1",
      availableVersion: "2-1",
    })),
    limitations: ["Separate database"],
  };
}
function foreign(): ForeignUpdates {
  return {
    checkedAt: stamp,
    fingerprint: "maintenance-fixture",
    packages: [
      {
        name: "foreign-newer",
        installedVersion: "1-1",
        aur: {
          name: "foreign-newer",
          packageBase: "foreign-suite",
          version: "2-1",
          versionRelation: "newer",
          maintainer: null,
          outOfDate: true,
          lastModified: stamp,
        },
      },
      {
        name: "foreign-same",
        installedVersion: "1-1",
        aur: {
          name: "foreign-same",
          packageBase: "foreign-same",
          version: "1-1",
          versionRelation: "same",
          maintainer: "maintainer",
          outOfDate: false,
          lastModified: stamp,
        },
      },
      { name: "local-only", installedVersion: "1-1", aur: null },
    ],
    limitations: ["Origin unverified"],
  };
}
async function fixtures(page: Page, omarchy = false) {
  const state = {
    snapshot: snapshot(omarchy),
    report: report(),
    repositories: repo(),
    foreign: foreign(),
    failRepo: false,
    failForeign: false,
    requests: [] as string[],
    holdRepo: null as Promise<void> | null,
    holdForeign: null as Promise<void> | null,
    package: pkg("example-app", "extra", false),
  };
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    state.requests.push(body.command);
    if (body.command === "snapshot") await route.fulfill({ json: state.snapshot });
    else if (body.command === "maintenance") await route.fulfill({ json: state.report });
    else if (body.command === "repository_updates" || body.command === "foreign_updates") {
      expect(body.fingerprint).toBe(state.snapshot.fingerprint);
      await (body.command === "repository_updates" ? state.holdRepo : state.holdForeign);
      if (body.command === "repository_updates" ? state.failRepo : state.failForeign)
        await route.fulfill({
          status: 503,
          json: {
            error:
              body.command === "repository_updates"
                ? "Repository check fixture failed"
                : "AUR check fixture failed",
          },
        });
      else
        await route.fulfill({
          json: body.command === "repository_updates" ? state.repositories : state.foreign,
        });
    } else if (body.command === "packages")
      await route.fulfill({
        json: { items: [state.package], total: 1, offset: 0, limit: 100, capturedAt: stamp },
      });
    else if (body.command === "history") await route.fulfill({ json: [] });
    else if (body.command === "recipe_review") await route.fulfill({ json: null });
    else if (body.command === "audit")
      await route.fulfill({
        json: {
          scannedAt: stamp,
          source: "fixture",
          sourceUrl: "https://security.archlinux.org",
          checkedPackages: 1,
          uncoveredPackages: 3,
          findings: [],
          limitations: [],
          fingerprint: state.snapshot.fingerprint,
        },
      });
    else await route.continue();
  });
  return state;
}
async function exported(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export maintenance", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}
async function open(page: Page) {
  await page.goto("/#/maintenance");
  await expect(page.getByRole("heading", { name: "Maintenance", exact: true })).toBeVisible();
}

test("online checks are explicit, paginate, retain full exports, and distinguish missing AUR names", async ({
  page,
}) => {
  const state = await fixtures(page);
  await open(page);
  expect(state.requests.filter((c) => c.endsWith("_updates"))).toEqual([]);
  await expect(page.getByText(/Zero local changes does not mean/)).toBeVisible();
  await page.getByRole("button", { name: "Check repositories online", exact: true }).click();
  await expect(page.getByText("repo-00", { exact: true })).toBeVisible();
  await expect(page.getByText("repo-56", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Next repository checks" }).click();
  await expect(page.getByText("repo-56", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check foreign versions on AUR" }).click();
  await expect(page.getByText("Newer AUR recipe available")).toBeVisible();
  await expect(page.getByText("No exact-name AUR match", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Newer recipes only" }).click();
  await expect(page.getByText("foreign-same", { exact: true })).not.toBeVisible();
  const output = await exported(page);
  expect(output.repositoryUpdates.packages).toHaveLength(57);
  expect(output.foreignUpdates.packages).toHaveLength(3);
  expect(output.currentSnapshotMatches).toBe(true);
  await page.getByRole("button", { name: "Review recipe for foreign-newer" }).click();
  await expect(page.getByRole("heading", { name: "Recipe review · foreign-suite" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fetch & run static scan", exact: true }),
  ).toBeVisible();
  expect(state.requests.filter((c) => c === "foreign_recipe" || c === "recipe")).toHaveLength(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Inspect foreign-newer", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "foreign-newer", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Review removal of foreign-newer" })).toBeVisible();
  expect(state.requests.filter((c) => c === "repository_updates")).toHaveLength(1);
  expect(state.requests.filter((c) => c === "foreign_updates")).toHaveLength(1);
});

test("pending checks survive route changes, failed retries withhold old results and never auto-retry", async ({
  page,
}) => {
  const state = await fixtures(page);
  await open(page);
  await page.getByRole("button", { name: "Check repositories online" }).click();
  await expect(page.getByText("repo-00", { exact: true })).toBeVisible();
  let release!: () => void;
  state.holdRepo = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.failRepo = true;
  await page.getByRole("button", { name: "Check repositories online" }).click();
  await expect(page.getByText("repo-00", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Maintenance", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Checking repositories…", exact: true }),
  ).toBeDisabled();
  release();
  await expect(page.getByText("Repository check fixture failed")).toBeVisible();
  const output = await exported(page);
  expect(output.repositoryCheckStatus).toBe("failed");
  expect(output.repositoryUpdates).toBeNull();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Maintenance", exact: true }).click();
  await expect(page.getByText("Repository check fixture failed")).toBeVisible();
  expect(state.requests.filter((c) => c === "repository_updates")).toHaveLength(2);
  state.failRepo = false;
  state.holdRepo = null;
  await page.getByRole("button", { name: "Check repositories online" }).click();
  await expect(page.getByText("repo-00", { exact: true })).toBeVisible();
});

test("AUR recheck failure stays unknown with filters selected and recovers explicitly", async ({
  page,
}) => {
  const state = await fixtures(page);
  await open(page);
  await page.getByRole("button", { name: "Check foreign versions on AUR" }).click();
  await expect(page.getByText("Newer AUR recipe available")).toBeVisible();
  await page.getByRole("button", { name: "Newer recipes only" }).click();
  state.failForeign = true;
  await page.getByRole("button", { name: "Check foreign versions on AUR" }).click();
  await expect(page.getByText("AUR check fixture failed")).toBeVisible();
  await expect(page.getByText("Newer AUR recipe available")).not.toBeVisible();
  await expect(page.getByText("AUR version unknown", { exact: true })).toHaveCount(3);
  const output = await exported(page);
  expect(output.foreignUpdates).toBeNull();
  expect(output.foreignCheckStatus).toBe("failed");
  state.failForeign = false;
  await page.getByRole("button", { name: "Check foreign versions on AUR" }).click();
  await expect(page.getByText("Newer AUR recipe available")).toBeVisible();
});

test("changed and locked inventory cannot reuse old results", async ({ page }) => {
  const state = await fixtures(page);
  await open(page);
  await page.getByRole("button", { name: "Check repositories online" }).click();
  await expect(page.getByText("repo-00", { exact: true })).toBeVisible();
  state.snapshot.fingerprint = "changed";
  state.report.fingerprint = "changed";
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(page.getByText("repo-00", { exact: true })).not.toBeVisible();
  expect((await exported(page)).repositoryUpdates).toBeNull();
  state.snapshot.locked = true;
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check repositories online" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Check foreign versions on AUR" })).toBeDisabled();
});

test("orphans, cache partial totals and package inspection are usable without destructive bulk actions", async ({
  page,
}) => {
  await fixtures(page);
  await open(page);
  await page.getByRole("tab", { name: "Orphans", exact: true }).click();
  await page.getByRole("button", { name: "Next orphan page" }).click();
  await expect(page.getByRole("button", { name: "View orphan-28", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search orphan packages" }).fill("orphan-00");
  await page.getByRole("button", { name: "View orphan-00", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review removal of orphan-00" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Disk usage", exact: true }).click();
  await expect(page.getByText("Cache directory unavailable", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy cache cleanup preview command" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View example-app", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Review removal of example-app", exact: true }),
  ).toBeVisible();
});

for (const omarchy of [false, true]) {
  test(`${omarchy ? "Omarchy" : "plain Arch"} offers full-update install commands and copies without execution`, async ({
    page,
    context,
    browserName,
  }) => {
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    } else {
      // Firefox has no Playwright clipboard permission grant. Capture the
      // browser API boundary; Chromium separately verifies its real clipboard.
      await page.addInitScript(() => {
        let copied = "";
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: async (text: string) => {
              copied = text;
            },
            readText: async () => copied,
          },
        });
      });
    }
    await fixtures(page, omarchy);
    await page.goto("/#/packages");
    await page.getByRole("button", { name: "View example-app", exact: true }).click();
    const expected = omarchy
      ? "omarchy update && sudo pacman -S -- 'example-app'"
      : "sudo pacman -Syu -- 'example-app'";
    await page.getByRole("button", { name: "Copy install command for example-app" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
  });
}

test("missing optional tools provide an installation handoff", async ({ page }) => {
  const state = await fixtures(page);
  state.report.checkupdatesAvailable = false;
  state.report.paccacheAvailable = false;
  await open(page);
  await expect(page.getByRole("button", { name: "Check repositories online" })).toBeDisabled();
  await expect(page.getByText("sudo pacman -Syu -- pacman-contrib", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Disk usage", exact: true }).click();
  await expect(
    page.getByText("Install pacman-contrib for the paccache cleanup preview."),
  ).toBeVisible();
});

test("overview directs stale zero-update inventory to maintenance", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  const metric = page.getByRole("button", { name: /Repository updates/ });
  await expect(metric).toContainText("—");
  await expect(metric).toContainText("Local indexes need refresh");
  await metric.click();
  await expect(page.getByRole("heading", { name: "Maintenance", exact: true })).toBeVisible();
});

test("untrusted names and helper metadata cannot create shell commands", async ({ page }) => {
  const state = await fixtures(page);
  state.package = pkg("example;touch /tmp/injected", "extra", false);
  await page.goto("/#/packages");
  await page.getByRole("button", { name: `View ${state.package.name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: /Copy install command/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  state.package = pkg("aur-example", "aur", false);
  state.report.aurHelper = "yay;id";
  await page.reload();
  await page.getByRole("button", { name: "View aur-example", exact: true }).click();
  await expect(page.getByRole("button", { name: /Copy install command/ })).toHaveCount(0);
});

test("AUR helper handoff preserves the full update workflow", async ({ page }) => {
  const state = await fixtures(page, true);
  state.package = pkg("aur-example", "aur", false);
  await page.goto("/#/packages");
  await page.getByRole("button", { name: "View aur-example", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("omarchy update && yay -S -- 'aur-example'", { exact: true }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`${theme} mobile maintenance tools are accessible and fit the screen`, async ({ page }) => {
    await fixtures(page);
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: true }),
        ),
      theme,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await page.getByRole("button", { name: "Check foreign versions on AUR", exact: true }).click();
    await expect(page.getByText("Newer AUR recipe available")).toBeVisible();
    expect(
      await page
        .getByText("foreign-newer", { exact: true })
        .evaluate((element) => element.parentElement!.getBoundingClientRect().width),
    ).toBeGreaterThan(250);
    for (const name of ["Update checks", "Orphans", "Disk usage"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: `artifacts/maintenance-${theme}-${name.replaceAll(" ", "-").toLowerCase()}-mobile.png`,
        fullPage: true,
      });
    }
    await page.screenshot({ path: `artifacts/maintenance-${theme}-mobile.png`, fullPage: true });
  });
}
