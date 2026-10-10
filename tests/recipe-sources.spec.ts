import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  RecipeReview,
  RecipeScan,
  RecipeSource,
  RecipeSourceEvidence,
} from "../src/lib/ipc/bindings";
const base = "archhub-source-fixture";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function row(index: number): RecipeSource {
  return {
    declaration: `https://example.test/source-${index}.tar.xz`,
    architecture: index % 2 ? "x86_64" : null,
    line: index === 54 ? 450 : index + 2,
    name: `source-${index}.tar.xz`,
    location: `https://example.test/source-${index}.tar.xz`,
    kind: "download",
    transport: "https",
    reference: null,
    signedCheckout: false,
    signatureFor: [],
    checksums: [
      {
        algorithm: "sha256sums",
        architecture: index % 2 ? "x86_64" : null,
        value: "a".repeat(64),
        line: index + 100,
        state: "declared",
      },
    ],
    notes: [],
  };
}
function evidence(): RecipeSourceEvidence {
  const sources = Array.from({ length: 55 }, (_, index) => row(index));
  sources[1] = {
    ...sources[1]!,
    kind: "vcs",
    name: "project.git",
    location: "git+https://example.test/project#tag=v1?signed",
    declaration: "git+https://example.test/project#tag=v1?signed",
    reference: { kind: "tag", value: "v1", fullCommit: false },
    signedCheckout: true,
    checksums: [
      {
        algorithm: "sha256sums",
        architecture: "x86_64",
        value: "SKIP",
        line: 102,
        state: "skipped",
      },
    ],
    notes: ["A tag reference can move. No checkout was verified."],
  };
  sources[2] = {
    ...sources[2]!,
    kind: "signature",
    name: "source-0.tar.xz.sig",
    location: "https://example.test/source-0.tar.xz.sig",
    signatureFor: [2],
    checksums: [],
  };
  sources[3] = {
    ...sources[3]!,
    kind: "unknown",
    name: "$dynamic",
    location: "$(not-executed)",
    checksums: [
      {
        algorithm: "md5sums",
        architecture: "x86_64",
        value: "invalid",
        line: 104,
        state: "invalid",
      },
    ],
    notes: ["Unsupported declaration; interpretation is unknown."],
  };
  const metadata = Array.from({ length: 600 }, (_, i) => `# metadata line ${i + 1}`).join("\n");
  return {
    analyzerVersion: 1,
    metadataDigest: hash(metadata),
    complete: false,
    sources,
    signingKeys: [
      { value: "A".repeat(40), line: 550, fullFingerprint: true },
      { value: "short", line: 551, fullFingerprint: false },
    ],
    unassignedChecksums: [
      {
        algorithm: "sha256sums",
        architecture: "aarch64",
        value: "b".repeat(64),
        line: 552,
        state: "unaligned",
      },
    ],
    warnings: ["sha256sums_aarch64 has one value for no sources. Associations are unknown."],
    limitations: ["Declarations only. No source bytes, signatures or keys were verified."],
  };
}
function capture(value: RecipeSourceEvidence | null = evidence()): RecipeScan {
  const content = Array.from({ length: 600 }, (_, i) => `# metadata line ${i + 1}`).join("\n");
  return {
    packageBase: base,
    scannedAt: 1791200000,
    digest: "a".repeat(64),
    commit: "b".repeat(40),
    files: [
      {
        path: "PKGBUILD",
        role: "build",
        content: "pkgname=fixture\n",
        digest: hash("pkgname=fixture\n"),
      },
      { path: ".SRCINFO", role: "metadata", content, digest: hash(content) },
    ],
    complete: true,
    warnings: [],
    url: `https://aur.archlinux.org/packages/${base}`,
    findings: [],
    limitations: ["Recipes are never executed."],
    sourceEvidence: value,
  };
}
async function fixture(page: Page, source: RecipeSourceEvidence | null = evidence()) {
  await page.goto("about:blank");
  let scan = capture(source),
    fail = false;
  const saved: RecipeReview = {
    scan,
    reviewedAt: 1791200100,
    note: "Saved fixture review for source declaration inspection.",
  };
  const summary = {
    packageBase: base,
    commit: scan.commit,
    digest: scan.digest,
    scannedAt: scan.scannedAt,
    reviewedAt: saved.reviewedAt,
    note: saved.note,
    fileCount: scan.files.length,
    findingCount: 0,
  };
  await page.route("**/api/query", async (route) => {
    const input = route.request().postDataJSON();
    let result: unknown;
    if (input.command === "recipe_reviews") result = [summary];
    else if (input.command === "recipe_review") result = saved;
    else if (input.command === "recipe") {
      if (fail) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Source fetch failed during this test" }),
        });
        return;
      }
      result = { scan, baseline: summary, status: "changed", changes: [] };
    } else {
      await route.continue();
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.goto("/#/reviews");
  await page.getByRole("button", { name: `Open saved review for ${base}` }).click();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  return {
    fail: () => {
      fail = true;
    },
    change: (value: RecipeScan) => {
      scan = value;
    },
  };
}
async function exportScan(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scan", exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}

test("real pinned sources retain raw identity in exports and jump to metadata", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  await page.goto("/#/aur");
  await page.getByRole("textbox", { name: "Search AUR packages" }).fill("visual-studio-code-bin");
  await page.getByRole("button", { name: "View visual-studio-code-bin", exact: true }).click();
  await page.getByRole("tab", { name: "Static scan", exact: true }).click();
  await page.getByRole("button", { name: "Fetch & run static scan" }).click();
  await expect(page.getByText(/patterns? requires? review/)).toBeVisible({ timeout: 30000 });
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await expect(page.getByText("Source bytes not verified", { exact: true })).toBeVisible();
  const report = (await exportScan(page)).scan as RecipeScan;
  expect(report.sourceEvidence?.sources.length).toBeGreaterThan(0);
  const metadata = report.files.find((f) => f.path === ".SRCINFO")!;
  expect(report.sourceEvidence!.metadataDigest).toBe(hash(metadata.content));
  expect(report.commit).toMatch(/^[a-f0-9]{40}$/);
  const source = report.sourceEvidence!.sources[0]!;
  expect(metadata.content.split("\n")[source.line - 1]).toContain(source.declaration);
  await page
    .getByRole("button", { name: `Inspect source line ${source.line}`, exact: true })
    .click();
  await expect(page.getByRole("combobox", { name: "Build file" })).toContainText(".SRCINFO");
  await expect(page.getByLabel("Build recipe source")).toBeFocused();
  expect(requests.every((url) => new URL(url).origin === "http://127.0.0.1:1420")).toBe(true);
});

test("source filtering and pages preserve all capture evidence and navigate late source lines", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.getByText("1–25 of 55 sources", { exact: true })).toBeVisible();
  await expect(page.getByText("Mutable or partial reference", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Signed checkout requested · verification not performed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Possible signature for source line 2 · not verified", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next sources page" }).click();
  await page.getByRole("button", { name: "Next sources page" }).click();
  await expect(page.getByText("51–55 of 55 sources", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect source line 450", exact: true }).click();
  await expect(page.getByLabel("Build recipe source")).toBeFocused();
  await expect(page.getByText("Lines 401–600 of 600", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page.getByRole("textbox", { name: "Search source declarations" }).fill("source-54.tar.xz");
  await expect(page.getByText("1 of 55 captured sources", { exact: true })).toBeVisible();
  const exported = await exportScan(page);
  expect(exported.scan.sourceEvidence.sources).toHaveLength(55);
  expect(exported.status).toBe("saved-current-unknown");
  await page.getByRole("textbox", { name: "Search source declarations" }).fill("");
  await page.getByRole("combobox", { name: "Filter source declarations" }).click();
  await page.getByRole("option", { name: "Unknown sources", exact: true }).click();
  await expect(page.getByText("1 of 55 captured sources", { exact: true })).toBeVisible();
  await expect(page.getByText("$dynamic", { exact: true })).toBeVisible();
  await page.getByText("1 checksum declaration", { exact: true }).click();
  await expect(page.getByText("Invalid value", { exact: true })).toBeVisible();
});

test("keys and unassigned checksums keep uncertainty visible with precise metadata jumps", async ({
  page,
}) => {
  await fixture(page);
  await page.getByText("Signing-key fingerprints · 2", { exact: true }).click();
  await expect(page.getByText("Full fingerprint declared", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsupported fingerprint", { exact: true })).toBeVisible();
  await page.getByText("Unassigned checksum values · 1", { exact: true }).click();
  await expect(page.getByText("Unaligned array", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect checksum line 552", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Build file" })).toContainText(".SRCINFO");
  await expect(page.getByText("Lines 401–600 of 600", { exact: true })).toBeVisible();
});

test("failed current fetch leaves saved declarations explicit and missing analysis stays unknown", async ({
  page,
}) => {
  const api = await fixture(page);
  api.fail();
  await page.getByRole("button", { name: "Fetch & run static scan" }).click();
  await expect(
    page.getByRole("dialog").getByText("Source fetch failed during this test", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Captured snapshot · the current recipe is unknown/)).toBeVisible();
  expect((await exportScan(page)).status).toBe("saved-current-unknown");
  await page.unroute("**/api/query");
  await fixture(page, null);
  await expect(page.getByText("Source evidence is unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Metadata extracted", { exact: true })).toHaveCount(0);
});

test("empty metadata and bounded partial evidence use distinct states and paged keys", async ({
  page,
}) => {
  await fixture(page, {
    ...evidence(),
    sources: [],
    complete: true,
    warnings: [],
    signingKeys: [],
    unassignedChecksums: [],
  });
  await expect(
    page.getByText("No sources declared in this capture", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Metadata extracted", { exact: true })).toBeVisible();
  await expect(page.getByText("Source bytes not verified", { exact: true })).toBeVisible();
  await page.unroute("**/api/query");
  const data = {
    ...evidence(),
    warnings: Array.from({ length: 51 }, (_, i) => `Metadata warning ${i}`),
    signingKeys: Array.from({ length: 60 }, (_, i) => ({
      value: "A".repeat(40),
      line: 500 + i,
      fullFingerprint: true,
    })),
    unassignedChecksums: Array.from({ length: 60 }, (_, i) => ({
      algorithm: "sha256sums",
      architecture: "aarch64",
      value: "b".repeat(64),
      line: 300 + i,
      state: "unaligned",
    })),
  };
  await fixture(page, data);
  await expect(page.getByText("Metadata extraction incomplete", { exact: true })).toBeVisible();
  await expect(page.getByText(/Showing 10 of 51 captured warnings/)).toBeVisible();
  await page.getByText("Signing-key fingerprints · 60", { exact: true }).click();
  await page.getByRole("button", { name: "Next signing keys page" }).click();
  await expect(page.getByText("26–50 of 60 signing keys", { exact: true })).toBeVisible();
  await page.getByText("Unassigned checksum values · 60", { exact: true }).click();
  await page.getByRole("button", { name: "Next unassigned checksums page" }).click();
  await expect(page.getByText("26–50 of 60 unassigned checksums", { exact: true })).toBeVisible();
  expect((await exportScan(page)).scan.sourceEvidence.warnings).toHaveLength(51);
});
for (const theme of ["light", "dark"] as const) {
  test(`${theme} source evidence remains accessible and usable at 390px`, async ({ page }) => {
    await page.addInitScript(
      (theme) =>
        localStorage.setItem("archhub.preferences", JSON.stringify({ theme, compact: false })),
      theme,
    );
    await fixture(page);
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    await expect(page.getByRole("textbox", { name: "Search source declarations" })).toBeVisible();
    await page.getByRole("textbox", { name: "Search source declarations" }).fill("project");
    await expect(page.getByText("1 of 55 captured sources", { exact: true })).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({ path: `artifacts/recipe-sources-${theme}-mobile.png`, fullPage: true });
  });
}

test("a failed refresh labels an unsaved changed capture without overwriting its baseline", async ({
  page,
}) => {
  const api = await fixture(page);
  api.change({ ...capture(), commit: "c".repeat(40), digest: "d".repeat(64) });
  await page.getByRole("button", { name: "Fetch & run static scan", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Changed since review", { exact: true }),
  ).toBeVisible();
  api.fail();
  await page.getByRole("button", { name: "Scan current build files again", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Source fetch failed during this test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Previous capture · current state unknown", { exact: true }),
  ).toBeVisible();
  const exported = await exportScan(page);
  expect(exported.status).toBe("capture-current-unknown");
  expect(exported.scan.commit).toBe("c".repeat(40));
  expect(exported.baseline.commit).toBe("b".repeat(40));
});
