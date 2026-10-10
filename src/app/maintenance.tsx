import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, Loading, PageHeader } from "@/components/layout/shared";
import TerminalCommand from "@/components/layout/terminal-command";
import RemovalReview from "@/features/packages/removal-plan";
import { useMaintenance, useMaintenanceChecks } from "@/features/packages/maintenance-query";
import { useSnapshot } from "@/features/packages/queries";
import OnlineUpdates from "@/features/packages/online-updates";
import type { PackageActions } from "@/features/packages/package-browser";
import type { Package } from "@/lib/ipc/bindings";
import { request } from "@/lib/ipc/client";
import { bytes, date, downloadJson } from "@/lib/utils";
import { toast } from "sonner";

export default function Maintenance({
  onOpen,
  navigate,
}: PackageActions & { navigate: (page: string, query?: string) => void }) {
  const snapshot = useSnapshot();
  const maintenance = useMaintenance();
  const checks = useMaintenanceChecks();
  const client = useQueryClient();
  const [view, setView] = useState("updates");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [selection, setSelection] = useState<{ fingerprint: string; names: string[] }>({
    fingerprint: "",
    names: [],
  });
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
      await client.invalidateQueries({ queryKey: ["maintenance"] });
      await client.invalidateQueries({ queryKey: ["packages"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Inventory refresh failed");
    } finally {
      setRefreshing(false);
    }
  }
  if (maintenance.isPending) return <Loading label="Reading package maintenance data…" />;
  if (maintenance.isError)
    return <ErrorState error={maintenance.error} retry={() => void maintenance.refetch()} />;
  const data = maintenance.data;
  const current =
    snapshot.fetchStatus === "idle" &&
    !snapshot.isError &&
    snapshot.data?.fingerprint === data.fingerprint &&
    !snapshot.data.locked;
  const orphans = data.orphans.filter((p) =>
    `${p.name} ${p.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const offset = Math.min(page, Math.max(0, Math.ceil(orphans.length / 25) - 1)) * 25;
  const selected =
    selection.fingerprint === data.fingerprint
      ? data.orphans.filter((pkg) => selection.names.includes(pkg.name))
      : [];
  const visible = orphans.slice(offset, offset + 25);
  const combined = [
    ...new Set([...selected.map((pkg) => pkg.name), ...visible.map((pkg) => pkg.name)]),
  ];
  function select(name: string, checked: boolean) {
    setSelection({
      fingerprint: data.fingerprint,
      names: checked
        ? [...selected.map((pkg) => pkg.name), name]
        : selected.filter((pkg) => pkg.name !== name).map((pkg) => pkg.name),
    });
  }
  const cacheBytes = data.caches.reduce((total, cache) => total + cache.bytes, 0);
  const cachesComplete = data.caches.every((cache) => cache.complete);
  function exportReport() {
    void downloadJson("archhub-maintenance.json", {
      maintenance: data,
      currentSnapshotMatches: current,
      repositoryCheckStatus:
        checks.repositories.fetchStatus !== "idle"
          ? "pending"
          : checks.repositories.isError
            ? "failed"
            : checks.repositoriesCurrent
              ? "captured"
              : "not-current",
      foreignCheckStatus:
        checks.foreign.fetchStatus !== "idle"
          ? "pending"
          : checks.foreign.isError
            ? "failed"
            : checks.foreignCurrent
              ? "captured"
              : "not-current",
      repositoryUpdates: checks.repositoriesCurrent ? checks.repositories.data : null,
      foreignUpdates: checks.foreignCurrent ? checks.foreign.data : null,
    });
  }
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="MAINTENANCE"
        title="Maintenance"
        description="Check updates, review unused dependencies, and understand package disk usage."
      >
        <Button size="sm" variant="outline" onClick={exportReport}>
          <Download className="size-3.5" />
          Export maintenance
        </Button>
        <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw className="size-3.5" />
          Refresh inventory
        </Button>
      </PageHeader>
      <div className="mb-5 grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0">
        {[
          ["Installed size", bytes(snapshot.data?.installedSize ?? 0)],
          ["Orphan packages", String(data.orphans.length)],
          [
            "Package cache",
            `${cachesComplete ? "" : "At least "}${cacheBytes ? bytes(cacheBytes) : "0 B"}`,
          ],
          ["Foreign packages", String(data.foreign.length)],
        ].map(([label, value]) => (
          <div className="min-w-0 px-4 py-4" key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-lg font-medium break-words">{value}</p>
          </div>
        ))}
      </div>
      {!current && (
        <output className="mb-4 text-xs text-warning">
          Package state changed, is locked, or is unavailable. This capture is historical until
          inventory refresh succeeds.
        </output>
      )}
      <Tabs value={view} onValueChange={setView}>
        <TabsList aria-label="Maintenance tools" className="mb-5">
          <TabsTrigger value="updates">Update checks</TabsTrigger>
          <TabsTrigger value="orphans">Orphans</TabsTrigger>
          <TabsTrigger value="disk">Disk usage</TabsTrigger>
        </TabsList>
        <TabsContent value="updates" forceMount hidden={view !== "updates"}>
          <OnlineUpdates report={data} onOpen={onOpen} navigate={navigate} />
        </TabsContent>
        <TabsContent value="orphans" forceMount hidden={view !== "orphans"} className="space-y-4">
          <p className="text-xs leading-6 text-muted-foreground">
            These packages were installed as dependencies and have no required or optional installed
            consumers, matching pacman -Qdt. You may still use them directly. Inspect each before
            removing it.
          </p>
          <Input
            aria-label="Search orphan packages"
            placeholder="Search names or descriptions…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          {!!data.orphans.length && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!current || !visible.length || combined.length > 100}
                  onClick={() => setSelection({ fingerprint: data.fingerprint, names: combined })}
                >
                  Select this page
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!selected.length}
                  onClick={() => setSelection({ fingerprint: data.fingerprint, names: [] })}
                >
                  Clear selection
                </Button>
                <output className="text-xs text-muted-foreground">
                  {selected.length} selected · limit 100
                </output>
              </div>
              {!!selected.length && (
                <>
                  <details className="evidence-disclosure">
                    <summary>Selected packages ({selected.length})</summary>
                    <ul className="max-h-60 overflow-y-auto p-3">
                      {selected.map((pkg) => (
                        <li
                          key={pkg.name}
                          className="flex items-center justify-between gap-3 py-1 text-xs"
                        >
                          <span className="min-w-0 break-all">{pkg.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Unselect ${pkg.name}`}
                            onClick={() => select(pkg.name, false)}
                          >
                            Unselect
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <RemovalReview
                    sourceFingerprint={data.fingerprint}
                    targets={selected.map((pkg) => ({
                      name: pkg.name,
                      version: pkg.installedVersion!,
                    }))}
                  />
                </>
              )}
            </div>
          )}
          <section aria-label="Orphan packages" className="panel divide-y overflow-hidden">
            {visible.map((pkg) => (
              <PackageRow key={pkg.name} pkg={pkg} onOpen={onOpen}>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    aria-label={`Select ${pkg.name} for removal review`}
                    className="size-4 accent-primary"
                    checked={selected.some((p) => p.name === pkg.name)}
                    disabled={
                      !current ||
                      (selected.length >= 100 && !selected.some((p) => p.name === pkg.name))
                    }
                    onChange={(event) => select(pkg.name, event.target.checked)}
                  />
                  Select
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Inspect consumers of ${pkg.name}`}
                  onClick={() => navigate("dependencies", pkg.name)}
                >
                  Dependency paths
                </Button>
              </PackageRow>
            ))}
            {!orphans.length && (
              <p className="px-4 py-6 text-xs text-muted-foreground">
                {search
                  ? "No orphan packages match this filter."
                  : "No orphan packages in this capture."}
              </p>
            )}
            {orphans.length > 25 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  {offset + 1}–{Math.min(offset + 25, orphans.length)} of {orphans.length}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Previous orphan page"
                    disabled={!offset}
                    onClick={() => setPage(Math.max(0, offset / 25 - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Next orphan page"
                    disabled={offset + 25 >= orphans.length}
                    onClick={() => setPage(offset / 25 + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </section>
        </TabsContent>
        <TabsContent value="disk" forceMount hidden={view !== "disk"} className="space-y-5">
          <section aria-label="Package caches" className="panel space-y-4 p-4 sm:p-5">
            <h2 className="text-sm font-medium">Package caches</h2>
            <p className="text-xs leading-5 text-muted-foreground">
              Regular-file sizes in configured cache directories. These totals do not estimate
              reclaimable space. Keeping cached versions can help with downgrades.
            </p>
            {data.caches.map((cache) => (
              <div key={cache.path} className="border-t pt-3">
                <p className="font-mono text-xs break-all">{cache.path}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {cache.complete ? "" : "Partial: "}
                  {cache.bytes ? bytes(cache.bytes) : "0 B"} · {cache.files} files
                </p>
                {cache.warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-xs text-warning">
                    {warning}
                  </p>
                ))}
              </div>
            ))}
            {data.paccacheAvailable ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Preview cleanup candidates while keeping the last three versions:
                </p>
                <TerminalCommand command="paccache -d -k 3" label="cache cleanup preview command" />
              </>
            ) : (
              <p className="text-xs text-warning">
                Install pacman-contrib for the paccache cleanup preview.
              </p>
            )}
          </section>
          <section aria-label="Largest installed packages" className="panel overflow-hidden">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-medium">Largest installed packages</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Top 20 by installed metadata size.
              </p>
            </div>
            <div className="divide-y">
              {data.largest.map((pkg) => (
                <PackageRow key={pkg.name} pkg={pkg} onOpen={onOpen} />
              ))}
            </div>
          </section>
        </TabsContent>
      </Tabs>
      <details className="evidence-disclosure mt-5">
        <summary>Capture & limitations</summary>
        <div className="space-y-3 p-4">
          <p className="text-xs text-muted-foreground">
            Inventory captured {date(data.capturedAt)}
          </p>
          {data.limitations.map((item) => (
            <p key={item} className="text-xs leading-5 text-muted-foreground">
              {item}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

function PackageRow({
  pkg,
  onOpen,
  children,
}: {
  pkg: Package;
  onOpen: (pkg: Package) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-4">
      <button
        className="w-full min-w-0 text-left sm:w-auto sm:flex-1"
        aria-label={`View ${pkg.name}`}
        onClick={() => onOpen(pkg)}
      >
        <p className="text-sm font-medium break-all">{pkg.name}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{pkg.description}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{pkg.installedVersion}</p>
      </button>
      <span className="text-xs text-muted-foreground">
        {pkg.installedSize ? bytes(pkg.installedSize) : "0 B"}
      </span>
      {children}
    </div>
  );
}
