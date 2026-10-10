import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

import { fixtures, open, pkg } from "./helpers/removal";
async function exportPlan(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export removal plan", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

test("orphan selection spans filters and pages, reviews only selected versions, exports every row", async ({
  page,
}) => {
  const state = await fixtures(page);
  await open(page);
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  await page.getByRole("button", { name: "Next orphan page" }).click();
  await page.getByRole("checkbox", { name: "Select orphan-028 for removal review" }).check();
  await page.getByRole("textbox", { name: "Search orphan packages" }).fill("orphan-028");
  await expect(page.getByText("26 selected · limit 100")).toBeVisible();
  expect(state.requests.filter((r) => r.command === "removal_plan")).toHaveLength(0);
  await page.getByRole("button", { name: "Review selected removals", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy reviewed removal command" })).toBeVisible();
  const calls = state.requests.filter((r) => r.command === "removal_plan");
  expect(calls).toHaveLength(1);
  expect(calls[0]!.targets).toHaveLength(26);
  expect(calls[0]!.targets!.at(-1)).toEqual({ name: "orphan-028", version: "1-1" });
  const output = await exportPlan(page);
  expect(output.plan.packages).toHaveLength(26);
  expect(output.currentSnapshotMatches).toBe(true);
  expect(output.actionableCommand).toContain("'orphan-028'");
  await page.getByRole("checkbox", { name: "Select orphan-028 for removal review" }).uncheck();
  await expect(page.getByRole("button", { name: "Copy reviewed removal command" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export removal plan" })).toHaveCount(0);
  expect(state.requests.filter((r) => r.command === "removal_plan")).toHaveLength(1);
});

test("individual review shows required blockers, HoldPkg and optional losses without copying removal", async ({
  page,
}) => {
  const state = await fixtures(page);
  state.customize = (plan) => {
    plan.dependencyCheckPassed = false;
    plan.command = null;
    plan.blockers = [
      { consumer: "important-app", dependency: "virtual-api>=2", causingPackage: "orphan-000" },
    ];
    plan.heldPackages = ["orphan-000"];
    plan.optionalImpacts = [
      {
        consumer: "another-app",
        dependency: "extra-api>=1",
        description: "Extra feature",
        removedProviders: ["orphan-000"],
      },
    ];
  };
  await page.goto("/#/installed");
  await page.getByRole("button", { name: "View orphan-000", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Copy remove command for orphan-000" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Review removal of orphan-000" }).click();
  await expect(dialog.getByText("Removal is blocked by required dependencies.")).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Removal blockers" })).toContainText(
    "important-app requires virtual-api>=2",
  );
  await expect(dialog.getByText(/Held by pacman’s HoldPkg policy/)).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Optional removal impacts" })).toContainText(
    "Extra feature",
  );
  await expect(dialog.getByRole("button", { name: /Copy .*remove command/ })).toHaveCount(0);
});

test("pending individual rechecks survive closure, failed results stay unknown and retry is explicit", async ({
  page,
}) => {
  const state = await fixtures(page);
  await page.goto("/#/installed");
  await page.getByRole("button", { name: "View orphan-000", exact: true }).click();
  const button = () => page.getByRole("button", { name: "Review removal of orphan-000" });
  await button().click();
  await expect(
    page.getByRole("button", { name: "Copy remove command for orphan-000" }),
  ).toBeVisible();
  let release!: () => void;
  state.hold = new Promise<void>((r) => (release = r));
  state.fail = true;
  await button().click();
  await expect(
    page.getByRole("button", { name: "Copy remove command for orphan-000" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "View orphan-000", exact: true }).click();
  await expect(page.getByRole("button", { name: "Checking removal…" })).toBeDisabled();
  const pending = await exportPlan(page);
  expect(pending.captureStatus).toBe("pending");
  expect(pending.actionableCommand).toBeNull();
  release();
  await expect(page.getByRole("alert")).toContainText("Removal fixture failed");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "View orphan-000", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Removal fixture failed");
  const failed = await exportPlan(page);
  expect(failed.captureStatus).toBe("failed");
  expect(failed.actionableCommand).toBeNull();
  expect(state.requests.filter((r) => r.command === "removal_plan")).toHaveLength(2);
  state.hold = null;
  state.fail = false;
  await button().click();
  await expect(
    page.getByRole("button", { name: "Copy remove command for orphan-000" }),
  ).toBeVisible();
});

test("failed inventory refresh and observed locks withhold reviewed commands", async ({ page }) => {
  const state = await fixtures(page);
  await open(page);
  await page.getByRole("checkbox", { name: "Select orphan-000 for removal review" }).check();
  const review = page.getByRole("button", { name: "Review selected removals" });
  await review.click();
  await expect(
    page.getByRole("button", { name: "Copy remove command for orphan-000" }),
  ).toBeVisible();
  state.failSnapshot = true;
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(page.getByText("Inventory fixture unavailable", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy remove command for orphan-000" }),
  ).toHaveCount(0);
  await expect(review).toBeDisabled();
  expect((await exportPlan(page)).actionableCommand).toBeNull();
  state.failSnapshot = false;
  state.snapshot.locked = true;
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(review).toBeDisabled();
  state.snapshot.locked = false;
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(review).toBeEnabled();
  state.snapshot.fingerprint = "changed";
  state.report.fingerprint = "changed";
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(page.getByText("0 selected · limit 100")).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy .*remove command/ })).toHaveCount(0);
});

test("selection limit stays at 100 and hidden selections can be removed", async ({ page }) => {
  await fixtures(page, 125);
  await open(page);
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Select this page", exact: true }).click();
    await page.getByRole("button", { name: "Next orphan page" }).click();
  }
  await expect(page.getByText("100 selected · limit 100")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select this page", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Select orphan-100 for removal review" }),
  ).toBeDisabled();
  await page.getByText("Selected packages (100)", { exact: true }).click();
  await page.getByRole("button", { name: "Unselect orphan-000", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Select orphan-100 for removal review" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(page.getByText("0 selected · limit 100")).toBeVisible();
});

test("mismatched target capture and arbitrary command text never create a copy action", async ({
  page,
}) => {
  const state = await fixtures(page);
  await open(page);
  await page.getByRole("checkbox", { name: "Select orphan-000 for removal review" }).check();
  state.customize = (plan) => {
    plan.targets = [{ name: "other", version: "1-1" }];
  };
  await page.getByRole("button", { name: "Review selected removals" }).click();
  await expect(page.getByText(/Removal availability is unknown/)).toBeVisible();
  expect((await exportPlan(page)).actionableCommand).toBeNull();
  state.customize = (plan) => {
    plan.command = "sudo sh -c 'id'";
  };
  await page.getByRole("button", { name: "Review selected removals" }).click();
  await expect(
    page.getByText("Required dependency check passed for this selection."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy .*remove command/ })).toHaveCount(0);
  expect((await exportPlan(page)).actionableCommand).toBeNull();
});

test("ASCII punctuation and case use the core's target ordering", async ({ page }) => {
  const state = await fixtures(page, 4);
  state.report.orphans = ["extra-part", "extra+part", "Extra", "extra_part"].map(pkg);
  state.customize = (plan) => {
    plan.targets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    plan.command = `sudo pacman -R -- ${plan.targets.map((p) => `'${p.name}'`).join(" ")}`;
  };
  await open(page);
  await page.getByRole("button", { name: "Select this page", exact: true }).click();
  await page.getByRole("button", { name: "Review selected removals" }).click();
  await expect(page.getByRole("button", { name: "Copy reviewed removal command" })).toBeVisible();
  expect((await exportPlan(page)).actionableCommand).toBe(
    "sudo pacman -R -- 'Extra' 'extra+part' 'extra-part' 'extra_part'",
  );
});

for (const theme of ["light", "dark"]) {
  test(`${theme} removal review is accessible at 390px`, async ({ page }) => {
    const state = await fixtures(page);
    state.customize = (plan) => {
      plan.optionalImpacts = [
        {
          consumer: "application-with-long-name",
          dependency: "extra-feature>=1",
          description: "Optional application feature",
          removedProviders: plan.targets.map((p) => p.name),
        },
      ];
    };
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
    expect(
      await page
        .getByRole("button", { name: "View orphan-000", exact: true })
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThan(250);
    await page.getByRole("checkbox", { name: "Select orphan-000 for removal review" }).check();
    await page.getByRole("button", { name: "Review selected removals" }).click();
    await expect(page.getByRole("list", { name: "Reviewed removal packages" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `artifacts/removal-${theme}-mobile.png`, fullPage: true });
  });
}
