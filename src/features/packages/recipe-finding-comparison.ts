import type { Finding, RecipeScan } from "@/lib/ipc/bindings";

export type FindingChange = {
  kind: "new" | "retained" | "absent";
  current: Finding | null;
  reviewed: Finding | null;
};
export type FindingComparison =
  | { available: false; reason: string }
  | { available: true; changes: FindingChange[] };

export function compareRecipeFindings(
  current: RecipeScan,
  reviewed: RecipeScan,
): FindingComparison {
  if (current.packageBase !== reviewed.packageBase || !current.complete || !reviewed.complete)
    return { available: false, reason: "Both captures must cover the same complete package base." };
  const version = current.staticAnalyzerVersion;
  if (!Number.isSafeInteger(version) || version! < 1 || version !== reviewed.staticAnalyzerVersion)
    return {
      available: false,
      reason:
        "Finding comparison requires the same known static analyzer version. Review the current findings alongside the saved export.",
    };

  function identities(scan: RecipeScan): string[] | null {
    const files = new Map(scan.files.map((file) => [file.path, file.content.split("\n")]));
    const keys: string[] = [];
    for (const finding of scan.findings) {
      const path = finding.file ?? "PKGBUILD";
      const line = finding.line;
      const content = files.get(path);
      if (
        finding.package !== scan.packageBase ||
        !Number.isSafeInteger(line) ||
        line! < 1 ||
        !content ||
        line! > content.length ||
        !finding.id.startsWith(`${path}:`) ||
        !finding.id.endsWith(`-${line}`)
      )
        return null;
      const rule = finding.id.slice(path.length + 1, -`-${line}`.length);
      if (!rule) return null;
      keys.push(
        JSON.stringify([
          rule,
          path,
          finding.severity,
          finding.title,
          finding.description,
          finding.confidence,
          finding.installedVersion,
          finding.fixedVersion,
          finding.cves,
          finding.url,
          content[line! - 1],
        ]),
      );
    }
    return keys;
  }
  const oldKeys = identities(reviewed);
  const newKeys = identities(current);
  if (!oldKeys || !newKeys)
    return {
      available: false,
      reason:
        "Finding comparison is unavailable because a rule or source location cannot be matched to its captured file. Inspect the original findings and exports.",
    };

  const occurrences = new Map<string, number[]>();
  oldKeys.forEach((key, index) => {
    const indices = occurrences.get(key);
    if (indices) indices.push(index);
    else occurrences.set(key, [index]);
  });
  const consumed = new Set<number>();
  const changes: FindingChange[] = newKeys.map((key, index) => {
    const previous = occurrences.get(key)?.pop();
    if (previous === undefined)
      return { kind: "new", current: current.findings[index]!, reviewed: null };
    consumed.add(previous);
    return {
      kind: "retained",
      current: current.findings[index]!,
      reviewed: reviewed.findings[previous]!,
    };
  });
  reviewed.findings.forEach((finding, index) => {
    if (!consumed.has(index)) changes.push({ kind: "absent", current: null, reviewed: finding });
  });
  return { available: true, changes };
}
