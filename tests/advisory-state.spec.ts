import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type {
  Audit,
  DependencyReport,
  Package,
  PackageComparison,
  Snapshot,
  UpdatePlan,
} from "../src/lib/ipc/bindings";

const stamp = 1791220000;
const snapshot: Snapshot = {
  capturedAt: stamp,
  fingerprint: "shared-advisory-fixture",
  hostname: "fixture",
  installedCount: 1,
  explicitCount: 1,
  foreignCount: 0,
  updateCount: 1,
  installedSize: 0,
  repositories: [],
  warnings: [],
  locked: false,
  omarchy: true,
  signaturePolicy: [],
};
const pkg: Package = {
  id: "core:pacman",
  name: "pacman",
  version: "2-1",
  description: "Fixture package",
  repository: "core",
  installedVersion: "1-1",
  updateAvailable: true,
  installedSize: 0,
  downloadSize: 0,
  url: null,
  licenses: [],
  dependencies: [],
  groups: [],
  architecture: "x86_64",
  explicit: true,
  signature: "unknown",
  packageBase: null,
  maintainer: null,
  votes: null,
  outOfDate: false,
  lastModified: null,
};
const graph: DependencyReport = {
  root: {
    name: "pacman",
    version: "1-1",
    repository: "core",
    explicit: true,
    signature: "unknown",
  },
  capturedAt: stamp,
  fingerprint: snapshot.fingerprint,
  direct: [],
  optional: [],
  requires: [],
  requiredBy: [],
  unresolved: [],
  requiresComplete: true,
  requiredByComplete: true,
  limitations: ["Captured metadata only"],
};
const comparison: PackageComparison = {
  name: "pacman",
  repository: "core",
  installedVersion: "1-1",
  candidateVersion: "2-1",
  versionRelation: "newer",
  installedArchitecture: "x86_64",
  candidateArchitecture: "x86_64",
  installedValidation: "unknown",
  filename: null,
  declaredSha256: null,
  embeddedSignature: false,
  capturedAt: stamp,
  fingerprint: snapshot.fingerprint,
  complete: true,
  changes: [],
  limitations: ["Candidate archive is not audited"],
};
function capture(title = "Earlier captured advisory", matches = true): Audit {
  return {
    scannedAt: stamp + 1,
    fingerprint: snapshot.fingerprint,
    source: "Fixture feed",
    sourceUrl: "https://security.archlinux.org/all.json",
    checkedPackages: 1,
    uncoveredPackages: 0,
    limitations: ["Publication freshness unknown"],
    findings: matches
      ? [
          {
            id: "ASA-fixture:pacman",
            package: "pacman",
            severity: "high",
            title,
            description: "Installed-version fixture",
            installedVersion: "1-1",
            fixedVersion: "2-1",
            confidence: "version-match",
            cves: [],
            url: null,
            file: null,
            line: null,
          },
        ]
      : [],
  };
}
async function fixtures(page: Page) {
  let result = capture();
  let error: string | null = null;
  let hold: Promise<void> | null = null;
  const auditRequests: boolean[] = [];
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    switch (body.command) {
      case "snapshot":
        return route.fulfill({ json: snapshot });
      case "packages":
        return route.fulfill({ json: { items: [pkg], total: 1, offset: 0, limit: 100 } });
      case "history":
        return route.fulfill({ json: [] });
      case "dependencies":
        return route.fulfill({ json: graph });
      case "comparison":
        return route.fulfill({ json: comparison });
      case "audit":
        auditRequests.push(body.refresh);
        await hold;
        return error
          ? route.fulfill({ status: 503, json: { error } })
          : route.fulfill({ json: result });
      default:
        return route.continue();
    }
  });
  return {
    auditRequests,
    fail: () => {
      error = "Shared advisory check unavailable";
    },
    succeed: (next = capture("Replacement captured advisory")) => {
      error = null;
      result = next;
    },
    hold: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        release();
        hold = null;
      };
    },
  };
}
async function navigate(page: Page, route: string) {
  await page.evaluate((value) => {
    window.location.hash = `/${value}`;
  }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
}
async function exported(page: Page, name: string) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}
async function inspect(page: Page) {
  await navigate(page, "dependencies");
  await page.getByRole("button", { name: "Inspect dependencies", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Installed paths · pacman" })).toBeVisible();
}
async function compare(page: Page) {
  await navigate(page, "updates");
  await page.getByRole("tab", { name: "Compare package", exact: true }).click();
  await page.getByRole("button", { name: "Compare package", exact: true }).click();
  await expect(page.getByRole("heading", { name: "pacman · candidate review" })).toBeVisible();
}
async function overviewUnknown(page: Page, pending = false) {
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  const metric = page.getByRole("button").filter({ hasText: "Advisory matches" });
  await expect(metric).toContainText("—");
  await expect(
    page.getByRole("button", { name: "Installed-version advisories", exact: true }),
  ).toContainText(pending ? "Checking the Arch feed…" : "Current advisory evidence unavailable");
  await expect(page.getByText("Advisory coverage unknown", { exact: true })).toBeVisible();
  await expect(page.getByText("Latest advisory matches", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toHaveCount(0);
}

test("failed advisory check remains unknown across navigation until a successful retry", async ({
  page,
}) => {
  const api = await fixtures(page);
  await page.goto("/#/security");
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
  api.fail();
  await page.getByRole("button", { name: "Run advisory check", exact: true }).click();
  await expect(page.getByText("Shared advisory check unavailable", { exact: true })).toBeVisible();
  await navigate(page, "overview");
  await overviewUnknown(page);
  await navigate(page, "security");
  await expect(page.getByText("Shared advisory check unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  expect(api.auditRequests).toEqual([false, true]);
  api.succeed(capture("unused", false));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("No matches in the available evidence", { exact: true }),
  ).toBeVisible();
  expect((await exported(page, "Export")).findings).toEqual([]);
  await navigate(page, "overview");
  await expect(page.getByRole("button").filter({ hasText: "Advisory matches" })).toContainText("0");
  await expect(
    page.getByRole("button", { name: "Installed-version advisories", exact: true }),
  ).toHaveCount(0);
  expect(api.auditRequests).toEqual([false, true, true]);
});

test("in-flight advisory checks survive a page with no observer and replace cached evidence once", async ({
  page,
}) => {
  const api = await fixtures(page);
  await page.goto("/#/security");
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
  const release = api.hold();
  api.succeed();
  try {
    await page.getByRole("button", { name: "Run advisory check", exact: true }).click();
    await expect.poll(() => api.auditRequests).toEqual([false, true]);
    await navigate(page, "history");
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await navigate(page, "overview");
    await overviewUnknown(page, true);
    release();
    await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
    await navigate(page, "security");
    await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
    expect((await exported(page, "Export")).findings[0].title).toBe(
      "Replacement captured advisory",
    );
    expect(api.auditRequests).toEqual([false, true]);
  } finally {
    release();
  }
});

test("pending dependency rechecks withhold advisory conclusions and exports across workspaces", async ({
  page,
}) => {
  const api = await fixtures(page);
  await page.goto("/#/dependencies");
  await page.getByRole("button", { name: "Inspect dependencies", exact: true }).click();
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
  const release = api.hold();
  api.fail();
  try {
    await page.getByRole("button", { name: "Refresh advisories", exact: true }).click();
    await expect(page.getByText("Earlier captured advisory", { exact: true })).toHaveCount(0);
    const pending = await exported(page, "Export dependency evidence");
    expect(pending.graph).toEqual(graph);
    expect(pending.advisories.state).toBe("unknown");
    expect(pending.advisories.findings).toEqual([]);
    expect(pending.advisories.reason).toContain("being checked");
    await compare(page);
    await expect(
      page.getByRole("button", { name: "Advisory check running…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Check advisories", exact: true }),
    ).toBeDisabled();
    await expect(page.getByText("Not checked for this comparison", { exact: true })).toBeVisible();
    const output = await exported(page, "Export comparison");
    expect(output.comparison).toEqual(comparison);
    expect(output.advisoryState).toBe("unknown");
    expect(output.audit).toBeNull();
    await navigate(page, "overview");
    await overviewUnknown(page, true);
    release();
    await overviewUnknown(page);
    await navigate(page, "security");
    await expect(
      page.getByText("Shared advisory check unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
    expect(api.auditRequests).toEqual([false, true]);
    api.succeed();
    await page.getByRole("button", { name: "Run advisory check", exact: true }).click();
    await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
    await inspect(page);
    await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
    expect((await exported(page, "Export dependency evidence")).advisories.state).toBe("matching");
    expect(api.auditRequests).toEqual([false, true, true]);
  } finally {
    release();
  }
});

test("candidate recheck failures are shared while metadata remains exportable", async ({
  page,
}) => {
  const api = await fixtures(page);
  await page.goto("/#/updates");
  await compare(page);
  await page.getByRole("button", { name: "Check advisories", exact: true }).click();
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
  api.fail();
  await page.getByRole("button", { name: "Recheck advisories", exact: true }).click();
  await expect(
    page.getByText(/Advisory status unknown · Shared advisory check unavailable/),
  ).toBeVisible();
  const failed = await exported(page, "Export comparison");
  expect(failed.comparison).toEqual(comparison);
  expect(failed.audit).toBeNull();
  await navigate(page, "overview");
  await overviewUnknown(page);
  await navigate(page, "security");
  await expect(page.getByText("Shared advisory check unavailable", { exact: true })).toBeVisible();
  api.succeed();
  await compare(page);
  await page.getByRole("button", { name: "Check advisories", exact: true }).click();
  await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
  expect((await exported(page, "Export comparison")).audit.findings[0].title).toBe(
    "Replacement captured advisory",
  );
  expect(api.auditRequests).toEqual([false, true, true]);
});

for (const theme of ["light", "dark"]) {
  test(`${theme} pending and failed advisory overview is accessible at 390px`, async ({ page }) => {
    const api = await fixtures(page);
    await page.addInitScript(
      (value) =>
        localStorage.setItem(
          "archhub.preferences",
          JSON.stringify({ theme: value, compact: true }),
        ),
      theme,
    );
    await page.goto("/#/security");
    await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
    const release = api.hold();
    api.fail();
    try {
      await page.getByRole("button", { name: "Run advisory check", exact: true }).click();
      await navigate(page, "overview");
      await overviewUnknown(page, true);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      for (const state of ["pending", "failed"]) {
        if (state === "failed") {
          release();
          await overviewUnknown(page);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          390,
        );
        expect(
          (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
            .violations,
        ).toEqual([]);
        await page.screenshot({
          path: `artifacts/advisory-state-${theme}-${state}-390.png`,
          fullPage: true,
        });
      }
    } finally {
      release();
    }
  });
}

test("a paused background check withholds cached conclusions and resumes once online", async ({
  page,
  context,
}) => {
  const api = await fixtures(page);
  await page.goto("/#/security");
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
  api.succeed();
  await page.clock.install();
  await navigate(page, "updates");
  await page.clock.fastForward(300_001);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  try {
    await navigate(page, "security");
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
    await expect(page.getByText("Earlier captured advisory", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Waiting for network access…", { exact: true })).toBeVisible();
    await navigate(page, "overview");
    await expect(page.getByRole("button").filter({ hasText: "Advisory matches" })).toContainText(
      "—",
    );
    await expect(
      page.getByRole("button", { name: "Installed-version advisories", exact: true }),
    ).toContainText("Waiting for network access…");
    expect(api.auditRequests).toEqual([false]);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
    await navigate(page, "security");
    expect((await exported(page, "Export")).findings[0].title).toBe(
      "Replacement captured advisory",
    );
    expect(api.auditRequests).toEqual([false, false]);
  } finally {
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
});

for (const available of [true, false]) {
  test(`plan advisory attempt shares pending and ${available ? "successful" : "failed"} state without another audit request`, async ({
    page,
  }) => {
    const api = await fixtures(page);
    const audit = capture("Plan captured advisory");
    const value: UpdatePlan = {
      id: "shared-state-plan",
      createdAt: stamp,
      fingerprint: snapshot.fingerprint,
      packages: [pkg],
      comparisons: [comparison],
      comparisonsComplete: true,
      downloadSize: 0,
      command: "omarchy update",
      preconditions: [],
      limitations: ["Read-only fixture"],
      security: available
        ? { audit, unavailableReason: null, findings: [] }
        : { audit: null, unavailableReason: "Plan advisory fixture unavailable", findings: [] },
    };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let plans = 0;
    await page.route("**/api/query", async (route) => {
      if (route.request().postDataJSON().command !== "plan") return route.fallback();
      plans++;
      await held;
      return route.fulfill({ json: value });
    });
    await page.goto("/#/security");
    await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
    try {
      await navigate(page, "updates");
      await page.getByRole("button", { name: "Create review plan", exact: true }).click();
      await expect.poll(() => plans).toBe(1);
      await navigate(page, "overview");
      await overviewUnknown(page, true);
      release();
      if (available) {
        await expect(page.getByText("Plan captured advisory", { exact: true })).toBeVisible();
        await navigate(page, "security");
        expect(await exported(page, "Export")).toEqual(audit);
      } else {
        await overviewUnknown(page);
        await navigate(page, "security");
        await expect(
          page.getByText("Plan advisory fixture unavailable", { exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
      }
      expect(api.auditRequests).toEqual([false]);
      expect(plans).toBe(1);
      await navigate(page, "updates");
      await page.getByRole("button", { name: "Create review plan", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByRole("button", { name: "Export review plan", exact: true }),
      ).toBeVisible();
      expect(await exported(page, "Export review plan")).toEqual(value);
      expect(plans).toBe(2);
      expect(api.auditRequests).toEqual([false]);
    } finally {
      release();
    }
  });
}

test("an explicit offline check fails visibly and retries the forced operation", async ({
  page,
  context,
}) => {
  const api = await fixtures(page);
  const attempted: boolean[] = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/api/query")) return;
    const body = request.postDataJSON();
    if (body.command === "audit") attempted.push(body.refresh);
  });
  await page.goto("/#/security");
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
  let offline = true;
  // Fulfilled routes can bypass Chromium's offline transport. Let this request
  // reach the browser network layer so both engines test a real local fetch failure.
  await page.route("**/api/query", (route) => {
    const body = route.request().postDataJSON();
    return body.command === "audit" && body.refresh && offline
      ? route.continue()
      : route.fallback();
  });
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  try {
    await page.getByRole("button", { name: "Run advisory check", exact: true }).click();
    await expect(page.getByRole("alert").getByRole("paragraph")).toHaveText(
      /NetworkError|Failed to fetch/,
    );
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
    await navigate(page, "overview");
    await overviewUnknown(page);
    expect(api.auditRequests).toEqual([false]);
    expect(attempted).toEqual([false, true]);
    offline = false;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await navigate(page, "security");
    await expect(page.getByRole("alert").getByRole("paragraph")).toHaveText(
      /NetworkError|Failed to fetch/,
    );
    expect(api.auditRequests).toEqual([false]);
    expect(attempted).toEqual([false, true]);
    api.succeed();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
    expect(api.auditRequests).toEqual([false, true]);
    expect(attempted).toEqual([false, true, true]);
  } finally {
    offline = false;
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
});

test("native string IPC failures preserve useful details across audit consumers", async ({
  page,
}) => {
  const api = await fixtures(page);
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { request: unknown }) => {
          if (command !== "query") throw "Unexpected native command in fixture";
          const response = await fetch("/api/query", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args.request),
          });
          const value = await response.json();
          if (!response.ok) throw value.error;
          return value;
        },
      },
    });
  });
  await page.goto("/#/security");
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toBeVisible();
  api.fail();
  await page.getByRole("button", { name: "Run advisory check", exact: true }).click();
  await expect(page.getByText("Shared advisory check unavailable", { exact: true })).toBeVisible();
  await navigate(page, "overview");
  await overviewUnknown(page);
  await inspect(page);
  await expect(page.getByRole("alert")).toHaveText("Shared advisory check unavailable");
  await expect(page.getByText("Earlier captured advisory", { exact: true })).toHaveCount(0);
  await compare(page);
  await page.getByRole("button", { name: "Check advisories", exact: true }).click();
  await expect(
    page.getByText("Advisory status unknown · Shared advisory check unavailable", { exact: true }),
  ).toBeVisible();
  api.succeed();
  await page.getByRole("button", { name: "Recheck advisories", exact: true }).click();
  await expect(page.getByText("Replacement captured advisory", { exact: true })).toBeVisible();
});
