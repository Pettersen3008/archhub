import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState, SectionTitle } from "@/components/layout/shared";
import type { ForeignRecipeLookup, Package } from "@/lib/ipc/bindings";
import { request } from "@/lib/ipc/client";
import { date, downloadJson } from "@/lib/utils";
import { useSnapshot } from "./queries";
import RecipeWorkbench from "./recipe-workbench";

export default function ForeignRecipe({ pkg }: { pkg: Package }) {
  const snapshot = useSnapshot();
  const client = useQueryClient();
  const [report, setReport] = useState<ForeignRecipeLookup | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [inspect, setInspect] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const current =
    !!report &&
    !snapshot.isError &&
    report.name === pkg.name &&
    report.installedVersion === pkg.installedVersion &&
    report.fingerprint === snapshot.data?.fingerprint;
  const match = report?.aur;
  useEffect(() => {
    if (inspect) {
      region.current?.scrollIntoView({ block: "nearest" });
      region.current?.focus({ preventScroll: true });
    }
  }, [inspect]);
  async function lookup() {
    if (!snapshot.data || !pkg.installedVersion || pending) return;
    setPending(true);
    setReport(null);
    setError(null);
    setInspect(false);
    try {
      setReport(
        await request({
          command: "foreign_recipe",
          name: pkg.name,
          version: pkg.installedVersion,
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
  async function refresh() {
    setRefreshing(true);
    setReport(null);
    setInspect(false);
    setError(null);
    try {
      client.setQueryData(["snapshot"], await request({ command: "snapshot", refresh: true }));
      await client.invalidateQueries({ queryKey: ["packages"] });
    } catch (error) {
      setError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <section className="space-y-4 border-t pt-5" aria-label="Foreign package recipe lookup">
      <SectionTitle title="Possible AUR recipe" />
      <p className="text-xs leading-5 text-muted-foreground">
        This package is absent from configured repositories. Look up its exact name in AUR. A match
        is a recipe to investigate; installation origin and installed bytes remain unverified.
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        This action sends only <code className="break-all">{pkg.name}</code> to aur.archlinux.org.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={
            pending || refreshing || snapshot.isError || !snapshot.data || !pkg.installedVersion
          }
          onClick={() => void lookup()}
        >
          <RefreshCw className="size-3.5" />
          {pending ? "Looking up recipe…" : report ? "Recheck AUR recipe" : "Look up AUR recipe"}
        </Button>
        {(error || snapshot.isError || (report && !current)) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Refreshing…" : "Refresh lookup inventory"}
          </Button>
        )}
      </div>
      {(pending || refreshing) && (
        <output className="block text-xs text-muted-foreground">
          {pending ? "Checking exact-name metadata…" : "Refreshing local package evidence…"}
        </output>
      )}
      {error && <ErrorState error={error} retry={() => void lookup()} />}
      {snapshot.isError && (
        <output className="block text-xs text-warning">
          Current inventory unavailable. Refresh before looking up a recipe.
        </output>
      )}
      {report && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Looked up {date(report.checkedAt)}</p>
          {!current && (
            <output className="block text-xs leading-5 text-warning">
              Package state changed or unavailable. Recheck before inspecting this association.
              Reopen details if the installed version changed.
            </output>
          )}
          {match ? (
            <>
              <div className="space-y-3 rounded-md border p-4 text-xs">
                <p className="font-semibold break-all">Exact-name AUR match · origin unverified</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Recipe base", match.packageBase],
                    ["Installed version", report.installedVersion],
                    ["AUR version", `${match.version} · ${match.versionRelation}`],
                    ["AUR maintainer", match.maintainer ?? "Unmaintained"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-1 font-mono break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-muted-foreground">
                  AUR metadata modified {date(match.lastModified)}
                </p>
                {(!match.maintainer || match.outOfDate) && (
                  <p className="text-warning">
                    {!match.maintainer ? "Recipe has no maintainer" : "Recipe flagged out of date"}
                    {!match.maintainer && match.outOfDate ? " · flagged out of date" : ""}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!current || inspect}
                onClick={() => setInspect(true)}
              >
                <ScanLine className="size-3.5" />
                Inspect matching recipe
              </Button>
            </>
          ) : (
            <p className="text-xs leading-5">
              No exact-name AUR match at lookup time. It may be a local/private build, a removed
              repository, or a deleted or renamed recipe. Origin remains unknown.
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              downloadJson(`archhub-${pkg.name}-aur-lookup.json`, {
                lookup: report,
                currentSnapshotMatches: current,
              })
            }
          >
            <Download className="size-3.5" />
            Export lookup evidence
          </Button>
          <details className="evidence-disclosure">
            <summary>Lookup scope & limitations</summary>
            <ul className="space-y-2 p-3 text-xs leading-5 text-muted-foreground">
              {report.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
          {inspect && current && match && (
            <div
              ref={region}
              tabIndex={-1}
              aria-label="Matching AUR recipe review"
              className="border-t pt-5"
            >
              <p className="mb-4 text-xs leading-5 text-warning">
                This reviews the matching AUR recipe, not the installed artifact. RPC metadata and
                the pinned scan are separate captures.
              </p>
              <RecipeWorkbench key={match.packageBase} base={match.packageBase} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
