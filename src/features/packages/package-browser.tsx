import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, X, ArrowLeft, ArrowRight, SlidersHorizontal, ScanLine, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PackageRow, Empty, Loading, ErrorState, PageHeader } from "@/components/layout/shared";
import { usePackages, useSnapshot } from "./queries";
import { useDebounce } from "@/lib/hooks";
import { request } from "@/lib/ipc/client";
import { readSavedPackages } from "./saved-packages";
import type { Package } from "@/lib/ipc/bindings";
export type BrowserMode = "packages" | "installed" | "aur" | "foreign" | "saved";
export type PackageActions = {
  onOpen: (pkg: Package) => void;
  saved: string[];
  onSave: (pkg: Package) => void;
  onForget: (ids: string[]) => void;
};
const headers = {
  packages: ["PACKAGES", "Repository packages", "Search the configured repository catalog."],
  installed: [
    "PACKAGES",
    "Installed packages",
    "Find a package, inspect its evidence, or review its origin.",
  ],
  aur: [
    "PACKAGES",
    "AUR recipes",
    "Search community packages and inspect build files before installation.",
  ],
  foreign: [
    "PACKAGES",
    "Foreign packages",
    "Open Origin & trust to investigate installed packages and look up possible AUR recipes.",
  ],
  saved: ["PACKAGES", "Saved packages", "Packages bookmarked for another look."],
} as const;
export default function PackageBrowser({
  mode,
  initialSearch = "",
  compact,
  ...actions
}: PackageActions & { mode: BrowserMode; initialSearch?: string; compact: boolean }) {
  const [search, setSearch] = useState(initialSearch);
  const [repository, setRepository] = useState("all");
  const [sort, setSort] = useState("name");
  const [offset, setOffset] = useState(0);
  const [installedFilter, setInstalledFilter] = useState("all");
  const [savedFilter, setSavedFilter] = useState(initialSearch);
  const debounced = useDebounce(search);
  const snapshot = useSnapshot();
  const scope =
    mode === "installed"
      ? installedFilter === "explicit"
        ? "explicit"
        : "installed"
      : mode === "foreign"
        ? "foreign"
        : "all";
  const official = usePackages(
    debounced,
    scope,
    repository,
    offset,
    sort,
    mode !== "aur" && mode !== "saved",
  );
  const aur = useQuery({
    queryKey: ["aur", debounced, snapshot.data?.fingerprint],
    queryFn: ({ signal }) => request({ command: "aur_search", query: debounced }, signal),
    enabled: mode === "aur" && debounced.trim().length >= 2,
    staleTime: 300_000,
    retry: false,
  });
  const saved = useQuery({
    queryKey: ["saved", actions.saved, snapshot.data?.fingerprint],
    queryFn: ({ signal }) => readSavedPackages(actions.saved, signal),
    enabled: mode === "saved" && !!snapshot.data,
    retry: false,
  });
  const active = mode === "aur" ? aur : mode === "saved" ? saved : official;
  const items =
    mode === "saved"
      ? (saved.data?.items ?? []).filter((p) =>
          `${p.name} ${p.description}`.toLowerCase().includes(savedFilter.toLowerCase()),
        )
      : mode === "aur"
        ? (aur.data?.items ?? [])
        : (official.data?.items ?? []);
  const total =
    mode === "saved"
      ? items.length
      : mode === "aur"
        ? (aur.data?.total ?? 0)
        : (official.data?.total ?? 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual owns scroll-derived state; this component is deliberately not React Compiler memoized.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (compact ? 62 : 72),
    overscan: 6,
  });
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [offset, debounced, repository, scope]);
  const [label, title, description] = headers[mode];
  function changeSearch(value: string) {
    setSearch(value);
    setSavedFilter(value);
    setOffset(0);
  }
  return (
    <div className="animate-in-soft">
      <PageHeader label={label} title={title} description={description} />
      {(mode === "aur" || mode === "foreign") && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/15 bg-warning-bg/60 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs leading-6 text-warning">
            {mode === "aur"
              ? "Community recipes are unverified. Open a package to read its build files and run a static scan."
              : "Foreign does not imply AUR. Previous repositories and locally built packages can also appear here."}
          </p>
        </div>
      )}
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-10 border-border/70 bg-background pr-9 pl-9"
              aria-label={mode === "aur" ? "Search AUR packages" : "Search packages"}
              placeholder={
                mode === "aur" ? "Search AUR by package name…" : "Search by name or description…"
              }
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
            />
            {search && (
              <button
                aria-label="Clear search"
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                onClick={() => changeSearch("")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {!["aur", "foreign", "saved"].includes(mode) && (
            <Select
              value={repository}
              onValueChange={(value) => {
                setRepository(value);
                setOffset(0);
              }}
            >
              <SelectTrigger aria-label="Filter by repository" className="h-10 w-36 bg-background">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {snapshot.data?.repositories.map((repo) => (
                  <SelectItem key={repo.name} value={repo.name}>
                    {repo.name}
                  </SelectItem>
                ))}
                <SelectItem value="local">Foreign</SelectItem>
              </SelectContent>
            </Select>
          )}
          {mode !== "aur" && mode !== "saved" && (
            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(value);
                setOffset(0);
              }}
            >
              <SelectTrigger aria-label="Sort packages" className="h-10 w-36 bg-background">
                <SlidersHorizontal className="size-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="size">Package size</SelectItem>
                <SelectItem value="repository">Repository</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        {mode === "saved" && !saved.isError && !!saved.data?.missingIds.length && (
          <div className="border-b p-4 text-sm" aria-live="polite">
            <p>
              {saved.data.missingIds.length} saved{" "}
              {saved.data.missingIds.length === 1 ? "package is" : "packages are"} unavailable in
              the current inventory.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bookmarks remain saved when a repository or package identity changes.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => actions.onForget(saved.data!.missingIds)}
            >
              Remove unavailable bookmarks
            </Button>
          </div>
        )}
        {mode === "installed" && (
          <div className="flex gap-1 border-b px-4 py-2">
            <Button
              size="sm"
              variant={installedFilter === "all" ? "secondary" : "ghost"}
              onClick={() => {
                setInstalledFilter("all");
                setOffset(0);
              }}
            >
              All installed
            </Button>
            <Button
              size="sm"
              variant={installedFilter === "explicit" ? "secondary" : "ghost"}
              onClick={() => {
                setInstalledFilter("explicit");
                setOffset(0);
              }}
            >
              Explicitly installed
            </Button>
          </div>
        )}
        <div className="hidden items-center gap-3 border-b bg-muted/35 px-5 py-2.5 text-xs font-medium tracking-wider text-muted-foreground uppercase sm:flex">
          <span className="flex-1">Package</span>
          <span className="hidden w-32 text-right lg:block">Version</span>
          <span className="w-20 text-center">Source</span>
          <span className="w-8" />
        </div>
        {mode === "aur" && debounced.trim().length < 2 ? (
          <Empty
            title="Start with a package name"
            description="Enter at least two characters to search the AUR. Then inspect a recipe before deciding what to install."
          >
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {["visual-studio-code", "firefox", "bitwarden", "zed"].map((value) => (
                <Button key={value} variant="outline" size="sm" onClick={() => changeSearch(value)}>
                  {value}
                </Button>
              ))}
            </div>
          </Empty>
        ) : active.isPending ? (
          <Loading label={mode === "aur" ? "Searching community packages…" : "Loading packages…"} />
        ) : active.isError ? (
          <ErrorState error={active.error} retry={() => void active.refetch()} />
        ) : !items.length ? (
          <Empty
            title={
              mode === "saved" && !actions.saved.length
                ? "Your collection starts here"
                : "No packages found"
            }
            description={
              mode === "saved" && !actions.saved.length
                ? "Use the bookmark beside any repository package to keep it here."
                : "Try a shorter search or choose a different source filter."
            }
          />
        ) : (
          <div ref={scrollRef} className="h-[min(580px,60vh)] min-h-[260px] overflow-auto">
            <div
              style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
            >
              {virtualizer.getVirtualItems().map((row) => (
                <div
                  key={items[row.index]!.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <PackageRow
                    pkg={items[row.index]!}
                    {...actions}
                    saved={actions.saved.includes(items[row.index]!.id)}
                    onSave={mode === "aur" ? undefined : actions.onSave}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {active.isFetching
              ? "Refreshing…"
              : `${total.toLocaleString()} ${mode === "aur" ? "community recipes" : "packages"}`}
            {mode === "aur" && total > 300 ? " · top 300 shown" : ""}
          </span>
          {mode !== "aur" && mode !== "saved" && (
            <div className="flex items-center gap-2">
              <span className="mr-2 text-xs text-muted-foreground">
                {total
                  ? `${offset + 1}–${Math.min(offset + 100, total)} of ${total.toLocaleString()}`
                  : "0 results"}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                disabled={offset === 0}
                aria-label="Previous page"
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                <ArrowLeft className="size-3" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                disabled={offset + 100 >= total}
                aria-label="Next page"
                onClick={() => setOffset(offset + 100)}
              >
                <ArrowRight className="size-3" />
              </Button>
            </div>
          )}
          {mode === "aur" && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ScanLine className="size-3.5" />
              Static scans never execute recipes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
