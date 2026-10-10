import {
  ArrowRight,
  RefreshCw,
  Shield,
  Package as PackageIcon,
  ScanLine,
  Clock3,
  GitFork,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  PageHeader,
  Loading,
  ErrorState,
  FindingRow,
  SectionTitle,
} from "@/components/layout/shared";
import { useSnapshot, useAudit } from "@/features/packages/queries";
import type { PackageActions } from "@/features/packages/package-browser";
import { request } from "@/lib/ipc/client";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { repositoryFreshness } from "@/lib/repository-freshness";
import { useMaintenanceChecks } from "@/features/packages/maintenance-query";

export default function Overview({
  navigate,
}: PackageActions & { navigate: (page: string) => void }) {
  const snapshot = useSnapshot();
  const audit = useAudit();
  const checks = useMaintenanceChecks();
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    try {
      const value = await request({ command: "snapshot", refresh: true });
      client.setQueryData(["snapshot"], value);
      await client.invalidateQueries({ queryKey: ["packages"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Inventory refresh failed");
    } finally {
      setRefreshing(false);
    }
  }
  if (snapshot.isPending) return <Loading label="Reading your workstation…" />;
  if (snapshot.isError)
    return <ErrorState error={snapshot.error} retry={() => void snapshot.refetch()} />;
  const data = snapshot.data;
  const auditCurrent =
    !audit.isError &&
    !audit.isChecking &&
    !!audit.data &&
    audit.data.fingerprint === data.fingerprint;
  const findings = auditCurrent ? audit.data!.findings : [];
  const { uncertain: staleRepositories, usable: localUpdatesUsable } = repositoryFreshness(data);
  const metrics = [
    {
      label: "Installed packages",
      value: data.installedCount.toLocaleString(),
      note: `${data.explicitCount} explicit`,
      page: "installed",
    },
    {
      label: "Advisory matches",
      value: auditCurrent ? findings.length.toLocaleString() : "—",
      note: audit.isPaused
        ? "Waiting for network access…"
        : audit.isChecking
          ? "Checking installed versions…"
          : auditCurrent
            ? "Installed versions"
            : "Evidence unavailable",
      page: "security",
    },
    {
      label: "Foreign packages",
      value: data.foreignCount.toLocaleString(),
      note: "Origin needs review",
      page: "foreign",
    },
    {
      label: "Repository updates",
      value: checks.repositoriesCurrent
        ? checks.repositories.data!.packages.length.toLocaleString()
        : localUpdatesUsable && data.updateCount
          ? data.updateCount.toLocaleString()
          : "—",
      note: checks.repositoriesCurrent
        ? "Online check"
        : !localUpdatesUsable
          ? "Local indexes need refresh"
          : "Check online for current versions",
      page: "maintenance",
    },
  ];
  const queue = [
    {
      icon: Shield,
      title: "Installed-version advisories",
      detail: audit.isPaused
        ? "Waiting for network access…"
        : audit.isChecking
          ? "Checking the Arch feed…"
          : !auditCurrent
            ? "Current advisory evidence unavailable"
            : findings.length
              ? `${findings.length} matches need applicability review`
              : "No matches in the available feed",
      state: auditCurrent ? `${findings.length} matches` : "Unknown",
      page: "security",
      warning: !auditCurrent || findings.length > 0,
    },
    {
      icon: PackageIcon,
      title: "Package origins",
      detail: `${data.foreignCount} packages are absent from configured repositories`,
      state: data.foreignCount ? "Review origin" : "No foreign packages",
      page: "foreign",
      warning: data.foreignCount > 0,
    },
    {
      icon: Clock3,
      title: "Repository freshness",
      detail: staleRepositories.length
        ? `${staleRepositories.map((repo) => repo.name).join(", ")} databases are missing or over seven days old`
        : "Local database timestamps are within seven days",
      state: staleRepositories.length ? "Refresh needed" : "Local timestamps",
      page: "maintenance",
      warning: staleRepositories.length > 0,
    },
  ].filter((item) => item.warning);
  return (
    <div className="animate-in-soft" data-redesigned-overview>
      <PageHeader
        label="OVERVIEW"
        title="Overview"
        description={`${data.hostname} · package security workspace`}
      >
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh inventory
        </Button>
      </PageHeader>
      <div className="mb-7 grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
        {metrics.map((metric) => (
          <button
            key={metric.label}
            onClick={() => navigate(metric.page)}
            className="group min-w-0 px-4 py-4 text-left transition-colors hover:bg-muted/50 sm:px-5"
          >
            <span className="text-xs text-muted-foreground">{metric.label}</span>
            <div className="mt-3 flex items-center justify-between">
              <span className="stat-value">{metric.value}</span>
              <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{metric.note}</p>
          </button>
        ))}
      </div>
      <section className="panel overflow-hidden">
        <div className="border-b px-5 py-4">
          <SectionTitle title="Review queue" description="Items that need a closer look." />
        </div>
        {queue.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            Nothing flagged in the available metadata. Advisory coverage remains limited.
          </p>
        )}
        <div className="divide-y">
          {queue.map((item) => (
            <button
              aria-label={item.title}
              key={item.title}
              onClick={() => navigate(item.page)}
              className="flex w-full items-start gap-3 px-5 py-5 text-left transition-colors hover:bg-muted/40 sm:items-center"
            >
              <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground sm:mt-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.title}</p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </div>
              <span
                className={cn(
                  "hidden shrink-0 text-xs sm:inline",
                  item.warning ? "text-warning" : "text-muted-foreground",
                )}
              >
                {item.state}
              </span>
              <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground sm:mt-0" />
            </button>
          ))}
        </div>
      </section>
      {auditCurrent && findings.length > 0 && (
        <section className="panel mt-5 overflow-hidden">
          <div className="border-b px-5 py-4">
            <SectionTitle title="Latest advisory matches" />
          </div>
          {findings.slice(0, 3).map((finding) => (
            <FindingRow key={finding.id} finding={finding} onClick={() => navigate("security")} />
          ))}
        </section>
      )}
      <section
        className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4 border-t pt-5"
        aria-label="Inspection tools"
      >
        <h2 className="text-xs text-muted-foreground">Inspect</h2>
        {[
          { icon: ScanLine, title: "AUR recipe", page: "aur" },
          { icon: Shield, title: "Installed files", page: "integrity" },
          { icon: GitFork, title: "Dependency paths", page: "dependencies" },
        ].map((tool) => (
          <button
            key={tool.page}
            aria-label={tool.title}
            className="inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
            onClick={() => navigate(tool.page)}
          >
            <tool.icon className="size-3.5" />
            {tool.title}
            <ArrowRight className="size-3" />
          </button>
        ))}
      </section>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span>
          {auditCurrent
            ? `${audit.data!.uncoveredPackages} packages outside coverage`
            : "Advisory coverage unknown"}
        </span>
        <span>Feed publication freshness unknown</span>
      </div>
    </div>
  );
}
