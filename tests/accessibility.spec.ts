import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
for (const theme of ["light", "dark"] as const) {
  for (const route of ["overview", "security", "packages", "settings"]) {
    test(`${theme} ${route} has no automated WCAG violations`, async ({ page }) => {
      await page.addInitScript(
        (theme) =>
          localStorage.setItem("archhub.preferences", JSON.stringify({ theme, compact: false })),
        theme,
      );
      await page.goto(`/#/${route}`);
      await expect(page.locator("h1")).toBeVisible();
      if (route === "overview")
        await expect(page.getByText(/packages outside coverage/)).toBeVisible();
      if (route === "security") {
        await expect(page.getByRole("heading", { name: "Coverage & limitations" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Run advisory check" })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
      }
      if (route === "packages")
        await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        result.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            detail: node.any.map((check) => check.message),
          })),
        })),
      ).toEqual([]);
    });
  }
}
