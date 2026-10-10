import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, writeFile } from "node:fs/promises";
import type { Snapshot, UpdatePreparation, UpdatePlan } from "../src/lib/ipc/bindings";

async function fixtures(page: Page, omarchy = false) {
  const stamp = Date.now() / 1000;
  const snapshot: Snapshot = {
    capturedAt: stamp,
    fingerprint: "preparation-fixture",
    hostname: "fixture",
    installedCount: 30,
    explicitCount: 10,
    foreignCount: 3,
    updateCount: 0,
    installedSize: 1234,
    locked: false,
    omarchy,
    repositories: [],
    warnings: [],
    signaturePolicy: [],
  };
  const preparation: UpdatePreparation = {
    capturedAt: stamp,
    fingerprint: snapshot.fingerprint,
    command: omarchy ? "omarchy update" : "sudo pacman -Syu",
    repositories: {
      checkedAt: stamp,
      fingerprint: snapshot.fingerprint,
      packages: Array.from({ length: 28 }, (_, i) => ({
        name: `package-${i}`,
        installedVersion: "1-1",
        availableVersion: "2-1",
      })),
      limitations: [],
    },
    repositoryError: null,
    news: {
      checkedAt: stamp,
      sourceUrl: "https://archlinux.org/feeds/news/",
      digest: "a".repeat(64),
      publishedAt: stamp - 86400,
      items: [
        {
          title: "Read this manual intervention notice",
          url: "https://archlinux.org/news/manual-intervention/",
          publishedAt: stamp - 86400,
        },
      ],
      limitations: ["Recent publications only"],
    },
    newsError: null,
    limitations: ["Terminal handoff only"],
  };
  const plan: UpdatePlan = {
    id: "fixture-plan",
    createdAt: stamp,
    fingerprint: snapshot.fingerprint,
    packages: [],
    comparisons: [],
    comparisonsComplete: true,
    security: null,
    downloadSize: 0,
    command: preparation.command,
    preconditions: [],
    limitations: [],
  };
  const state = {
    snapshot,
    preparation,
    plan,
    requests: [] as string[],
    hold: null as Promise<void> | null,
    fail: false,
    failSnapshot: false,
  };
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          document.documentElement.dataset.copiedCommand = value;
        },
      },
      configurable: true,
    });
  });
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    state.requests.push(body.command);
    if (body.command === "snapshot")
      await route.fulfill(
        state.failSnapshot
          ? { status: 503, json: { error: "Inventory refresh failed" } }
          : { json: state.snapshot },
      );
    else if (body.command === "update_preparation") {
      await state.hold;
      await route.fulfill(
        state.fail
          ? { status: 503, json: { error: "Preparation failed" } }
          : { json: state.preparation },
      );
    } else if (body.command === "packages")
      await route.fulfill({
        json: { items: [], total: 0, offset: 0, limit: 100, capturedAt: stamp },
      });
    else if (body.command === "plan") await route.fulfill({ json: state.plan });
    else if (body.command === "history") await route.fulfill({ json: [] });
    else await route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } });
  });
  return state;
}
async function open(page: Page) {
  await page.goto("/#/updates");
  await expect(page.getByRole("heading", { name: "Prepare your next update" })).toBeVisible();
}
async function check(page: Page) {
  await page.getByRole("button", { name: "Check update readiness", exact: true }).click();
}
async function review(page: Page) {
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}
async function exported(page: Page) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export update preparation" }).click();
  return JSON.parse(await readFile((await (await event).path())!, "utf8"));
}
const handoff = (page: Page) => page.getByRole("button", { name: "Copy full updater command" });

for (const omarchy of [false, true])
  test(`explicit ${omarchy ? "Omarchy" : "Arch"} preparation reviews notices and recovery before handoff`, async ({
    page,
  }) => {
    const state = await fixtures(page, omarchy);
    await open(page);
    expect(state.requests).not.toContain("update_preparation");
    await expect(handoff(page)).toBeDisabled();
    await check(page);
    await expect(
      page.getByText("Checks captured — review required", { exact: true }),
    ).toBeVisible();
    await page.getByRole("checkbox").first().check();
    await expect(handoff(page)).toBeDisabled();
    await page.getByRole("checkbox").last().check();
    await expect(handoff(page)).toBeEnabled();
    await handoff(page).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-copied-command",
      state.preparation.command,
    );
    await expect(page.getByText("package-27", { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: "Next version changes" }).click();
    await expect(page.getByText("package-27", { exact: true })).toBeVisible();
    const output = await exported(page);
    expect(output.preparation.repositories.packages).toHaveLength(28);
    expect(output.handoffCommand).toBe(state.preparation.command);
    await check(page);
    await expect(
      page.getByText("Checks captured — review required", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("checkbox").first()).not.toBeChecked();
    await expect(handoff(page)).toBeDisabled();
    expect(state.requests.filter((c) => c === "update_preparation")).toHaveLength(2);
  });

for (const failed of ["repository", "news"] as const)
  test(`${failed} failure retains partial evidence without a command`, async ({ page }) => {
    const state = await fixtures(page);
    if (failed === "news") {
      state.preparation.news = null;
      state.preparation.newsError = "News unavailable";
    } else {
      state.preparation.repositories = null;
      state.preparation.repositoryError = "checkupdates unavailable";
    }
    await open(page);
    await check(page);
    await expect(page.getByText("Partial capture", { exact: true })).toBeVisible();
    await expect(handoff(page)).toBeDisabled();
    await expect(page.getByRole("checkbox").first()).toBeDisabled();
    const output = await exported(page);
    expect(output.handoffCommand).toBeNull();
    expect(output.preparation[failed === "news" ? "newsError" : "repositoryError"]).toBeTruthy();
  });

test("pending and failed rechecks survive navigation and withhold prior handoffs", async ({
  page,
}) => {
  const state = await fixtures(page);
  await open(page);
  await check(page);
  await review(page);
  await expect(handoff(page)).toBeEnabled();
  let release!: () => void;
  state.hold = new Promise((resolve) => {
    release = resolve;
  });
  state.fail = true;
  await check(page);
  await expect(page.getByText("Checking", { exact: true })).toBeVisible();
  await expect(handoff(page)).toBeDisabled();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  await expect(page.getByText("Checking", { exact: true })).toBeVisible();
  release();
  await expect(page.getByText("Check failed", { exact: true })).toBeVisible();
  await expect(handoff(page)).toBeDisabled();
  expect(state.requests.filter((c) => c === "update_preparation")).toHaveLength(2);
  expect((await exported(page)).handoffCommand).toBeNull();
});

for (const change of ["lock", "fingerprint", "refresh failure"])
  test(`${change} withholds preparation and local review-plan commands`, async ({ page }) => {
    const state = await fixtures(page);
    await open(page);
    await check(page);
    await review(page);
    await expect(handoff(page)).toBeEnabled();
    await page.getByRole("button", { name: "Create review plan", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Copy updater command", exact: true }),
    ).toBeEnabled();
    if (change === "lock") state.snapshot.locked = true;
    else if (change === "fingerprint") state.snapshot.fingerprint = "changed";
    else state.failSnapshot = true;
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Refresh inventory")!
        .click(),
    );
    await expect(
      page.getByRole("button", { name: "Copy updater command", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(handoff(page)).toBeDisabled();
    if (change !== "fingerprint")
      await expect(
        page.getByRole("button", { name: "Check update readiness", exact: true }),
      ).toBeDisabled();
  });

for (const invalid of ["expired", "command", "link", "source time"])
  test(`invalid ${invalid} capture cannot unlock a handoff`, async ({ page }) => {
    const state = await fixtures(page);
    if (invalid === "expired") state.preparation.capturedAt -= 901;
    if (invalid === "command") state.preparation.command = "sudo pacman -Sy";
    if (invalid === "link") state.preparation.news!.items[0]!.url = "javascript:alert(1)";
    if (invalid === "source time") state.preparation.news!.checkedAt -= 901;
    await open(page);
    await check(page);
    await expect(page.getByRole("button", { name: "Export update preparation" })).toBeVisible();
    await expect(page.getByRole("checkbox").first()).toBeDisabled();
    await expect(handoff(page)).toBeDisabled();
    expect((await exported(page)).handoffCommand).toBeNull();
    if (invalid === "link")
      await expect(
        page.getByRole("button", { name: "Read this manual intervention notice" }),
      ).toBeDisabled();
  });

test("zero repository changes preserve foreign and news review scope", async ({ page }) => {
  const state = await fixtures(page);
  state.preparation.repositories!.packages = [];
  await open(page);
  await check(page);
  await expect(page.getByText(/0 version changes from configured mirrors/)).toBeVisible();
  await expect(
    page.getByText(/AUR, foreign packages, toolchains and Omarchy migrations/),
  ).toBeVisible();
  await expect(handoff(page)).toBeDisabled();
});

test("a reviewed capture expires while the screen stays open", async ({ page }) => {
  await fixtures(page);
  await page.clock.install();
  await open(page);
  await check(page);
  await review(page);
  await expect(handoff(page)).toBeEnabled();
  await page.clock.fastForward(901_000);
  await expect(page.getByText("Capture expired", { exact: true })).toBeVisible();
  await expect(handoff(page)).toBeDisabled();
  expect((await exported(page)).handoffCommand).toBeNull();
});

test("clock changes cannot export or copy an expired handoff", async ({ page }) => {
  await fixtures(page);
  await page.clock.install();
  await open(page);
  await check(page);
  await review(page);
  await expect(handoff(page)).toBeEnabled();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 5_000)));
  await page.evaluate(() => {
    const original = Date.now;
    Date.now = () => original() + 901_000;
  });
  const output = await exported(page);
  expect(output.status).toBe("Capture expired");
  expect(output.handoffCommand).toBeNull();
  await handoff(page).click();
  await expect(handoff(page)).toBeDisabled();
  expect(await page.locator("html").getAttribute("data-copied-command")).toBeNull();
});

test("documentation edits preserve the open readiness review", async ({ page }) => {
  await fixtures(page);
  await open(page);
  await check(page);
  await review(page);
  await expect(handoff(page)).toBeEnabled();
  await page.evaluate(() => {
    document.documentElement.dataset.watchProbe = "retained";
  });
  const path = "tests/style-watch-fixture.md";
  const original = await readFile(path, "utf8");
  try {
    const colour = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
    await writeFile(path, `${original}\n<div class="bg-[#${colour}]">Watch probe</div>\n`);
    // Allow the development file watcher to settle; this proves absence of reload.
    await page.waitForTimeout(1500);
    await expect(page.locator("html")).toHaveAttribute("data-watch-probe", "retained");
    await expect(handoff(page)).toBeEnabled();
  } finally {
    await writeFile(path, original);
  }
});

for (const theme of ["light", "dark"])
  test(`${theme} preparation is accessible at mobile width`, async ({ page }) => {
    await fixtures(page, true);
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
    await check(page);
    await expect(
      page.getByText("Checks captured — review required", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    await page.screenshot({
      path: `artifacts/update-preparation-${theme}-mobile.png`,
      fullPage: true,
    });
  });
