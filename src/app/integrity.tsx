import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Fingerprint,
  Info,
  Search,
  ScanLine,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  FileCog,
  CircleHelp,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, ErrorState, Loading, PageHeader, SectionTitle } from "@/components/layout/shared";
import { usePackages } from "@/features/packages/queries";
import { useDebounce } from "@/lib/hooks";
import { request } from "@/lib/ipc/client";
import type { IntegrityKind, Package } from "@/lib/ipc/bindings";
import { cn, date, downloadJson } from "@/lib/utils";

const kinds: Record<IntegrityKind, { label: string; icon: typeof Fingerprint; style: string }> = {
  changed: { label: "Package-file change", icon: FileWarning, style: "status-warn" },
  configuration: { label: "Configuration difference", icon: FileCog, style: "status-neutral" },
  unavailable: { label: "Check unavailable", icon: CircleHelp, style: "status-warn" },
};
const pageSize = 100;

export default function Integrity({ initialQuery }: { initialQuery: string }) {
  const client = useQueryClient();
  const [query, setQuery] = useState(initialQuery || "pacman");
  const debounced = useDebounce(query);
  const packages = usePackages(debounced, "installed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IntegrityKind | "all">("all");
  const [pathQuery, setPathQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const scan = useMutation({
    mutationFn: (pkg: Package) =>
      request({ command: "integrity", name: pkg.name, version: pkg.installedVersion! }),
  });
  const refresh = useMutation({
    mutationFn: async () => {
      const snapshot = await request({ command: "snapshot", refresh: true });
      client.setQueryData(["snapshot"], snapshot);
      await client.invalidateQueries({ queryKey: ["packages"] });
    },
  });
  const busy = scan.isPending || refresh.isPending;
  const options = packages.data?.items.slice(0, 8) ?? [];
  const selected =
    query === debounced
      ? options.find((pkg) => (selectedId ? pkg.id === selectedId : pkg.name === query.trim()))
      : undefined;
  const report = scan.data;
  const counts = {
    changed: report?.issues.filter((issue) => issue.kind === "changed").length ?? 0,
    configuration: report?.issues.filter((issue) => issue.kind === "configuration").length ?? 0,
    unavailable: report?.issues.filter((issue) => issue.kind === "unavailable").length ?? 0,
  };
  const issues =
    report?.issues.filter(
      (issue) =>
        (filter === "all" || issue.kind === filter) &&
        `${issue.path} ${issue.messages.join(" ")}`.toLowerCase().includes(pathQuery.toLowerCase()),
    ) ?? [];
  function chooseQuery(value: string) {
    if (busy) return;
    setQuery(value);
    setSelectedId(null);
    scan.reset();
  }
  function run() {
    if (!selected || busy || packages.isFetching || packages.isError) return;
    setFilter("all");
    setPathQuery("");
    setOffset(0);
    scan.mutate(selected);
  }
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="INSTALLED-FILE EVIDENCE"
        title="File integrity"
        description="Compare installed files with local package metadata."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!report || scan.isPending}
          onClick={() => report && downloadJson(`archhub-integrity-${report.name}.json`, report)}
        >
          <Download className="size-3.5" />
          Export evidence
        </Button>
      </PageHeader>
      {report && (
        <div className="mb-5 grid divide-y rounded-lg border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {(
            [
              [
                "changed",
                "Changed package paths",
                "Content, metadata, missing files or symlink differences",
              ],
              [
                "configuration",
                "Configuration differences",
                "Modified backup files, often intentional",
              ],
              [
                "unavailable",
                "Unavailable file checks",
                "Unreadable files or unsupported diagnostics",
              ],
            ] as const
          ).map(([kind, label, detail]) => {
            const Icon = kinds[kind].icon;
            return (
              <div key={kind} className="px-4 py-3">
                <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{label}</span>
                  <Icon className="size-4" />
                </div>
                <p className="font-heading text-xl font-medium tracking-tight">
                  {report ? counts[kind].toLocaleString() : "—"}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
              </div>
            );
          })}
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="panel min-w-0 p-5">
          <SectionTitle
            title="Choose an installed package"
            description="One package per check. Nothing runs until you start it."
          />
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 h-7 text-xs"
            disabled={busy || packages.isFetching}
            onClick={() => {
              scan.reset();
              refresh.mutate();
            }}
          >
            <RefreshCw className={cn("size-3", refresh.isPending && "animate-spin")} />
            Refresh inventory
          </Button>
          {refresh.isError && (
            <p role="alert" className="mt-2 text-xs leading-5 text-destructive">
              {refresh.error.message}
            </p>
          )}
          <label htmlFor="integrity-package" className="mt-5 mb-2 block text-xs font-medium">
            Search installed packages
          </label>
          <div className="relative">
            <Search className="absolute top-3 left-3 size-3.5 text-muted-foreground" />
            <Input
              id="integrity-package"
              className="pl-9"
              value={query}
              maxLength={200}
              disabled={busy}
              onChange={(event) => chooseQuery(event.target.value)}
              placeholder="Package name or description"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {["pacman", "openssl", "filesystem"].map((name) => (
              <Button
                key={name}
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => chooseQuery(name)}
              >
                {name}
              </Button>
            ))}
          </div>
          <div className="mt-4 space-y-1" aria-label="Installed package choices">
            {packages.isPending ? (
              <Loading label="Reading installed packages…" />
            ) : packages.isError ? (
              <ErrorState error={packages.error} retry={() => void packages.refetch()} />
            ) : !options.length ? (
              <p className="py-4 text-xs leading-5 text-muted-foreground">
                No installed packages match. Try another name.
              </p>
            ) : (
              options.map((pkg) => (
                <button
                  key={pkg.id}
                  aria-label={`Select ${pkg.name}`}
                  aria-pressed={selected?.id === pkg.id}
                  disabled={busy || query !== debounced}
                  className={cn(
                    "w-full rounded-lg border px-3 py-3 text-left transition-colors disabled:opacity-50",
                    selected?.id === pkg.id
                      ? "border-primary/35 bg-primary/5"
                      : "border-transparent hover:bg-muted",
                  )}
                  onClick={() => {
                    setSelectedId(pkg.id);
                    scan.reset();
                  }}
                >
                  <p className="truncate text-xs font-semibold">{pkg.name}</p>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {pkg.installedVersion}
                  </p>
                </button>
              ))
            )}
          </div>
          {(packages.data?.total ?? 0) > 8 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing 8 of {packages.data!.total.toLocaleString()} matches. Refine your search.
            </p>
          )}
          <Button
            className="mt-5 w-full"
            disabled={!selected || busy || packages.isFetching || packages.isError}
            onClick={run}
          >
            <ScanLine className={cn("size-4", scan.isPending && "animate-pulse")} />
            {scan.isPending ? "Checking files…" : "Check files"}
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Uses pacman’s local file checks without elevated access. Large packages can take up to
            90 seconds.
          </p>
        </aside>
        <div className="min-w-0 space-y-5">
          {scan.isPending ? (
            <section className="panel" aria-live="polite">
              <Loading
                label={`Checking ${scan.variables.name} · ${scan.variables.installedVersion}…`}
              />
              <p className="px-6 pb-6 text-center text-xs text-muted-foreground">
                Reading file metadata and checksums. The result will identify unavailable checks.
              </p>
            </section>
          ) : scan.isError ? (
            <section className="panel">
              <ErrorState error={scan.error} retry={run} />
              <p className="px-6 pb-6 text-center text-xs text-muted-foreground">
                Coverage is unknown. No successful result is retained for this attempt.
              </p>
            </section>
          ) : report ? (
            <>
              <section className="panel overflow-hidden">
                <div className="border-b p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <SectionTitle
                        title={`File evidence · ${report.name}`}
                        description={`Installed ${report.version} · ${date(report.finishedAt)}`}
                      />
                    </div>
                    <span
                      className={cn("status", report.complete ? "status-neutral" : "status-warn")}
                    >
                      {report.complete ? "Check completed" : "Incomplete coverage"}
                    </span>
                  </div>
                  <output className="mt-4 block text-sm font-medium">
                    {!report.complete
                      ? "Some checks remain unknown."
                      : counts.changed
                        ? "Package-file differences need review."
                        : "No package-file differences reported."}
                  </output>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {report.totalEntries ?? "Unknown"} mtree entries · {report.ownedFiles} manifest
                    paths · {report.pacmanAlteredFiles ?? "unknown"} altered files reported by
                    pacman. Counts include different checks; they are not a security verdict.
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    File checks use unauthenticated local metadata.
                  </p>
                  {report.warnings.length > 0 && (
                    <div className="mt-4 rounded-lg border border-warning/20 bg-warning-bg p-3">
                      <p className="mb-2 text-xs font-semibold text-warning">Coverage notes</p>
                      <ul className="list-disc space-y-2 pl-4 text-xs leading-5 text-muted-foreground">
                        {report.warnings.map((warning, i) => (
                          <li key={i} className="break-words">
                            {warning}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-1" aria-label="Filter file evidence">
                    {(["all", "changed", "configuration", "unavailable"] as const).map((kind) => (
                      <Button
                        key={kind}
                        variant={filter === kind ? "outline" : "ghost"}
                        size="sm"
                        className="h-8 text-xs"
                        aria-pressed={filter === kind}
                        onClick={() => {
                          setFilter(kind);
                          setOffset(0);
                        }}
                      >
                        {kind === "all"
                          ? `All ${report.issues.length}`
                          : `${kind === "changed" ? "Changed" : kind === "configuration" ? "Configuration" : "Unavailable"} ${counts[kind]}`}
                      </Button>
                    ))}
                  </div>
                  <Input
                    className="mt-3"
                    aria-label="Search file evidence"
                    placeholder="Filter by path or check…"
                    value={pathQuery}
                    onChange={(event) => {
                      setPathQuery(event.target.value);
                      setOffset(0);
                    }}
                  />
                </div>
                {issues.length ? (
                  <div>
                    {issues.slice(offset, offset + pageSize).map((issue) => {
                      const meta = kinds[issue.kind];
                      const Icon = meta.icon;
                      return (
                        <article
                          key={issue.path}
                          className="flex items-start gap-3 border-b p-5 last:border-b-0"
                        >
                          <div className="mt-0.5 rounded-lg bg-muted p-2 text-muted-foreground">
                            <Icon className="size-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn("status", meta.style)}>{meta.label}</span>
                              {issue.backup && (
                                <span className="text-xs text-muted-foreground">
                                  Pacman backup file
                                </span>
                              )}
                            </div>
                            <p className="mt-2 font-mono text-xs leading-5 break-all">
                              {issue.path}
                            </p>
                            <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                              {issue.messages.map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <Empty
                    title={
                      report.issues.length
                        ? "No paths match these filters"
                        : report.complete
                          ? "No differences reported"
                          : "No path evidence available"
                    }
                    description={
                      report.issues.length
                        ? "Try another filter or search term."
                        : "Review the coverage and reference limits before drawing a conclusion."
                    }
                  />
                )}
                {issues.length > pageSize && (
                  <div className="flex items-center justify-between gap-2 border-t p-4">
                    <p className="text-xs text-muted-foreground">
                      {offset + 1}–{Math.min(offset + pageSize, issues.length)} of {issues.length}{" "}
                      paths
                    </p>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Previous evidence page"
                        disabled={offset === 0}
                        onClick={() => setOffset(Math.max(0, offset - pageSize))}
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Next evidence page"
                        disabled={offset + pageSize >= issues.length}
                        onClick={() => setOffset(offset + pageSize)}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              <details className="evidence-disclosure">
                <summary>
                  <h2 className="inline text-xs font-medium">Reference & coverage</h2>
                </summary>
                <div className="p-4">
                  <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Engine</dt>
                      <dd className="mt-1">Pacman · query / double check</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Captured</dt>
                      <dd className="mt-1">
                        {date(report.startedAt)} ·{" "}
                        {Math.max(0, report.finishedAt - report.startedAt).toFixed(1)} seconds
                      </dd>
                    </div>
                  </dl>
                  <details className="mt-4 rounded-lg border p-3">
                    <summary className="cursor-pointer text-xs font-medium">
                      Local metadata identity
                    </summary>
                    <p className="mt-2 font-mono text-xs leading-5 break-all">
                      {report.metadataDigest}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      SHA-256 of the local metadata and expanded configuration. Detects observed
                      changes during this check; it is not an authenticated baseline.
                    </p>
                  </details>
                  <ul className="mt-4 space-y-3">
                    {report.limitations.map((limit) => (
                      <li
                        key={limit}
                        className="flex items-start gap-2 text-xs leading-6 text-muted-foreground"
                      >
                        <Info className="mt-1 size-3.5 shrink-0" />
                        <span>{limit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </>
          ) : (
            <section className="panel">
              <div className="flex min-h-80 flex-col items-center justify-center px-7 py-10 text-center">
                <Fingerprint className="mb-5 size-10 text-primary" strokeWidth={1.2} />
                <h2 className="font-heading text-xl font-medium">
                  A closer look at installed files.
                </h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  Choose a package and start a check. Review content hashes, missing files,
                  permissions and symlinks alongside configuration differences.
                </p>
                <p className="mt-5 max-w-sm text-xs leading-6 text-muted-foreground">
                  No packages are changed. The local reference cannot prove that a file or system is
                  safe.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
