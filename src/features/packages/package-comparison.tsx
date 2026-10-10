import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Download, FileDiff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState, SectionTitle, TextLink } from "@/components/layout/shared";
import { useAudit, usePackages, useSnapshot } from "./queries";
import type { PackageComparison as Comparison } from "@/lib/ipc/bindings";
import { request } from "@/lib/ipc/client";
import { date, downloadJson } from "@/lib/utils";

export function ComparisonDetails({ report }: { report: Comparison }) {
  const changes = [...report.changes].sort((a, b) => {
    const order = [
      "Required dependencies",
      "Optional dependencies",
      "Provides",
      "Conflicts",
      "Replaces",
    ];
    return order.indexOf(a.kind) - order.indexOf(b.kind);
  });
  const changed = changes.some(
    (change) => change.added.length || change.removed.length || change.omittedCount,
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-4 border-b pb-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">
            Installed · {report.installedArchitecture}
          </p>
          <p className="mt-2 font-mono text-xs break-all">{report.installedVersion}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            {report.repository} candidate · {report.versionRelation}
          </p>
          <p className="mt-2 font-mono text-xs break-all">{report.candidateVersion}</p>
        </div>
      </div>
      {!report.complete && (
        <p className="text-xs text-warning">
          Comparison is partial. Omitted declarations are counted below.
        </p>
      )}
      {!changed && <p className="text-sm font-medium">No declaration changes</p>}
      <div className="divide-y rounded-lg border">
        {changes.map((change) => (
          <details
            key={change.kind}
            open={!!(change.added.length || change.removed.length || change.omittedCount)}
          >
            <summary className="cursor-pointer px-4 py-3 text-xs">
              <span className="font-medium">{change.kind}</span>
              <span className="ml-3 text-muted-foreground">
                {change.added.length + change.removed.length} changes · {change.unchangedCount}{" "}
                unchanged
              </span>
              {change.omittedCount > 0 && <span className="ml-2 text-warning">Partial</span>}
            </summary>
            <div className="px-4 pb-4">
              {change.added.length || change.removed.length ? (
                <ul className="max-h-52 space-y-2 overflow-y-auto">
                  {change.added.map((value) => (
                    <li key={`added-${value}`} className="flex gap-3 text-xs">
                      <span className="shrink-0 text-primary">+ Added</span>
                      <code className="break-all">{value}</code>
                    </li>
                  ))}
                  {change.removed.map((value) => (
                    <li key={`removed-${value}`} className="flex gap-3 text-xs">
                      <span className="shrink-0 text-muted-foreground">− Removed</span>
                      <code className="break-all">{value}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No declaration changes</p>
              )}
              {change.omittedCount > 0 && (
                <p className="mt-2 text-xs text-warning">
                  {change.omittedCount} declarations omitted from this category
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
      <details className="evidence-disclosure">
        <summary>Artifact metadata · unverified</summary>
        <dl className="space-y-3 p-4 text-xs">
          <div>
            <dt className="text-muted-foreground">Archive filename</dt>
            <dd className="mt-1 font-mono break-all">{report.filename ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Declared SHA-256 · bytes unverified</dt>
            <dd className="mt-1 font-mono break-all">{report.declaredSha256 ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Embedded signature declaration</dt>
            <dd className="mt-1">
              {report.embeddedSignature
                ? "Present · not verified"
                : "Not recorded · verification unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Recorded validation at installation</dt>
            <dd className="mt-1 font-mono break-all">{report.installedValidation}</dd>
          </div>
        </dl>
      </details>
      <details className="evidence-disclosure">
        <summary>Scope & limitations</summary>
        <ul className="space-y-3 p-4 text-xs leading-5 text-muted-foreground">
          {report.limitations.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function PackageComparison({
  navigate,
  initialName = "pacman",
}: {
  initialName?: string;
  navigate: (page: string, query?: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [report, setReport] = useState<Comparison | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const [auditRequested, setAuditRequested] = useState(false);
  const snapshot = useSnapshot();
  const choices = usePackages(name, "installed");
  const audit = useAudit(auditRequested && !!report);
  const client = useQueryClient();
  const auditFailed = audit.isError;
  const auditFetching = audit.isChecking;
  const stale = !!report && !!snapshot.data && report.fingerprint !== snapshot.data.fingerprint;
  const currentSnapshotMatches =
    !snapshot.isError && !!report && snapshot.data?.fingerprint === report.fingerprint;
  const matchingAudit =
    auditRequested &&
    currentSnapshotMatches &&
    !auditFailed &&
    !auditFetching &&
    audit.data?.fingerprint === report?.fingerprint &&
    audit.data &&
    !!snapshot.data &&
    Math.abs(snapshot.data.capturedAt - audit.data.scannedAt) < 300;
  const covered = !!report && ["core", "extra", "multilib"].includes(report.repository);
  const findings = matchingAudit
    ? audit.data!.findings.filter(
        (finding) =>
          finding.package === report!.name && finding.installedVersion === report!.installedVersion,
      )
    : [];
  async function compare() {
    if (!snapshot.data || pending) return;
    setPending(true);
    setReport(null);
    setError(null);
    setAuditRequested(false);
    try {
      setReport(
        await request({
          command: "comparison",
          name: name.trim(),
          fingerprint: snapshot.data.fingerprint,
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error : new Error(String(error)));
      await client.invalidateQueries({ queryKey: ["snapshot"] });
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel p-5" aria-label="Package candidate comparison">
      <SectionTitle
        title="Compare package metadata"
        description="Installed package versus the configured repository candidate."
      />
      <form
        className="mt-5 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void compare();
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="comparison-package" className="mb-2 block text-xs font-medium">
            Installed package name
          </label>
          <Input
            id="comparison-package"
            list="comparison-packages"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Search installed packages"
            autoComplete="off"
          />
          <datalist id="comparison-packages">
            {choices.data?.items
              .filter((pkg) => pkg.repository !== "local")
              .slice(0, 20)
              .map((pkg) => (
                <option key={pkg.id} value={pkg.name}>
                  {pkg.name}
                </option>
              ))}
          </datalist>
        </div>
        <Button
          className="sm:self-end"
          disabled={pending || !snapshot.data || !name.trim()}
          type="submit"
        >
          <FileDiff className="size-4" />
          {pending ? "Comparing…" : "Compare package"}
        </Button>
      </form>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Local metadata only. Candidate archives are not downloaded or verified.
      </p>
      {error && (
        <div className="mt-5">
          <ErrorState error={error} retry={() => void compare()} />
        </div>
      )}
      {report && (
        <div className="mt-6 border-t pt-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">{report.name} · candidate review</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Captured {date(report.capturedAt)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadJson(`archhub-comparison-${report.name}.json`, {
                  comparison: report,
                  currentSnapshotMatches,
                  advisoryState:
                    matchingAudit && covered ? "matching-installed-version-evidence" : "unknown",
                  audit: matchingAudit && covered ? audit.data : null,
                })
              }
            >
              <Download className="size-3.5" />
              Export comparison
            </Button>
          </div>
          {(stale || snapshot.isError) && (
            <output className="mb-4 block rounded-lg bg-warning-bg p-3 text-xs text-warning">
              {snapshot.isError
                ? "Current package state unavailable. Refresh the inventory and compare again."
                : "Package state changed. Compare again before relying on this capture."}
            </output>
          )}
          <div className="grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
            <ComparisonDetails report={report} />
            <div className="space-y-4">
              <section className="rounded-lg border p-4">
                <h4 className="text-xs font-semibold">Installed-version advisories</h4>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  The feed checks the installed version. Listed fixes are context; the candidate
                  archive has not been audited.
                </p>
                {!covered ? (
                  <p className="mt-3 text-xs text-warning">
                    Outside official Arch advisory coverage
                  </p>
                ) : !auditRequested ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Not checked for this comparison
                  </p>
                ) : auditFetching ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {audit.isPaused ? "Waiting for network access…" : "Checking advisory evidence…"}
                  </p>
                ) : auditFailed ? (
                  <output className="mt-3 block text-xs text-warning">
                    Advisory status unknown · {String(audit.error?.message)}
                  </output>
                ) : !matchingAudit ? (
                  <p className="mt-3 text-xs text-warning">
                    Advisory status unknown · no current matching evidence
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs">
                      {findings.length
                        ? `${findings.length} installed-version findings`
                        : "No installed-version matches in this feed"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Retrieved {date(audit.data!.scannedAt)} · publication freshness unknown
                    </p>
                    {findings.map((finding) => (
                      <div key={finding.id} className="rounded-md border p-3">
                        <p className="text-xs font-medium">{finding.title}</p>
                        <p className="mt-2 font-mono text-xs break-all">
                          Listed fix: {finding.fixedVersion ?? "Not recorded"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{finding.confidence}</p>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  className="mt-4"
                  variant="outline"
                  size="sm"
                  disabled={!covered || !currentSnapshotMatches || auditFetching}
                  onClick={() => {
                    if (auditRequested || audit.isError) void audit.check().catch(() => {});
                    setAuditRequested(true);
                  }}
                >
                  <RefreshCw className="size-3" />
                  {auditRequested ? "Recheck advisories" : "Check advisories"}
                </Button>
              </section>
              <TextLink onClick={() => navigate("dependencies", report.name)}>
                Inspect dependency paths <ArrowRight className="size-3" />
              </TextLink>
              <p className="font-mono text-xs break-all text-muted-foreground">
                State fingerprint: {report.fingerprint}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
