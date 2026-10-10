import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { RemovalTask, RemovalTaskState, RemovalApplyRequest } from "../src/lib/ipc/bindings";
import { fixtures, open } from "./helpers/removal";

async function nativeFixture(page: Page) {
  const data = await fixtures(page, 2);
  const native: RemovalTaskState = { available: true, unavailableReason: null, task: null };
  const state = { native, calls: [] as RemovalApplyRequest[], error: null as string | null };
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string, args: unknown) => {
          const response = await fetch(
            command === "query" ? "/api/query" : "/native-task-fixture",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                command === "query" ? (args as { request: unknown }).request : { command, args },
              ),
            },
          );
          const result = await response.json();
          if (!response.ok) throw result.error;
          return result;
        },
      },
    });
  });
  await page.route("**/native-task-fixture", async (route) => {
    const body = route.request().postDataJSON();
    if (body.command === "removal_task_state") await route.fulfill({ json: state.native });
    else if (body.command === "start_removal_task") {
      state.calls.push(body.args.request);
      if (state.error) await route.fulfill({ status: 400, json: { error: state.error } });
      else {
        state.native.task = {
          id: 1,
          request: body.args.request,
          startedAt: Date.now() / 1000,
          finishedAt: null,
          status: "running",
          outcome: null,
          diagnostics: "",
        };
        await route.fulfill({ json: state.native.task });
      }
    } else
      await route.fulfill({ status: 400, json: { error: `Unexpected command ${body.command}` } });
  });
  return { data, state };
}
async function review(page: Page) {
  await open(page);
  await page.getByRole("checkbox", { name: "Select orphan-000 for removal review" }).check();
  await page.getByRole("button", { name: "Review selected removals", exact: true }).click();
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Remove reviewed packages…", exact: true }).click();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the selection and understand that removal changes the system.",
    })
    .check();
  await page.getByRole("button", { name: "Authenticate and remove", exact: true }).click();
}
function finish(task: RemovalTask, status: string) {
  task.status = status;
  task.finishedAt = Date.now() / 1000;
  task.outcome =
    status === "unknown"
      ? null
      : {
          status,
          targets: task.request.targets,
          remaining: status === "partial" ? task.request.targets : [],
          finishedAt: task.finishedAt,
          message:
            status === "removed"
              ? "Selected packages were removed."
              : status === "rejected"
                ? "Authentication was cancelled; removal was not started."
                : "Removal requires attention; scripts/hooks or package changes may have partially completed.",
        };
  task.diagnostics =
    status === "unknown" ? "Helper ended without a valid outcome. Inspect pacman's log." : "";
}

test("native confirmation requires acknowledgment and sends exact reviewed identities once", async ({
  page,
}) => {
  const { state } = await nativeFixture(page);
  await review(page);
  await page.getByRole("button", { name: "Remove reviewed packages…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("orphan-000", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Authenticate and remove" })).toBeDisabled();
  expect(state.calls).toHaveLength(0);
  await dialog.getByRole("button", { name: "Keep packages" }).click();
  expect(state.calls).toHaveLength(0);
  await confirm(page);
  await expect(page.getByRole("heading", { name: "Removal task running" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove reviewed packages…" })).toBeDisabled();
  expect(state.calls).toEqual([
    {
      protocol: 1,
      targets: [{ name: "orphan-000", version: "1-1" }],
      fingerprint: "removal-fixture",
      executionDigest: "a".repeat(64),
    },
  ]);
});

test("missing helper preserves terminal handoff and browser has no mutation control", async ({
  page,
}) => {
  const { state } = await nativeFixture(page);
  state.native.available = false;
  state.native.unavailableReason =
    "Install the ArchHub system helper package to enable authenticated removal.";
  await review(page);
  await expect(page.getByText(state.native.unavailableReason, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy remove command" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove reviewed packages…" })).toHaveCount(0);
  expect(state.calls).toHaveLength(0);
});

for (const status of ["removed", "rejected", "partial", "unknown"]) {
  test(`native ${status} outcome survives navigation, invalidates review, and never retries`, async ({
    page,
  }) => {
    const { state, data } = await nativeFixture(page);
    await review(page);
    await confirm(page);
    await expect(page.getByRole("heading", { name: "Removal task running" })).toBeVisible();
    await page.goto("/#/history");
    await expect(page.getByRole("heading", { name: "Removal task running" })).toBeVisible();
    finish(state.native.task!, status);
    await expect(
      page.getByRole("heading", {
        name:
          status === "removed"
            ? "Packages removed"
            : status === "rejected"
              ? "Removal not started"
              : "Removal needs attention",
      }),
    ).toBeVisible();
    await expect
      .poll(() => data.requests.filter((r) => r.command === "snapshot").length)
      .toBeGreaterThan(1);
    expect(state.calls).toHaveLength(1);
    if (status === "partial")
      await expect(page.getByText("Still installed: orphan-000 1-1")).toBeVisible();
    if (status === "unknown")
      await expect(page.getByText("The outcome is unknown.", { exact: false })).toBeVisible();
    await review(page);
    await expect(page.getByRole("button", { name: "Copy remove command" })).toBeVisible();
    // Reopening the observer must not invalidate a newly reviewed plan again.
    await page.goto("/#/history");
    await page.goto("/#/maintenance");
    await page.getByRole("tab", { name: "Orphans", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select orphan-000 for removal review" }).check();
    await expect(page.getByRole("button", { name: "Copy remove command" })).toBeVisible();
    expect(state.calls).toHaveLength(1);
  });
}

test("native preflight error leaves confirmation open and does not start a task", async ({
  page,
}) => {
  const { state } = await nativeFixture(page);
  state.error = "The reviewed removal changed or is blocked. Review again before authentication.";
  await review(page);
  await confirm(page);
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(state.error);
  await expect(page.getByRole("heading", { name: "Removal task running" })).toHaveCount(0);
  expect(state.calls).toHaveLength(1);
});

test("confirmation is withheld when snapshot refresh fails, and fits mobile with accessible controls", async ({
  page,
}) => {
  const { data, state } = await nativeFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await review(page);
  await page.getByRole("button", { name: "Remove reviewed packages…" }).click();
  await expect(page.getByRole("button", { name: "Authenticate and remove" })).toBeDisabled();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: "artifacts/removal-confirmation-mobile.png" });
  await page.getByRole("button", { name: "Keep packages" }).click();
  data.failSnapshot = true;
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove reviewed packages…" })).toBeDisabled();
  expect(state.calls).toHaveLength(0);
});
