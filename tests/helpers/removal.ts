import type { Page } from "@playwright/test";
import type {
  MaintenanceReport,
  Package,
  RemovalPlan,
  RemovalTarget,
  Snapshot,
} from "../../src/lib/ipc/bindings";
const stamp = Date.now() / 1000;
export function pkg(name: string): Package {
  return {
    id: `local/${name}`,
    name,
    version: "1-1",
    installedVersion: "1-1",
    repository: "local",
    description: `Description of ${name}`,
    updateAvailable: false,
    installedSize: 1234,
    downloadSize: 0,
    url: null,
    licenses: [],
    dependencies: [],
    groups: [],
    architecture: "any",
    explicit: false,
    signature: "unknown",
    packageBase: null,
    maintainer: null,
    votes: null,
    outOfDate: false,
    lastModified: null,
  };
}
export async function fixtures(page: Page, count = 29) {
  const snapshot: Snapshot = {
    capturedAt: stamp,
    fingerprint: "removal-fixture",
    hostname: "fixture",
    installedCount: count,
    explicitCount: 0,
    foreignCount: count,
    updateCount: 0,
    installedSize: count * 1234,
    locked: false,
    omarchy: false,
    repositories: [],
    signaturePolicy: [],
    warnings: [],
  };
  const orphans = Array.from({ length: count }, (_, i) =>
    pkg(`orphan-${String(i).padStart(3, "0")}`),
  );
  const report: MaintenanceReport = {
    capturedAt: stamp,
    fingerprint: snapshot.fingerprint,
    orphans,
    largest: orphans.slice(0, 20),
    foreign: [],
    caches: [],
    checkupdatesAvailable: false,
    paccacheAvailable: false,
    aurHelper: null,
    limitations: [],
  };
  const state = {
    snapshot,
    report,
    requests: [] as { command: string; targets?: RemovalTarget[]; fingerprint?: string }[],
    fail: false,
    failSnapshot: false,
    hold: null as Promise<void> | null,
    customize: (_plan: RemovalPlan) => {},
  };
  await page.route("**/api/query", async (route) => {
    const body = route.request().postDataJSON();
    state.requests.push(body);
    if (body.command === "snapshot") {
      if (state.failSnapshot)
        await route.fulfill({ status: 503, json: { error: "Inventory fixture unavailable" } });
      else await route.fulfill({ json: state.snapshot });
    } else if (body.command === "maintenance") await route.fulfill({ json: state.report });
    else if (body.command === "packages")
      await route.fulfill({
        json: { items: orphans, total: orphans.length, offset: 0, limit: 100, capturedAt: stamp },
      });
    else if (body.command === "history") await route.fulfill({ json: [] });
    else if (body.command === "removal_plan") {
      await state.hold;
      if (state.fail)
        await route.fulfill({ status: 400, json: { error: "Removal fixture failed" } });
      else {
        const targets: RemovalTarget[] = body.targets;
        const plan: RemovalPlan = {
          capturedAt: stamp,
          fingerprint: body.fingerprint,
          targets,
          packages: targets.map((p) => pkg(p.name)),
          installedSize: targets.length * 1234,
          executionDigest: "a".repeat(64),
          executionUnavailableReason: null,
          dependencyCheckPassed: true,
          blockers: [],
          heldPackages: [],
          optionalImpacts: [],
          command: `sudo pacman -R -- ${targets.map((p) => `'${p.name}'`).join(" ")}`,
          limitations: ["Read-only preparation; pacman checks again when run."],
        };
        state.customize(plan);
        await route.fulfill({ json: plan });
      }
    } else await route.continue();
  });
  return state;
}
export async function open(page: Page) {
  await page.goto("/#/maintenance");
  await page.getByRole("tab", { name: "Orphans", exact: true }).click();
}
