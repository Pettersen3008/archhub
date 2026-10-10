import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Loading } from "@/components/layout/shared";
import {
  ChevronRight,
  Command,
  History as HistoryIcon,
  LayoutDashboard,
  Menu,
  Monitor,
  Package as PackageIcon,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Shield,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useStored } from "@/lib/hooks";
import { cn, relativeTime } from "@/lib/utils";
import { useRemovalTask } from "@/features/packages/removal-task";
import { useSnapshot } from "@/features/packages/queries";
import type { Package } from "@/lib/ipc/bindings";
const PackageBrowser = lazy(() => import("@/features/packages/package-browser"));
import PackageDetail from "@/features/packages/package-detail";
import Overview from "./overview";
const Security = lazy(() => import("./security"));
const Integrity = lazy(() => import("./integrity"));
const Dependencies = lazy(() => import("./dependencies"));
const Updates = lazy(() => import("./updates"));
const Maintenance = lazy(() => import("./maintenance"));
const History = lazy(() => import("./history"));
const RecipeReviews = lazy(() => import("./recipe-reviews"));
import type { Preferences } from "./settings";
const Settings = lazy(() => import("./settings"));
import CommandPalette from "./command-palette";
const packageViews = [
  { id: "installed", label: "Installed" },
  { id: "packages", label: "Repositories" },
  { id: "aur", label: "AUR & static scans" },
  { id: "foreign", label: "Foreign" },
  { id: "saved", label: "Saved" },
];
const securityViews = [
  { id: "security", label: "Advisories" },
  { id: "integrity", label: "File integrity" },
  { id: "dependencies", label: "Dependency paths" },
  { id: "reviews", label: "Recipe reviews" },
];
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, pages: ["overview"] },
  {
    id: "installed",
    label: "Packages",
    icon: PackageIcon,
    pages: packageViews.map((item) => item.id),
  },
  { id: "security", label: "Security", icon: Shield, pages: securityViews.map((item) => item.id) },
  { id: "updates", label: "Updates", icon: RefreshCw, pages: ["updates"] },
  { id: "maintenance", label: "Maintenance", icon: Wrench, pages: ["maintenance"] },
  { id: "history", label: "Activity", icon: HistoryIcon, pages: ["history"] },
];
const pages = [...navigation.flatMap((item) => item.pages), "settings"];
function route() {
  const hash = window.location.hash.slice(2).split("?");
  return {
    page: pages.includes(hash[0] ?? "") ? hash[0]! : "overview",
    query: new URLSearchParams(hash[1]).get("q") ?? "",
  };
}
export default function App() {
  useRemovalTask();
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("removal-close-blocked", () =>
          toast.error(
            "A removal task is running. Keep ArchHub open until its outcome is shown in Activity.",
          ),
        ),
      )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const [current, setCurrent] = useState(route);
  const [selected, setSelected] = useState<Package | null>(null);
  const [palette, setPalette] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [saved, setSaved] = useStored<string[]>(
    "archhub.saved",
    [],
    (value): value is string[] =>
      Array.isArray(value) &&
      value.length <= 1000 &&
      value.every((id) => typeof id === "string" && id.length < 400),
  );
  const [preferences, setPreferences] = useStored<Preferences>(
    "archhub.preferences",
    {
      theme: "light",
      compact: true,
    },
    (value): value is Preferences =>
      typeof value === "object" &&
      value !== null &&
      "theme" in value &&
      ["light", "dark", "system"].includes(String(value.theme)) &&
      "compact" in value &&
      typeof value.compact === "boolean",
  );
  const snapshot = useSnapshot();
  const inventoryFingerprint = useRef<string | undefined>(undefined);
  useEffect(() => {
    const fingerprint = snapshot.data?.fingerprint;
    if (!fingerprint) return;
    if (inventoryFingerprint.current && inventoryFingerprint.current !== fingerprint) {
      if (selected)
        toast.info("Inventory changed. Reopen the package to inspect current evidence.");
      setSelected(null);
    }
    inventoryFingerprint.current = fingerprint;
  }, [snapshot.data?.fingerprint, selected]);
  const main = useRef<HTMLElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const activeArea = navigation.find((item) => item.pages.includes(current.page));
  const views = packageViews.some((item) => item.id === current.page)
    ? packageViews
    : securityViews.some((item) => item.id === current.page)
      ? securityViews
      : [];
  const label =
    views.find((item) => item.id === current.page)?.label ?? activeArea?.label ?? "Settings";
  function navigationContent() {
    return (
      <>
        <button
          className="flex items-center gap-2.5 px-5 py-7 text-left"
          onClick={() => navigate("overview")}
          aria-label="ArchHub home"
        >
          <img src="/archhub.svg" alt="" className="size-7" />
          <span className="font-heading text-lg font-semibold tracking-[-.035em]">archhub</span>
        </button>
        <nav aria-label="Main areas" className="flex-1 space-y-1 px-3">
          {navigation.map((item) => (
            <button
              key={item.id}
              className="nav-item"
              data-active={activeArea?.id === item.id}
              aria-current={activeArea?.id === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon className="size-4 shrink-0" strokeWidth={1.7} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.id === "updates" && !!snapshot.data?.updateCount && (
                <span className="font-mono text-xs text-warning">{snapshot.data.updateCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mx-4 mb-4 border-t pt-4">
          <div className="mb-3 flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <Monitor className="size-3.5" />
            <span className="truncate">{snapshot.data?.hostname ?? "This workstation"}</span>
          </div>
          <button
            className="nav-item"
            data-active={current.page === "settings"}
            aria-current={current.page === "settings" ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <SettingsIcon className="size-4" />
            Settings
          </button>
        </div>
      </>
    );
  }
  useEffect(() => {
    const change = () => {
      setCurrent(route());
      setMobile(false);
      if (main.current) main.current.scrollTop = 0;
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      document.documentElement.classList.toggle(
        "dark",
        preferences.theme === "dark" || (preferences.theme === "system" && media.matches),
      );
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preferences.theme]);
  useEffect(() => {
    document.title = `${label} · ArchHub`;
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(`${label} · ArchHub`))
        .catch(() => {
          /* Navigation remains available if the window title cannot be changed. */
        });
    }
  }, [label]);
  function navigate(page: string, query = "") {
    window.location.hash = `/${page}${query ? `?q=${encodeURIComponent(query)}` : ""}`;
    setMobile(false);
  }
  function onSave(pkg: Package) {
    if (pkg.repository === "aur") {
      toast.info(
        "Save repository packages from Explore. AUR recipes can change; export a scan to keep evidence.",
      );
      return;
    }
    const exists = saved.includes(pkg.id);
    if (!exists && saved.length >= 1000) {
      toast.error(
        "Your collection holds up to 1000 packages. Remove a bookmark before adding another.",
      );
      return;
    }
    setSaved((previous) =>
      exists ? previous.filter((id) => id !== pkg.id) : [...previous, pkg.id],
    );
    toast.success(exists ? `${pkg.name} removed from saved` : `${pkg.name} saved`);
  }
  const actions = {
    onOpen: setSelected,
    saved,
    onSave,
    onForget: (ids: string[]) => setSaved((previous) => previous.filter((id) => !ids.includes(id))),
  };
  return (
    <div className={cn("flex min-h-screen", preferences.compact && "compact")}>
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
        className="sr-only fixed top-2 left-2 z-[100] rounded bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <aside
        aria-label="Main navigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-[196px] flex-col border-r bg-sidebar lg:flex"
      >
        {navigationContent()}
      </aside>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent
          side="left"
          className="w-[240px] gap-0 bg-sidebar p-0"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            navigationTrigger.current?.focus();
          }}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {navigationContent()}
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col lg:ml-[196px]">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-5 backdrop-blur-sm sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              className="size-8 lg:hidden"
              aria-label="Open navigation"
              ref={navigationTrigger}
              onClick={() => setMobile(true)}
            >
              <Menu className="size-4" />
            </Button>
            <span
              className={cn(
                "text-xs text-muted-foreground",
                views.length > 0 && "hidden sm:inline",
              )}
            >
              {views.length ? activeArea?.label : label}
            </span>
            {views.length > 0 && (
              <>
                <ChevronRight className="hidden size-3 text-muted-foreground sm:block" />
                <span className="truncate text-xs font-medium">{label}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              aria-label="Search anything"
              onClick={() => setPalette(true)}
              className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground hover:border-primary/30"
            >
              <Search className="size-3.5" />
              <span className="hidden sm:inline">Search anything</span>
              <kbd className="ml-3 hidden items-center gap-0.5 rounded border bg-background px-1 text-xs sm:flex">
                <Command className="size-2.5" />K
              </kbd>
            </button>
            <span className="hidden text-xs text-muted-foreground md:inline">Local inventory</span>
          </div>
        </header>
        <main
          id="main"
          ref={main}
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pt-6 pb-8 outline-none sm:px-7 lg:px-8"
        >
          <div className="mx-auto max-w-[1240px]">
            {(snapshot.data?.locked || !!snapshot.data?.warnings.length) && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-3 rounded-lg border border-warning/20 bg-warning-bg p-4 text-xs leading-6 text-warning"
              >
                <TriangleAlert className="mt-1 size-4 shrink-0" />
                <div>
                  {snapshot.data.locked && (
                    <p>
                      The package database is locked by another process. Plan creation will wait
                      until it finishes.
                    </p>
                  )}
                  {snapshot.data.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              </div>
            )}
            {views.length > 0 && (
              <nav
                className="workspace-tabs"
                aria-label={activeArea?.id === "installed" ? "Package views" : "Security tools"}
              >
                {views.map((view) => (
                  <a
                    key={view.id}
                    href={`#/${view.id}`}
                    aria-current={current.page === view.id ? "page" : undefined}
                  >
                    {view.label}
                  </a>
                ))}
              </nav>
            )}
            <Suspense fallback={<Loading label="Opening workspace…" />}>
              {current.page === "overview" ? (
                <Overview {...actions} navigate={navigate} />
              ) : current.page === "security" ? (
                <Security key={current.query} initialQuery={current.query} navigate={navigate} />
              ) : current.page === "integrity" ? (
                <Integrity key={current.query} initialQuery={current.query} />
              ) : current.page === "dependencies" ? (
                <Dependencies
                  key={current.query}
                  initialQuery={current.query}
                  navigate={navigate}
                />
              ) : current.page === "updates" ? (
                <Updates {...actions} navigate={navigate} />
              ) : current.page === "history" ? (
                <History />
              ) : current.page === "maintenance" ? (
                <Maintenance {...actions} navigate={navigate} />
              ) : current.page === "reviews" ? (
                <RecipeReviews navigate={navigate} />
              ) : current.page === "settings" ? (
                <Settings preferences={preferences} setPreferences={setPreferences} />
              ) : (
                <PackageBrowser
                  key={`${current.page}-${current.query}`}
                  mode={current.page as "packages" | "installed" | "aur" | "foreign" | "saved"}
                  initialSearch={current.query}
                  compact={preferences.compact}
                  {...actions}
                />
              )}
            </Suspense>
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4 text-xs text-muted-foreground sm:px-7 lg:px-8">
          <span className="flex items-center gap-1.5">
            <Shield className="size-3" />
            Read-only workspace
          </span>
          <span>
            {snapshot.data
              ? `Inventory captured ${relativeTime(snapshot.data.capturedAt)}`
              : "Connecting to package inventory…"}
          </span>
        </footer>
      </div>
      <PackageDetail
        pkg={selected}
        close={() => setSelected(null)}
        saved={saved}
        onSave={onSave}
        inspectFiles={(pkg) => {
          setSelected(null);
          navigate("integrity", pkg.name);
        }}
        inspectDependencies={(pkg) => {
          setSelected(null);
          navigate("dependencies", pkg.name);
        }}
      />
      <CommandPalette
        key={String(palette)}
        open={palette}
        setOpen={setPalette}
        navigate={navigate}
        onPackage={setSelected}
      />
    </div>
  );
}
