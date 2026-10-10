import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Severity } from "@/components/layout/shared";
import type { ListedFixStatus, PlanSecurity as Evidence } from "@/lib/ipc/bindings";
import { date, safeUrl, openUrl } from "@/lib/utils";

const labels: Record<ListedFixStatus, string> = {
  reaches_listed_fix: "Candidate reaches listed fix",
  below_listed_fix: "Candidate below listed fix",
  no_listed_fix: "No fixed version listed",
};

export function PlanSecurity({ evidence }: { evidence: Evidence | null }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const audit = evidence?.audit;
  const findings =
    evidence?.findings.filter((item) =>
      `${item.finding.package} ${item.finding.title} ${item.finding.cves.join(" ")}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    ) ?? [];
  return (
    <section className="space-y-3 border-b pb-5" aria-label="Plan advisory evidence">
      <h3 className="text-sm font-semibold">Installed-version advisories</h3>
      {!audit ? (
        <output className="block text-xs leading-5 text-warning">
          Advisory status unknown · {evidence?.unavailableReason ?? "Not captured in this plan."}{" "}
          Version and metadata review remain available.
        </output>
      ) : (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            {evidence!.findings.length} installed-version findings · {audit.checkedPackages}{" "}
            packages checked · {audit.uncoveredPackages} outside coverage
            <br />
            Retrieved {date(audit.scannedAt)} · feed publication freshness unknown
          </p>
          <p className="text-xs leading-5">
            Candidate versions are compared with tracker-listed fixes. Candidate archives are not
            audited; affected-range applicability still requires review.
          </p>
          {evidence!.findings.length === 0 ? (
            <p className="text-xs">No installed-version matches in this feed.</p>
          ) : (
            <>
              {evidence!.findings.length > 25 && (
                <Input
                  aria-label="Filter plan advisories"
                  placeholder="Package, advisory or CVE…"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(0);
                  }}
                />
              )}
              <div className="divide-y rounded-md border">
                {findings.slice(page * 25, (page + 1) * 25).map((item) => (
                  <article key={item.finding.id} className="space-y-2 p-3 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold break-all">
                        {item.finding.package} · {item.finding.title}
                      </p>
                      <Severity value={item.finding.severity} />
                    </div>
                    <p className="font-mono break-all">
                      Installed {item.finding.installedVersion} · listed fix{" "}
                      {item.finding.fixedVersion || "Unknown"}
                    </p>
                    <p
                      className={
                        item.listedFixStatus === "reaches_listed_fix"
                          ? "text-primary"
                          : "text-warning"
                      }
                    >
                      {labels[item.listedFixStatus]}
                      {item.candidateVersion &&
                        ` · ${item.candidateRepository} ${item.candidateVersion}`}
                    </p>
                    <p className="leading-5 text-muted-foreground">{item.finding.description}</p>
                    {safeUrl(item.finding.url) && (
                      <button
                        type="button"
                        className="text-primary underline underline-offset-4"
                        onClick={() => void openUrl(item.finding.url!)}
                      >
                        Tracker advisory
                      </button>
                    )}
                  </article>
                ))}
                {!findings.length && <p className="p-3 text-xs">No matching advisories.</p>}
              </div>
              {findings.length > 25 && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    {page * 25 + 1}–{Math.min((page + 1) * 25, findings.length)} of{" "}
                    {findings.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous advisories
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={(page + 1) * 25 >= findings.length}
                      onClick={() => setPage(page + 1)}
                    >
                      Next advisories
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          <details className="evidence-disclosure">
            <summary>Advisory coverage & limitations</summary>
            <ul className="space-y-2 p-3 text-xs leading-5 text-muted-foreground">
              {audit.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
