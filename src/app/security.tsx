import { useState } from "react";
import {
  Download,
  RefreshCw,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Loading, ErrorState, FindingRow, Empty } from "@/components/layout/shared";
import { useAudit, useSnapshot } from "@/features/packages/queries";
import { cn, date, downloadJson, openUrl } from "@/lib/utils";

const pageSize = 25;
export default function Security({
  navigate,
  initialQuery = "",
}: {
  navigate: (page: string, query?: string) => void;
  initialQuery?: string;
}) {
  const audit = useAudit();
  const snapshot = useSnapshot();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState(initialQuery);
  const [offset, setOffset] = useState(0);
  async function check() {
    try {
      await audit.check();
      setOffset(0);
      toast.success("Advisory evidence refreshed");
    } catch {
      // The shared query exposes the failure in every advisory workspace.
    }
  }
  const error = audit.error;
  const current =
    !error &&
    !audit.isChecking &&
    !snapshot.isError &&
    !!audit.data &&
    audit.data.fingerprint === snapshot.data?.fingerprint;
  const needle = search.trim().toLowerCase();
  const findings = current
    ? audit.data!.findings.filter(
        (f) =>
          (filter === "all" ||
            (filter === "high"
              ? ["high", "critical"].includes(f.severity)
              : f.confidence === "needs-review")) &&
          [f.package, f.id, f.title, f.description, ...f.cves, f.installedVersion, f.fixedVersion]
            .join(" ")
            .toLowerCase()
            .includes(needle),
      )
    : [];
  const pageOffset = Math.min(
    offset,
    Math.max(0, Math.ceil(findings.length / pageSize) - 1) * pageSize,
  );
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="SECURITY"
        title="Advisories"
        description="Installed versions matched against the Arch Security Tracker."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!current}
          onClick={() => downloadJson("archhub-security-evidence.json", audit.data)}
        >
          <Download className="size-3.5" />
          Export
        </Button>
        <Button size="sm" disabled={audit.isChecking} onClick={() => void check()}>
          <RefreshCw className={cn("size-3.5", audit.isChecking && "animate-spin")} />
          Run advisory check
        </Button>
      </PageHeader>
      <div className="mb-5 grid divide-y rounded-lg border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Official package coverage</p>
          <p className="mt-2 text-sm font-medium">
            {current ? audit.data!.checkedPackages.toLocaleString() : "Unknown"}
            <span className="ml-2 text-xs font-normal text-muted-foreground"> packages</span>
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Outside advisory coverage</p>
          <p className="mt-2 text-sm font-medium">
            {current ? audit.data!.uncoveredPackages : "Unknown"}
            <span className="ml-2 text-xs font-normal text-muted-foreground"> packages</span>
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Feed publication freshness</p>
          <p className="mt-2 text-sm font-medium">Unknown</p>
        </div>
      </div>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div aria-label="Filter advisory findings" className="flex flex-wrap gap-1">
            {[
              ["all", `All ${current ? audit.data!.findings.length : ""}`],
              ["high", "High & critical"],
              ["review", "Needs review"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "secondary" : "ghost"}
                aria-pressed={filter === value}
                className="h-8 text-xs"
                onClick={() => {
                  setFilter(value!);
                  setOffset(0);
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {current ? `Retrieved ${date(audit.data!.scannedAt)}` : "Current evidence unavailable"}
          </span>
        </div>
        <div className="relative border-b p-4">
          <Search className="pointer-events-none absolute top-[26px] left-7 size-4 text-muted-foreground" />
          <Input
            aria-label="Search advisory findings"
            placeholder="Search packages, advisories or CVEs…"
            className="pr-10 pl-9"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-[18px] right-[18px] size-8"
              aria-label="Clear advisory search"
              onClick={() => {
                setSearch("");
                setOffset(0);
              }}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
        {audit.isChecking ? (
          <Loading
            label={
              audit.isPaused
                ? "Waiting for network access…"
                : "Checking installed package versions…"
            }
          />
        ) : error ? (
          <ErrorState error={error} retry={() => void check()} />
        ) : !current ? (
          <div className="p-6">
            <h2 className="text-sm font-semibold">Advisory status unknown</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              The evidence does not match the current package inventory. Refresh inventory and run
              the check again.
            </p>
          </div>
        ) : findings.length ? (
          findings.slice(pageOffset, pageOffset + pageSize).map((finding) => (
            <article key={finding.id} aria-label={finding.id} className="border-b last:border-b-0">
              <FindingRow
                finding={finding}
                onClick={
                  finding.url
                    ? () => void openUrl(finding.url!).catch((error) => toast.error(String(error)))
                    : undefined
                }
              />
              <div className="px-5 pb-4 sm:pl-16">
                <p className="mb-2 font-mono text-xs break-words text-muted-foreground">
                  {finding.id}
                  {finding.cves.length ? ` · ${finding.cves.join(", ")}` : ""}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">{finding.description}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
                  <span className="font-mono break-all">
                    Installed {finding.installedVersion ?? "Unknown"}
                  </span>
                  <span className="font-mono break-all">
                    Listed fix {finding.fixedVersion ?? "Not recorded"}
                  </span>
                  <span className="text-warning">
                    {finding.confidence === "needs-review"
                      ? "Tracker status uncertain"
                      : "Version match · range review required"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => navigate("installed", finding.package)}
                  >
                    Review installed package
                  </button>
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => navigate("dependencies", finding.package)}
                  >
                    Inspect dependency paths
                  </button>
                </div>
              </div>
            </article>
          ))
        ) : (
          <Empty
            title={
              filter === "all" && !needle
                ? "No matches in the available evidence"
                : "No findings match this filter"
            }
            description={
              filter !== "all" || needle
                ? "Change the search or filter to see other captured findings. Display filters also leave the full export intact."
                : "This feed has limited coverage and version ranges. No matches does not establish package safety."
            }
          />
        )}
        {current && findings.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <output className="text-xs text-muted-foreground">
              {pageOffset + 1}–{Math.min(findings.length, pageOffset + pageSize)} of{" "}
              {findings.length} findings
              {findings.length !== audit.data!.findings.length &&
                ` · ${audit.data!.findings.length} captured`}
            </output>
            {findings.length > pageSize && (
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Previous advisory page"
                  disabled={pageOffset === 0}
                  onClick={() => setOffset(Math.max(0, pageOffset - pageSize))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Next advisory page"
                  disabled={pageOffset + pageSize >= findings.length}
                  onClick={() => setOffset(pageOffset + pageSize)}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-xs">
        <button
          className="inline-flex items-center gap-1.5 text-primary hover:underline"
          onClick={() => navigate("aur")}
        >
          Inspect an AUR recipe <ArrowUpRight className="size-3.5" />
        </button>
        <button
          className="inline-flex items-center gap-1.5 text-primary hover:underline"
          onClick={() => navigate("foreign")}
        >
          Review foreign packages <ArrowUpRight className="size-3.5" />
        </button>
      </div>
      <details className="evidence-disclosure mt-6">
        <summary>
          <h2 className="inline text-xs font-medium">Coverage & limitations</h2>
        </summary>
        <div className="space-y-3 p-4 text-xs leading-6 text-muted-foreground">
          <p>
            Advisories apply to installed versions, not downloaded candidate archives. Publication
            freshness and complete affected ranges are unknown. The installed inventory is matched
            locally.
          </p>
          {audit.data?.limitations.map((limit) => (
            <p key={limit}>{limit}</p>
          ))}
          <p>
            Foreign packages require separate origin and recipe review. Repository labels are
            current name matches, not authenticated installation provenance.
          </p>
        </div>
      </details>
    </div>
  );
}
