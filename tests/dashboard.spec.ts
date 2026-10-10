import { test, expect } from "@playwright/test";
test("real inventory, search, detail evidence, and saved packages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Packages", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Installed packages", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search packages", exact: true }).fill("pacman");
  await page.getByRole("button", { name: "View pacman", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Package information", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Origin & trust" }).click();
  await expect(page.getByText("Trust needs supporting evidence")).toBeVisible();
  await page.getByRole("button", { name: "Save package", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Saved", exact: true }).click();
  await expect(page.getByRole("button", { name: "View pacman", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "View pacman", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("search handles empty results, source filters, and pagination", async ({ page }) => {
  await page.goto("/#/packages");
  await page
    .getByRole("textbox", { name: "Search packages", exact: true })
    .fill("no-package-has-this-archhub-name-12345");
  await expect(page.getByText("No packages found", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("button", { name: "Next page" })).toBeEnabled();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText(/101–200 of/)).toBeVisible();
  await page.getByRole("combobox", { name: "Filter by repository" }).click();
  await page.getByRole("option", { name: "core", exact: true }).click();
  await expect(page.getByText(/1–100 of/)).toBeVisible();
});
test("real advisory check shows explicit coverage and freshness limits", async ({ page }) => {
  await page.goto("/#/security");
  await expect(page.getByRole("heading", { name: "Advisories", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coverage & limitations" })).toBeVisible();
  await expect(page.getByText("Feed publication freshness", { exact: true })).toBeVisible();
  await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("archhub-security-evidence.json");
});
test("failed advisory service shows unknown status and retry", async ({ page }) => {
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "audit")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Advisory feed unavailable during this test" }),
      });
    else await route.continue();
  });
  await page.goto("/#/security");
  await expect(page.getByText("We couldn’t complete this check")).toBeVisible();
  await expect(page.getByText("Advisory feed unavailable during this test")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
test("AUR search and real static recipe scan", async ({ page }) => {
  await page.goto("/#/aur");
  await page.getByRole("textbox", { name: "Search AUR packages" }).fill("visual-studio-code-bin");
  await page.getByRole("button", { name: "View visual-studio-code-bin", exact: true }).click();
  await page.getByRole("tab", { name: "Static scan" }).click();
  await page.getByRole("button", { name: "Fetch & run static scan" }).click();
  await expect(page.getByText(/patterns? requires? review/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Build recipe source")).toBeVisible();
  await expect(page.getByText("Scan limitations", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan" }).click();
  expect((await download).suggestedFilename()).toContain("visual-studio-code-bin");
});
test("update plan is reviewable and exports without applying packages", async ({ page }) => {
  await page.goto("/#/updates");
  await page.getByRole("button", { name: "Create review plan" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Before applying changes" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export review plan" }).click();
  expect((await download).suggestedFilename()).toMatch(/^plan-.*\.json$/);
});
test("keyboard palette and history filters work", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "Search all packages" })).toBeFocused();
  await page.getByRole("textbox", { name: "Search all packages" }).fill("pacman");
  await expect(
    page.getByRole("button", { name: "Open pacman from search", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog").getByText("Package information", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("textbox", { name: "Search package history" }).fill("pacman");
  await expect(
    page.getByText("Most recent 300 events from the last 2 MB of the pacman log."),
  ).toBeVisible();
});
test("custom light/dark and mobile layout remain usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByText(/packages outside coverage/)).toBeVisible();
  await page.screenshot({ path: "artifacts/overview-light.png", fullPage: true });
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.goto("/#/overview");
  await expect(page.getByText(/packages outside coverage/)).toBeVisible();
  await page.screenshot({ path: "artifacts/overview-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Advisories", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "artifacts/security-mobile.png", fullPage: true });
});
test("API rejects stale plans, injection, and unapproved origins", async ({ request }) => {
  for (const payload of [
    { command: "plan", fingerprint: "outdated" },
    { command: "recipe", base: "../etc/passwd" },
    { command: "recipe_review", base: "../etc/passwd" },
    {
      command: "record_recipe_review",
      base: "fixture",
      digest: "unobserved",
      commit: "a".repeat(40),
      note: "A forged review must be rejected.",
    },
    { command: "remove_recipe_review", base: "fixture", digest: "missing", commit: "a".repeat(40) },
    {
      command: "packages",
      query: "",
      scope: "not-valid",
      repository: "all",
      offset: 0,
      limit: 100,
      sort: "name",
    },
  ]) {
    const response = await request.post("/api/query", { data: payload });
    expect(response.status()).toBe(400);
  }
  for (const headers of [
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
  ] as Record<string, string>[]) {
    const response = await request.post("/api/query", {
      data: { command: "snapshot", refresh: false },
      headers,
    });
    expect(response.status()).toBe(403);
  }
});

test("explicit-install filtering applies across the complete inventory", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/query", {
    data: { command: "snapshot", refresh: false },
  });
  const snapshot = (await response.json()) as { explicitCount: number };
  await page.goto("/#/installed");
  await page.getByRole("button", { name: "Explicitly installed", exact: true }).click();
  await expect(
    page.getByText(`${snapshot.explicitCount.toLocaleString()} packages`, { exact: true }),
  ).toBeVisible();
});

test("malformed persisted preferences recover without breaking the app", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("archhub.saved", JSON.stringify({ invalid: true }));
    localStorage.setItem(
      "archhub.preferences",
      JSON.stringify({ theme: "invalid", compact: "yes" }),
    );
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Packages", exact: true }).click();
  await page.getByRole("link", { name: "Saved", exact: true }).click();
  await expect(page.getByText("Your collection starts here")).toBeVisible();
  expect(errors).toEqual([]);
});
