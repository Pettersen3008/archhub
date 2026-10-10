import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { date } from "@/lib/utils";
import { repositoryFreshness } from "@/lib/repository-freshness";
import { useSnapshot } from "./queries";
import { useMaintenanceChecks } from "./maintenance-query";
import type { MaintenanceReport, Package } from "@/lib/ipc/bindings";
import TerminalCommand from "@/components/layout/terminal-command";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import RecipeWorkbench from "./recipe-workbench";

export default function OnlineUpdates({
  report,
  onOpen,
  navigate,
}: {
  report: MaintenanceReport;
  onOpen: (pkg: Package) => void;
  navigate: (page: string, query?: string) => void;
}) {
  const snapshot = useSnapshot();
  const checks = useMaintenanceChecks();
  const [search, setSearch] = useState("");
  const [repositoryPage, setRepositoryPage] = useState(0);
  const [foreignPage, setForeignPage] = useState(0);
  const [onlyNewer, setOnlyNewer] = useState(false);
  const [selection, setSelection] = useState<{ name: string; revision: number } | null>(null);
  const recipeName = selection?.name;
  const recipe =
    checks.foreignCurrent && selection?.revision === checks.foreign.dataUpdatedAt
      ? checks.foreign.data!.packages.find((row) => row.name === recipeName)?.aur
      : undefined;
  const current =
    !snapshot.isError &&
    !snapshot.data?.locked &&
    snapshot.data?.fingerprint === report.fingerprint;
  const busyRepositories = checks.repositories.fetchStatus !== "idle";
  const busyForeign = checks.foreign.fetchStatus !== "idle";
  const needle = search.trim().toLowerCase();
  const repositoryRows = checks.repositoriesCurrent
    ? checks.repositories.data!.packages.filter((p) => p.name.toLowerCase().includes(needle))
    : [];
  const foreignRows = report.foreign
    .filter((p) => p.name.toLowerCase().includes(needle))
    .map((pkg) => ({
      pkg,
      check: checks.foreignCurrent
        ? checks.foreign.data!.packages.find(
            (p) => p.name === pkg.name && p.installedVersion === pkg.installedVersion,
          )
        : undefined,
    }))
    .filter(
      (row) => !onlyNewer || !checks.foreignCurrent || row.check?.aur?.versionRelation === "newer",
    );
  const repoOffset =
    Math.min(repositoryPage, Math.max(0, Math.ceil(repositoryRows.length / 50) - 1)) * 50;
  const foreignOffset =
    Math.min(foreignPage, Math.max(0, Math.ceil(foreignRows.length / 25) - 1)) * 25;
  const updater = snapshot.data?.omarchy ? "omarchy update" : "sudo pacman -Syu";
  return (
    <div className="space-y-5">
      <section aria-label="System update" className="panel space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-medium">Check first, then update</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          {!repositoryFreshness(snapshot.data).usable
            ? "Local repository indexes are old or unavailable. Zero local changes does not mean your system is current. "
            : "Local indexes are a cached view. "}
          Online checks use your configured mirrors and a separate temporary database.
        </p>
        {!current && (
          <output className="text-xs text-warning">
            Inventory changed, is locked, or is unavailable. Refresh inventory before checking.
          </output>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!current || !report.checkupdatesAvailable || busyRepositories}
            onClick={() => void checks.checkRepositories().catch(() => {})}
          >
            {busyRepositories ? "Checking repositories…" : "Check repositories online"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!current || busyForeign || report.foreign.length === 0}
            onClick={() => {
              setSelection(null);
              void checks.checkForeign().catch(() => {});
            }}
          >
            {busyForeign ? "Checking AUR versions…" : "Check foreign versions on AUR"}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          The AUR check sends the names of {report.foreign.length} installed foreign packages to AUR
          when you click. Name matches do not prove their origin.
        </p>
        {!report.checkupdatesAvailable && (
          <div className="space-y-2">
            <p className="text-xs text-warning">
              Install pacman-contrib to enable online repository checks.
            </p>
            <TerminalCommand
              command={
                snapshot.data?.omarchy
                  ? "omarchy update && sudo pacman -S -- pacman-contrib"
                  : "sudo pacman -Syu -- pacman-contrib"
              }
              label="pacman-contrib install command"
            />
          </div>
        )}
        <TerminalCommand command={updater} label="system update command" />
        <p className="text-xs text-muted-foreground">
          Run the copied command in your terminal. Review its prompts; ArchHub does not apply the
          update.
        </p>
      </section>
      <Input
        aria-label="Search update checks"
        placeholder="Filter package names…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setRepositoryPage(0);
          setForeignPage(0);
        }}
      />
      <section aria-label="Online repository results" className="panel overflow-hidden">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">Repository version changes</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {busyRepositories
              ? "Checking — previous results are withheld"
              : checks.repositories.isError
                ? "Availability unknown"
                : checks.repositoriesCurrent
                  ? `${checks.repositories.data!.packages.length} version changes · checked ${date(checks.repositories.data!.checkedAt)}`
                  : "Online availability not checked for this inventory"}
          </p>
        </div>
        {checks.repositories.isError && !busyRepositories && (
          <p role="alert" className="px-4 py-4 text-xs text-warning">
            {checks.repositories.error.message}
          </p>
        )}
        {checks.repositoriesCurrent &&
          (repositoryRows.length ? (
            <>
              <div className="divide-y">
                {repositoryRows.slice(repoOffset, repoOffset + 50).map((change) => (
                  <div
                    key={change.name}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium break-all">{change.name}</p>
                      <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                        {change.installedVersion} → {change.availableVersion}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Inspect repository update ${change.name}`}
                      onClick={() => navigate("installed", change.name)}
                    >
                      Inspect package
                    </Button>
                  </div>
                ))}
              </div>
              {repositoryRows.length > 50 && (
                <Pagination
                  offset={repoOffset}
                  limit={50}
                  total={repositoryRows.length}
                  previous={() => setRepositoryPage(Math.max(0, repoOffset / 50 - 1))}
                  next={() => setRepositoryPage(repoOffset / 50 + 1)}
                  label="repository"
                />
              )}
            </>
          ) : (
            <p className="px-4 py-5 text-xs text-muted-foreground">
              {needle
                ? "No package names match this filter."
                : "No newer versions reported by the configured mirrors at check time. AUR and toolchains are separate."}
            </p>
          ))}
        {!checks.repositoriesCurrent && !busyRepositories && !checks.repositories.isError && (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            Use Check repositories online to get a fresh list without refreshing the host databases.
          </p>
        )}
      </section>
      <section aria-label="Foreign version results" className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Foreign packages</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {busyForeign
                ? "Checking — previous results are withheld"
                : checks.foreign.isError
                  ? "AUR availability unknown"
                  : checks.foreignCurrent
                    ? `Checked ${date(checks.foreign.data!.checkedAt)} · exact-name matches only`
                    : "AUR versions not checked for this inventory"}
            </p>
          </div>
          <Button
            size="sm"
            variant={onlyNewer ? "secondary" : "outline"}
            disabled={!checks.foreignCurrent}
            aria-pressed={onlyNewer}
            onClick={() => {
              setOnlyNewer(!onlyNewer);
              setForeignPage(0);
            }}
          >
            Newer recipes only
          </Button>
        </div>
        {checks.foreign.isError && !busyForeign && (
          <p role="alert" className="px-4 py-4 text-xs text-warning">
            {checks.foreign.error.message}
          </p>
        )}
        <div className="divide-y">
          {foreignRows.slice(foreignOffset, foreignOffset + 25).map(({ pkg, check }) => (
            <div
              key={pkg.name}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
            >
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                <p className="text-sm font-medium break-all">{pkg.name}</p>
                <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                  {pkg.installedVersion}
                  {check?.aur ? ` → ${check.aur.version}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {!check
                    ? "AUR version unknown"
                    : !check.aur
                      ? "No exact-name AUR match"
                      : check.aur.versionRelation === "newer"
                        ? "Newer AUR recipe available"
                        : check.aur.versionRelation === "older"
                          ? "Installed version is newer than recipe metadata"
                          : "Version matches recipe metadata"}
                </p>
                {check?.aur && (!check.aur.maintainer || check.aur.outOfDate) && (
                  <p className="mt-1 text-xs text-warning">
                    {!check.aur.maintainer ? "Unmaintained recipe" : ""}
                    {check.aur.outOfDate ? " · flagged out of date" : ""}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Inspect ${pkg.name}`}
                onClick={() => onOpen(pkg)}
              >
                Inspect package
              </Button>
              {check?.aur && (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Review recipe for ${pkg.name}`}
                  onClick={() =>
                    setSelection({ name: pkg.name, revision: checks.foreign.dataUpdatedAt })
                  }
                >
                  Review recipe
                </Button>
              )}
            </div>
          ))}
        </div>
        {!foreignRows.length && (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            {report.foreign.length
              ? "No packages match this filter."
              : "No installed foreign packages."}
          </p>
        )}
        {foreignRows.length > 25 && (
          <Pagination
            offset={foreignOffset}
            limit={25}
            total={foreignRows.length}
            previous={() => setForeignPage(Math.max(0, foreignOffset / 25 - 1))}
            next={() => setForeignPage(foreignOffset / 25 + 1)}
            label="foreign"
          />
        )}
        <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">
          Development/VCS recipes may have newer upstream commits despite unchanged version
          metadata. Inspect Origin & trust for the matching recipe and static scan.
        </p>
      </section>
      <Sheet
        open={!!recipe}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-[760px]">
          <SheetHeader>
            <SheetTitle>Recipe review · {recipe?.packageBase}</SheetTitle>
            <SheetDescription>
              Exact-name AUR match for {recipeName}. Installation origin remains unverified.
            </SheetDescription>
          </SheetHeader>
          {recipe && <RecipeWorkbench key={recipe.packageBase} base={recipe.packageBase} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Pagination({
  offset,
  limit,
  total,
  previous,
  next,
  label,
}: {
  offset: number;
  limit: number;
  total: number;
  previous: () => void;
  next: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
      <span className="text-xs text-muted-foreground">
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Previous ${label} checks`}
          disabled={!offset}
          onClick={previous}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Next ${label} checks`}
          disabled={offset + limit >= total}
          onClick={next}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
