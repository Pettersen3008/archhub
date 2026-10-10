import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Download,
  GitFork,
  Info,
  RefreshCw,
  Search,
  Shield,
  CircleHelp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Empty,
  ErrorState,
  Loading,
  PageHeader,
  SectionTitle,
  Severity,
} from "@/components/layout/shared";
import { useAudit, usePackages } from "@/features/packages/queries";
import { useDebounce } from "@/lib/hooks";
import { request } from "@/lib/ipc/client";
import type {
  DependencyPackage,
  DependencyPath,
  DependencyRequirement,
  Package,
} from "@/lib/ipc/bindings";
import { cn, date, downloadJson, openUrl } from "@/lib/utils";

type View = "requires" | "required_by" | "optional";
const pageSize = 50;
const official = (pkg: DependencyPackage) => ["core", "extra", "multilib"].includes(pkg.repository);

export default function Dependencies({
  initialQuery,
  navigate,
}: {
  initialQuery: string;
  navigate: (page: string, query?: string) => void;
}) {
  const client = useQueryClient();
  const [query, setQuery] = useState(initialQuery || "pacman");
  const debounced = useDebounce(query);
  const packages = usePackages(debounced, "installed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("requires");
  const [directOnly, setDirectOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [declarationOffset, setDeclarationOffset] = useState(0);
  const inspection = useMutation({
    mutationFn: (pkg: Package) =>
      request({ command: "dependencies", name: pkg.name, version: pkg.installedVersion! }),
  });
  const report = inspection.data;
  const audit = useAudit(!!report);
  const refresh = useMutation({
    mutationFn: async () => {
      const snapshot = await request({ command: "snapshot", refresh: true });
      client.setQueryData(["snapshot"], snapshot);
      await client.invalidateQueries({ queryKey: ["packages"] });
    },
  });
  const busy = inspection.isPending || refresh.isPending;
  const options = packages.data?.items.slice(0, 8) ?? [];
  const selected =
    query === debounced
      ? options.find((pkg) => (selectedId ? pkg.id === selectedId : pkg.name === query.trim()))
      : undefined;
  const members = report ? [report.root, ...report.requires.map((p) => p.package)] : [];
  const allMembers = report
    ? [
        ...members,
        ...report.requiredBy.map((p) => p.package),
        ...report.optional.flatMap((r) => r.providers),
      ]
    : [];
  const versions = new Map(allMembers.map((p) => [p.name, p.version]));
  const advisoryCurrent =
    !!report &&
    !audit.isError &&
    !audit.isChecking &&
    !!audit.data &&
    audit.data.fingerprint === report.fingerprint &&
    audit.data.findings.every(
      (f) => !versions.has(f.package) || versions.get(f.package) === f.installedVersion,
    );
  const advisoryReason = !report
    ? "No dependency snapshot"
    : audit.isPaused
      ? "Advisory check is waiting for network access"
      : audit.isChecking
        ? "Advisory evidence is being checked"
        : audit.isError
          ? audit.error.message
          : !audit.data
            ? "Advisory evidence has not completed"
            : !advisoryCurrent
              ? "Advisory evidence belongs to a different package snapshot or version. Refresh advisories, or refresh inventory and inspect again."
              : null;
  const findings = advisoryCurrent
    ? audit.data!.findings.filter((f) => versions.has(f.package))
    : [];
  const chainNames = new Set(members.map((p) => p.name));
  const chainFindings = findings.filter((f) => chainNames.has(f.package));
  const uncovered = members.filter((p) => !official(p));
  const pathItems =
    (view === "required_by" ? report?.requiredBy : report?.requires)?.filter(
      (p) =>
        (!directOnly || p.path.length === 2) &&
        `${p.path.join(" ")} ${p.requirements.join(" ")} ${p.package.version}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const optionalItems =
    report?.optional.filter((r) =>
      `${r.spec} ${r.description ?? ""} ${r.providers.map((p) => p.name).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  const total = view === "optional" ? optionalItems.length : pathItems.length;
  function resetDisplay() {
    setOffset(0);
    setDeclarationOffset(0);
    setSearch("");
    setDirectOnly(false);
    setView("requires");
  }
  function run() {
    if (!selected || busy || packages.isError || packages.isFetching) return;
    resetDisplay();
    inspection.mutate(selected);
  }
  function chooseQuery(value: string) {
    if (busy) return;
    setQuery(value);
    setSelectedId(null);
    inspection.reset();
    refresh.reset();
  }
  function status(pkg: DependencyPackage) {
    const count = findings.filter((f) => f.package === pkg.name).length;
    return (
      <span className={cn("status", !official(pkg) || count ? "status-warn" : "status-neutral")}>
        {!official(pkg)
          ? "Outside advisory coverage"
          : !advisoryCurrent
            ? "Advisories unknown"
            : count
              ? `${count} advisory ${count === 1 ? "match" : "matches"}`
              : "No advisory matches"}
      </span>
    );
  }
  function requirementRow(requirement: DependencyRequirement, optional: boolean) {
    return (
      <div
        key={`${requirement.spec}:${requirement.description}`}
        className="border-b px-5 py-4 last:border-b-0"
      >
        <p className="font-mono text-xs font-medium break-all">{requirement.spec}</p>
        {requirement.description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{requirement.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {requirement.providers.length ? (
            requirement.providers.map((pkg) => (
              <Button
                key={pkg.name}
                variant="outline"
                size="sm"
                className="h-auto min-h-8 max-w-full text-xs whitespace-normal"
                onClick={() => navigate("dependencies", pkg.name)}
              >
                <GitFork className="size-3 shrink-0" />
                <span className="break-all">
                  {pkg.name} · {pkg.version}
                </span>
              </Button>
            ))
          ) : (
            <span className={cn("status", optional ? "status-neutral" : "status-warn")}>
              {optional ? "Not installed" : "No matching installed provider"}
            </span>
          )}
          {requirement.providers.length > 1 && (
            <span className="text-xs text-muted-foreground">Alternative installed providers</span>
          )}
        </div>
      </div>
    );
  }
  function pathRow(item: DependencyPath) {
    const Arrow = view === "required_by" ? ArrowLeft : ArrowRight;
    return (
      <article key={item.package.name} className="border-b p-5 last:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold break-all">
              {item.package.name}
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                {item.package.version}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {status(item.package)}
              <span className="status status-neutral">
                {item.path.length === 2 ? "Direct" : `${item.path.length - 1} edges`}
              </span>
              {item.alternativeProviders && (
                <span className="status status-neutral">Alternative providers on path</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            aria-label={`Trace ${item.package.name}`}
            onClick={() => navigate("dependencies", item.package.name)}
          >
            Trace
            <GitFork className="size-3" />
          </Button>
        </div>
        <div
          className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2"
          aria-label={`Dependency path for ${item.package.name}`}
        >
          {item.path.map((name, i) => (
            <span key={`${i}:${name}`} className="inline-flex max-w-full items-center gap-1.5">
              {i > 0 && <Arrow className="size-3 shrink-0 text-muted-foreground" />}
              {i === 0 ? (
                <span className="font-mono text-xs break-all text-muted-foreground">{name}</span>
              ) : (
                <button
                  className="max-w-full rounded bg-muted px-1.5 py-1 font-mono text-xs break-all hover:text-primary hover:underline"
                  aria-label={`Follow ${name} on the path for ${item.package.name}`}
                  onClick={() => navigate("dependencies", name)}
                >
                  {name}
                </button>
              )}
            </span>
          ))}
        </div>
        <p className="mt-2 font-mono text-xs leading-5 break-all text-muted-foreground">
          {item.requirements.join(" · ")}
        </p>
      </article>
    );
  }
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="DEPENDENCY EVIDENCE"
        title="Dependency paths"
        description="Inspect installed providers, requirements and possible consumers."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!report || inspection.isPending}
          onClick={() =>
            report &&
            downloadJson(`archhub-dependencies-${report.root.name}.json`, {
              graph: report,
              advisories: {
                state: advisoryCurrent ? "matching" : "unknown",
                reason: advisoryReason,
                fingerprint: advisoryCurrent ? audit.data!.fingerprint : null,
                source: advisoryCurrent ? audit.data!.source : null,
                sourceUrl: advisoryCurrent ? audit.data!.sourceUrl : null,
                scannedAt: advisoryCurrent ? audit.data!.scannedAt : null,
                publicationFreshness: "unknown",
                findings,
                limitations: advisoryCurrent ? audit.data!.limitations : [],
              },
            })
          }
        >
          <Download className="size-3.5" />
          Export dependency evidence
        </Button>
      </PageHeader>
      {report && (
        <div className="mb-5 grid divide-y rounded-lg border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            {
              label: "Required packages in this view",
              value: report
                ? `${report.requiresComplete ? "" : "≥"}${report.requires.length}`
                : "—",
              detail: "Required declarations, including possible providers",
              icon: GitFork,
            },
            {
              label: "Potential dependent packages",
              value: report
                ? `${report.requiredByComplete ? "" : "≥"}${report.requiredBy.length}`
                : "—",
              detail: "Direct and indirect consumers in installed metadata",
              icon: ArrowLeft,
            },
            {
              label: "Advisory matches in required chain",
              value: advisoryCurrent ? chainFindings.length : "Unknown",
              detail: "Selected package and captured required paths · applicability needs review",
              icon: Shield,
            },
          ].map((item) => (
            <div key={item.label} className="px-4 py-3">
              <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{item.label}</span>
                <item.icon className="size-4 shrink-0" />
              </div>
              <p className="font-heading text-xl font-medium tracking-tight">{item.value}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="panel min-w-0 p-5">
          <SectionTitle
            title="Inspect an installed package"
            description="Captured local metadata, with required and optional declarations kept separate."
          />
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 h-7 text-xs"
            disabled={busy || packages.isFetching}
            onClick={() => {
              inspection.reset();
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
          <label htmlFor="dependency-package" className="mt-5 mb-2 block text-xs font-medium">
            Search installed packages
          </label>
          <div className="relative">
            <Search className="absolute top-3 left-3 size-3.5 text-muted-foreground" />
            <Input
              id="dependency-package"
              value={query}
              maxLength={200}
              disabled={busy}
              className="pl-9"
              placeholder="Package name or description"
              onChange={(e) => chooseQuery(e.target.value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {["pacman", "openssl", "glibc"].map((name) => (
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
          <div className="mt-4 space-y-1">
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
                    "w-full rounded-lg border px-3 py-3 text-left disabled:opacity-50",
                    selected?.id === pkg.id
                      ? "border-primary/35 bg-primary/5"
                      : "border-transparent hover:bg-muted",
                  )}
                  onClick={() => {
                    setSelectedId(pkg.id);
                    inspection.reset();
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
            disabled={!selected || busy || packages.isError || packages.isFetching}
            onClick={run}
          >
            <GitFork className="size-4" />
            Inspect dependencies
          </Button>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            No package changes or repository code execution. Optional and bundled libraries have
            different coverage.
          </p>
        </aside>
        <div className="min-w-0 space-y-5">
          {inspection.isPending ? (
            <Loading label="Reading installed dependency paths…" />
          ) : inspection.isError ? (
            <ErrorState error={inspection.error} retry={run} />
          ) : report ? (
            <>
              <section className="panel overflow-hidden">
                <div className="border-b p-5">
                  <SectionTitle
                    title={`Installed paths · ${report.root.name}`}
                    description={`Installed ${report.root.version} · snapshot ${date(report.capturedAt)}`}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {status(report.root)}
                    <span className="status status-neutral">
                      {report.root.explicit ? "Explicit installation" : "Installed as dependency"}
                    </span>
                    <span className="status status-neutral">
                      {report.root.repository === "local"
                        ? "Foreign / unknown origin"
                        : `${report.root.repository} name match`}
                    </span>
                  </div>
                  {(!report.requiresComplete || !report.requiredByComplete) && (
                    <p className="mt-4 rounded-lg border border-warning/20 bg-warning-bg p-3 text-xs leading-5 text-warning">
                      Incomplete traversal or unresolved required declarations. The captured counts
                      are lower bounds; review the missing providers and traversal limits.
                    </p>
                  )}
                  {report.unresolved.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold">Missing required providers</h3>
                      <ul className="mt-2 space-y-1">
                        {report.unresolved.slice(0, 50).map((gap, i) => (
                          <li
                            key={i}
                            className="font-mono text-xs leading-5 break-all text-muted-foreground"
                          >
                            {gap.package} → {gap.requirement}
                          </li>
                        ))}
                      </ul>
                      {report.unresolved.length > 50 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Showing 50 of {report.unresolved.length} missing declarations. Export for
                          the complete captured list.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <Tabs
                  value={view}
                  onValueChange={(value) => {
                    setView(value as View);
                    setOffset(0);
                    setSearch("");
                  }}
                  className="gap-0"
                >
                  <div className="border-b p-5">
                    <TabsList className="max-w-full">
                      <TabsTrigger value="requires" className="text-xs">
                        Requires
                      </TabsTrigger>
                      <TabsTrigger value="required_by" className="text-xs">
                        Required by
                      </TabsTrigger>
                      <TabsTrigger value="optional" className="text-xs">
                        Optional
                      </TabsTrigger>
                    </TabsList>
                    {view !== "optional" && (
                      <div
                        className="mt-4 flex flex-wrap items-center gap-1"
                        aria-label="Dependency depth filter"
                      >
                        {[false, true].map((direct) => (
                          <Button
                            key={String(direct)}
                            size="sm"
                            variant={directOnly === direct ? "outline" : "ghost"}
                            className="h-7 text-xs"
                            aria-pressed={directOnly === direct}
                            onClick={() => {
                              setDirectOnly(direct);
                              setOffset(0);
                            }}
                          >
                            {direct ? "Direct only" : "All captured paths"}
                          </Button>
                        ))}
                      </div>
                    )}
                    <Input
                      className="mt-3"
                      aria-label="Search dependency paths"
                      placeholder={
                        view === "optional"
                          ? "Search optional declarations or providers…"
                          : "Search packages, paths or constraints…"
                      }
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setOffset(0);
                      }}
                    />
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {view === "required_by"
                        ? "Arrows point from potential consumers back to the package they can depend on. Alternative providers may remain available."
                        : view === "optional"
                          ? "Optional declarations for this installed version. Not installed does not mean a required dependency is missing."
                          : "One representative path for each reachable installed package. Includes every matching installed provider."}
                    </p>
                  </div>
                  <TabsContent value={view} className="m-0">
                    {total ? (
                      <>
                        {view === "optional"
                          ? optionalItems
                              .slice(offset, offset + pageSize)
                              .map((req) => requirementRow(req, true))
                          : pathItems.slice(offset, offset + pageSize).map(pathRow)}
                      </>
                    ) : (
                      <Empty
                        title={
                          search || directOnly
                            ? "No dependencies match these filters"
                            : view === "required_by"
                              ? "No required consumers in this snapshot"
                              : view === "optional"
                                ? "No optional declarations"
                                : "No resolved required paths"
                        }
                        description="This describes captured package metadata. Review coverage before drawing conclusions."
                      />
                    )}
                    {total > pageSize && (
                      <div className="flex items-center justify-between gap-2 border-t p-4">
                        <p className="text-xs text-muted-foreground">
                          {offset + 1}–{Math.min(total, offset + pageSize)} of {total}{" "}
                          {view === "optional" ? "declarations" : "paths"}
                        </p>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label="Previous dependency page"
                            disabled={offset === 0}
                            onClick={() => setOffset(Math.max(0, offset - pageSize))}
                          >
                            <ChevronLeft className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label="Next dependency page"
                            disabled={offset + pageSize >= total}
                            onClick={() => setOffset(offset + pageSize)}
                          >
                            <ChevronRight className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </section>
              <section className="panel p-5">
                <SectionTitle title="Advisory correlation" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span
                    className={cn("status", advisoryCurrent ? "status-neutral" : "status-warn")}
                  >
                    {advisoryCurrent ? "Matching package snapshot" : "Advisory state unknown"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={audit.isChecking}
                    onClick={() => void audit.check().catch(() => {})}
                  >
                    <RefreshCw className={cn("size-3", audit.isChecking && "animate-spin")} />
                    Refresh advisories
                  </Button>
                </div>
                <p
                  role={audit.isError && !audit.isChecking ? "alert" : undefined}
                  className="mt-3 text-xs leading-6 text-muted-foreground"
                >
                  {advisoryCurrent
                    ? `Fetched ${date(audit.data!.scannedAt)}. ${uncovered.length} captured packages in the required chain are outside nominal official coverage. Publication freshness and complete affected ranges remain unknown.`
                    : advisoryReason}
                </p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  Advisory matches require version-range review. Dependency paths do not prove that
                  vulnerable code is loaded or reachable.
                </p>
                {chainFindings.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {chainFindings.slice(0, 50).map((finding) => (
                      <li key={finding.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium">{finding.title}</p>
                          <Severity value={finding.severity} />
                        </div>
                        <p className="mt-1 font-mono text-xs leading-5 break-all text-muted-foreground">
                          {finding.id} · installed {finding.installedVersion} · fixed{" "}
                          {finding.fixedVersion ?? "not provided"}
                        </p>
                        {finding.url && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 h-7 text-xs"
                            aria-label={`Open advisory ${finding.id}`}
                            onClick={() =>
                              void openUrl(finding.url!).catch((error) =>
                                toast.error(String(error)),
                              )
                            }
                          >
                            Review advisory
                            <ArrowRight className="size-3" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {chainFindings.length > 50 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing 50 of {chainFindings.length} advisory matches. Export for all captured
                    matches.
                  </p>
                )}
              </section>
              <section className="panel overflow-hidden">
                <details>
                  <summary className="cursor-pointer p-5 text-xs font-semibold">
                    Direct runtime declarations · {report.direct.length}
                  </summary>
                  {report.direct
                    .slice(declarationOffset, declarationOffset + pageSize)
                    .map((req) => requirementRow(req, false))}
                  {report.direct.length > pageSize && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t p-4">
                      <p className="text-xs text-muted-foreground">
                        {declarationOffset + 1}–
                        {Math.min(declarationOffset + pageSize, report.direct.length)} of{" "}
                        {report.direct.length} declarations
                      </p>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={declarationOffset === 0}
                          onClick={() =>
                            setDeclarationOffset(Math.max(0, declarationOffset - pageSize))
                          }
                        >
                          Previous declarations
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={declarationOffset + pageSize >= report.direct.length}
                          onClick={() => setDeclarationOffset(declarationOffset + pageSize)}
                        >
                          Next declarations
                        </Button>
                      </div>
                    </div>
                  )}
                </details>
              </section>
              <details className="evidence-disclosure">
                <summary>
                  <h2 className="inline text-xs font-medium">Coverage & interpretation</h2>
                </summary>
                <div className="p-4">
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
                  <details className="mt-4 rounded-lg border p-3">
                    <summary className="cursor-pointer text-xs font-medium">
                      Package snapshot identity
                    </summary>
                    <p className="mt-2 font-mono text-xs leading-5 break-all">
                      {report.fingerprint}
                    </p>
                  </details>
                </div>
              </details>
            </>
          ) : (
            <section className="panel">
              <div className="flex min-h-80 flex-col items-center justify-center px-7 py-10 text-center">
                <GitFork className="mb-5 size-10 text-primary" strokeWidth={1.2} />
                <h2 className="font-heading text-xl font-medium">
                  Make the relationships visible.
                </h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  Inspect installed requirements and potential consumers. Follow each path, identify
                  missing providers, and keep advisory coverage in view.
                </p>
                <p className="mt-5 max-w-sm text-xs leading-6 text-muted-foreground">
                  <CircleHelp className="mr-1 inline size-3" />
                  These are metadata relationships, not evidence of runtime reachability or removal
                  safety.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
