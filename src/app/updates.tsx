import { UpdatePreparation } from "@/features/packages/update-preparation";
import { ComparisonDetails, PackageComparison } from "@/features/packages/package-comparison";
import { PlanSecurity } from "@/features/packages/plan-security";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock3, Download, RefreshCw, ArrowRight, ArrowLeft, Copy, FileCheck2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageHeader, Loading, ErrorState, TextLink } from "@/components/layout/shared";
import { useSnapshot, usePackages, useAudit } from "@/features/packages/queries";
import type { UpdatePlan } from "@/lib/ipc/bindings";
import type { PackageActions } from "@/features/packages/package-browser";
import { request } from "@/lib/ipc/client";
import { bytes, cn, copy, date, downloadJson } from "@/lib/utils";
import { repositoryFreshness } from "@/lib/repository-freshness";
function PlanComparison({ report }: { report: UpdatePlan["comparisons"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-lg border p-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-semibold">
        {report.name} · {report.installedVersion} → {report.candidateVersion}
      </summary>
      {open && (
        <div className="mt-4">
          <ComparisonDetails report={report} />
        </div>
      )}
    </details>
  );
}

export default function Updates({
  navigate,
  ...actions
}: PackageActions & { navigate: (page: string, query?: string) => void }) {
  const snapshot = useSnapshot();
  const audit = useAudit(false);
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState("prepare");
  const [candidateName, setCandidateName] = useState("pacman");
  const packages = usePackages("", "updates", "all", offset);
  const client = useQueryClient();
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    try {
      await client.fetchQuery({
        queryKey: ["snapshot"],
        queryFn: () => request({ command: "snapshot", refresh: true }),
        staleTime: 0,
        retry: false,
        networkMode: "always",
      });
      await client.invalidateQueries({ queryKey: ["packages"] });
      toast.success("Local package inventory refreshed");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setRefreshing(false);
    }
  }
  async function createPlan() {
    if (!snapshot.data || planning || audit.isChecking) return;
    setPlanning(true);
    try {
      const value = await audit.checkPlan(snapshot.data.fingerprint);
      setPlan(value);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Plan creation failed");
      await client.invalidateQueries({ queryKey: ["snapshot"] });
    } finally {
      setPlanning(false);
    }
  }
  const planCurrent =
    !!plan &&
    !snapshot.isError &&
    snapshot.fetchStatus === "idle" &&
    !snapshot.data?.locked &&
    !refreshing &&
    !planning &&
    snapshot.data?.fingerprint === plan.fingerprint &&
    plan.command === (snapshot.data?.omarchy ? "omarchy update" : "sudo pacman -Syu");
  const old = repositoryFreshness(snapshot.data).uncertain;
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="UPDATES"
        title="Updates"
        description="Prepare a full system update and review package changes."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing || planning}
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh inventory
        </Button>
        <Button
          size="sm"
          disabled={
            planning ||
            refreshing ||
            audit.isChecking ||
            !snapshot.data ||
            snapshot.isError ||
            snapshot.fetchStatus !== "idle" ||
            snapshot.data.locked
          }
          onClick={() => void createPlan()}
        >
          <FileCheck2 className="size-3.5" />
          {planning
            ? "Checking plan & advisories…"
            : audit.isChecking
              ? "Advisory check running…"
              : "Create review plan"}
        </Button>
      </PageHeader>
      <Tabs value={view} onValueChange={setView}>
        <TabsList
          aria-label="Update views"
          className="mb-5 max-w-full justify-start overflow-x-auto"
        >
          <TabsTrigger value="prepare">Prepare update</TabsTrigger>
          <TabsTrigger value="changes">Version changes</TabsTrigger>
          <TabsTrigger value="compare">Compare package</TabsTrigger>
        </TabsList>
        <TabsContent value="prepare" forceMount hidden={view !== "prepare"}>
          <UpdatePreparation navigate={navigate} />
        </TabsContent>
        <TabsContent value="changes" forceMount hidden={view !== "changes"} className="space-y-5">
          {old.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-md border border-warning/25 bg-warning-bg/40 px-4 py-3">
              <Clock3 className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-xs leading-5 text-warning">
                Local databases need refresh: {old.map((repo) => repo.name).join(", ")}. An empty
                update list does not mean the system is current.
              </p>
            </div>
          )}
          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <h2 className="text-sm font-medium">Known version changes</h2>
              <span className="text-xs text-muted-foreground">
                {packages.data?.total ?? "…"} in local databases
              </span>
            </div>
            {packages.isPending ? (
              <Loading />
            ) : packages.isError ? (
              <ErrorState error={packages.error} retry={() => void packages.refetch()} />
            ) : !packages.data.items.length ? (
              <div className="px-5 py-12 text-center">
                <h3 className="text-sm font-medium">No newer versions in the local index</h3>
                <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">
                  Use the supported system updater to check current availability. AUR and toolchain
                  updates are outside this list.
                </p>
                <Button
                  className="mt-5"
                  variant="outline"
                  size="sm"
                  onClick={() => setView("compare")}
                >
                  Inspect an installed package
                </Button>
              </div>
            ) : (
              <div className="divide-y">
                {packages.data.items.map((pkg) => (
                  <div key={pkg.id} className="flex flex-wrap items-center gap-3 px-4 py-4">
                    <button
                      className="min-w-0 flex-1 text-left"
                      aria-label={`View ${pkg.name}`}
                      onClick={() => actions.onOpen(pkg)}
                    >
                      <span className="text-sm font-medium">{pkg.name}</span>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {pkg.installedVersion} → {pkg.version}
                      </p>
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCandidateName(pkg.name);
                        setView("compare");
                      }}
                    >
                      Review changes
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {!!packages.data && packages.data.total > 100 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {offset + 1}–{Math.min(offset + 100, packages.data.total)} of{" "}
                  {packages.data.total}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous update page"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 100))}
                  >
                    <ArrowLeft className="size-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next update page"
                    disabled={offset + 100 >= packages.data.total}
                    onClick={() => setOffset(offset + 100)}
                  >
                    <ArrowRight className="size-3" />
                  </Button>
                </div>
              </div>
            )}
          </section>
          <details className="evidence-disclosure">
            <summary>Database timestamps & update scope</summary>
            <div className="space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {snapshot.data?.repositories.map((repo) => (
                  <div key={repo.name}>
                    <p className="text-xs font-medium">{repo.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {repo.updatedAt ? date(repo.updatedAt) : "Database unavailable"}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                ArchHub exports a read-only review plan. Apply changes through{" "}
                {snapshot.data?.omarchy ? "Omarchy’s supported updater" : "the full system updater"}{" "}
                after checking recovery and security evidence. This local comparison uses cached
                databases; the Prepare update view checks repository versions in a temporary
                database.
              </p>
              <TextLink onClick={() => navigate("security")}>Review advisory evidence</TextLink>
            </div>
          </details>
        </TabsContent>
        <TabsContent value="compare" forceMount hidden={view !== "compare"}>
          <PackageComparison key={candidateName} initialName={candidateName} navigate={navigate} />
        </TabsContent>
      </Tabs>
      <Dialog
        open={!!plan}
        onOpenChange={(open) => {
          if (!open) setPlan(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <p className="eyebrow mb-2">REVIEW PLAN</p>
            <DialogTitle className="text-2xl tracking-tight">Update review plan</DialogTitle>
            <DialogDescription>
              Review and export this inventory before using your system updater.
            </DialogDescription>
          </DialogHeader>
          {plan && (
            <>
              <p className="text-xs text-muted-foreground">Captured {date(plan.createdAt)}</p>
              {!planCurrent && (
                <output className="block text-xs text-warning">
                  Current package state changed or unavailable. This is historical evidence; create
                  a new plan before relying on it.
                </output>
              )}
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-4">
                <div>
                  <p className="text-xs text-muted-foreground">Known version changes</p>
                  <p className="mt-1 text-xl font-medium">{plan.packages.length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Estimated package downloads</p>
                  <p className="mt-1 text-xl font-medium">{bytes(plan.downloadSize)}</p>
                </div>
              </div>
              <PlanSecurity key={plan.id} evidence={plan.security ?? null} />
              <div>
                <h3 className="mb-3 text-sm font-semibold">Package metadata comparisons</h3>
                {!plan.comparisonsComplete && (
                  <p className="mb-3 text-xs text-warning">
                    Comparison coverage is partial. Export the plan to review omitted counts and the
                    complete version inventory.
                  </p>
                )}
                {plan.comparisons.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No candidate comparisons in this plan.
                  </p>
                )}
                <div className="space-y-3">
                  {plan.comparisons.map((report) => (
                    <PlanComparison key={report.name} report={report} />
                  ))}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold">Before applying changes</h3>
                <ul className="space-y-2">
                  {plan.preconditions.map((text, index) => (
                    <li key={text} className="flex gap-3 text-xs leading-6 text-muted-foreground">
                      <span className="font-mono text-xs">{index + 1}.</span>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border bg-background p-4">
                <p className="mb-2 text-xs text-muted-foreground">
                  Supported updater · run manually after review
                </p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs">{plan.command}</code>
                  <Button
                    aria-label="Copy updater command"
                    disabled={!planCurrent}
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() =>
                      void copy(plan.command)
                        .then(() => toast.success("Updater command copied"))
                        .catch(() => toast.error("Clipboard unavailable"))
                    }
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              </div>
              <details className="evidence-disclosure">
                <summary>Plan limitations</summary>
                <div className="p-4">
                  {plan.limitations.map((text) => (
                    <p
                      key={text}
                      className="mb-2 text-xs leading-5 text-muted-foreground last:mb-0"
                    >
                      {text}
                    </p>
                  ))}
                </div>
              </details>
              <p className="font-mono text-xs break-all text-muted-foreground">
                State fingerprint: {plan.fingerprint}
              </p>
              <Button
                onClick={() => {
                  downloadJson(`${plan.id}.json`, plan);
                }}
              >
                <Download className="size-4" />
                Export review plan
                <ArrowRight className="ml-auto size-3.5" />
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
