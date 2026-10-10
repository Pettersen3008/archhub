import { useRef, useState } from "react";
import {
  Search,
  ArrowRight,
  Shield,
  Package as PackageIcon,
  ScanLine,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { usePackages } from "@/features/packages/queries";
import { useDebounce } from "@/lib/hooks";
import { PackageAvatar, SourceBadge } from "@/components/layout/shared";
import type { Package } from "@/lib/ipc/bindings";
export default function CommandPalette({
  open,
  setOpen,
  navigate,
  onPackage,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
  navigate: (page: string, query?: string) => void;
  onPackage: (pkg: Package) => void;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query);
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const packages = usePackages(debounced, "all", "all", 0, "name", open && debounced.length >= 2);
  const shortcuts = [
    { page: "security", label: "Security overview", icon: Shield },
    { page: "installed", label: "Installed packages", icon: PackageIcon },
    { page: "aur", label: "Browse & scan AUR", icon: ScanLine },
    { page: "updates", label: "Review updates", icon: RefreshCw },
    { page: "maintenance", label: "Package maintenance", icon: Wrench },
  ];
  const matches = query.trim() ? (packages.data?.items.slice(0, 7) ?? []) : [];
  function select(index: number) {
    setOpen(false);
    if (!query.trim()) navigate(shortcuts[index]!.page);
    else if (matches[index]) onPackage(matches[index]!);
    else navigate("packages", query);
  }
  const count = query.trim() ? matches.length + 1 : shortcuts.length;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Search packages and navigate</DialogTitle>
        <DialogDescription className="sr-only">
          Use arrow keys to choose a result and Enter to open it.
        </DialogDescription>
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={input}
            aria-label="Search all packages"
            className="mr-5 w-full bg-transparent text-sm outline-none focus-visible:outline-none"
            placeholder="Search packages, jump to a page…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => (value + 1) % count);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => (value + count - 1) % count);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                select(active);
              }
            }}
          />
        </div>
        <div className="max-h-96 overflow-auto p-2">
          {!query.trim() ? (
            <>
              <p className="eyebrow px-3 py-2">QUICK NAVIGATION</p>
              {shortcuts.map((item, index) => (
                <button
                  key={item.page}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-xs ${active === index ? "bg-accent text-primary" : "hover:bg-muted"}`}
                  onClick={() => select(index)}
                >
                  <item.icon className="size-4" />
                  {item.label}
                  <ArrowRight className="ml-auto size-3" />
                </button>
              ))}
            </>
          ) : (
            <>
              <p className="eyebrow px-3 py-2">PACKAGE RESULTS</p>
              {packages.isFetching && (
                <p aria-live="polite" className="px-3 py-3 text-xs text-muted-foreground">
                  Searching local index…
                </p>
              )}
              {matches.map((pkg, index) => (
                <button
                  key={pkg.id}
                  aria-label={`Open ${pkg.name} from search`}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${active === index ? "bg-accent" : "hover:bg-muted"}`}
                  onClick={() => select(index)}
                >
                  <PackageAvatar pkg={pkg} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{pkg.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{pkg.description}</p>
                  </div>
                  <SourceBadge source={pkg.repository} />
                </button>
              ))}
              <button
                onClick={() => select(matches.length)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-xs text-primary ${active === matches.length ? "bg-accent" : ""}`}
              >
                Search all results for “{query}”<ArrowRight className="size-3" />
              </button>
            </>
          )}
        </div>
        <div className="flex gap-4 border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
          <span>↑ ↓ navigate</span>
          <span>↵ open</span>
          <span className="ml-auto">esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
