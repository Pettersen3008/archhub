import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

test("six main areas retain package scopes, security tools and deep links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main areas", exact: true });
  await expect(navigation.getByRole("button")).toHaveCount(6);
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  const scopes = page.getByRole("navigation", { name: "Package views", exact: true });
  await expect(scopes.getByRole("link")).toHaveCount(5);
  await scopes.getByRole("link", { name: "AUR & static scans", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Search AUR packages", exact: true }),
  ).toBeVisible();
  await scopes.getByRole("link", { name: "Foreign", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Foreign packages", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Packages", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/#/dependencies?q=pacman");
  await expect(
    page.getByRole("textbox", { name: "Search installed packages", exact: true }),
  ).toHaveValue("pacman");
  await expect(navigation.getByRole("button", { name: "Security", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Security tools" })
      .getByRole("link", { name: "Dependency paths", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("mobile navigation traps focus, closes with Escape and returns focus to its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Packages", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Installed packages", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Package views" })
    .getByRole("link", { name: "Saved", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Saved packages", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("switching update views preserves captured evidence and collapsed metadata remains in exports", async ({
  page,
}) => {
  await page.goto("/#/updates");
  await expect(
    page.getByRole("button", { name: "Compare package", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("tab", { name: "Compare package", exact: true }).click();
  await page.getByRole("button", { name: "Compare package", exact: true }).click();
  await expect(page.getByRole("heading", { name: "pacman · candidate review" })).toBeVisible();
  await expect(page.getByText("Declared SHA-256 · bytes unverified")).not.toBeVisible();
  await page.getByRole("tab", { name: "Version changes", exact: true }).click();
  await page.getByRole("tab", { name: "Compare package", exact: true }).click();
  await expect(page.getByRole("heading", { name: "pacman · candidate review" })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export comparison", exact: true }).click();
  const output = JSON.parse(await readFile((await (await pending).path())!, "utf8"));
  expect(output.comparison.name).toBe("pacman");
  expect(output.comparison.changes).toHaveLength(5);
  expect(output.comparison.declaredSha256).toMatch(/^[a-f0-9]{64}$/);
});

test("failed forced advisory refresh clears current results and disables clean-looking exports", async ({
  page,
}) => {
  let fingerprint = "";
  let snapshotReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    snapshotReady = resolve;
  });
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "snapshot") {
      const response = await route.fetch();
      const data = await response.json();
      fingerprint = data.fingerprint;
      snapshotReady();
      await route.fulfill({ response, json: data });
    } else if (body.command === "audit") {
      await ready;
      if (body.refresh)
        await route.fulfill({ status: 503, json: { error: "Feed failed during forced refresh" } });
      else
        await route.fulfill({
          json: {
            scannedAt: 1791230000,
            source: "Fixture",
            sourceUrl: "https://security.archlinux.org/all.json",
            checkedPackages: 100,
            uncoveredPackages: 3,
            findings: [],
            limitations: [],
            fingerprint,
          },
        });
    } else await route.continue();
  });
  await page.goto("/#/security");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Run advisory check", exact: true }).click();
  await expect(page.getByText("Feed failed during forced refresh")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  await expect(
    page.getByText("No matches in the available evidence", { exact: true }),
  ).not.toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`${theme} redesigned mobile shell and update views are accessible`, async ({ page }) => {
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: true }),
        ),
      theme,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["overview", "updates", "settings"]) {
      await page.goto(`/#/${route}`);
      await expect(page.locator("h1")).toBeVisible();
      await expect
        .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
        .toBe(theme === "dark");
      await page.evaluate(() => document.fonts.ready);
      if (route === "overview") {
        await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
        await expect(page.getByText(/packages outside coverage/)).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: `artifacts/redesign-${route}-${theme}-mobile.png`,
        fullPage: true,
      });
    }
  });
}
