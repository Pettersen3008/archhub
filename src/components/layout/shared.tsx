import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Code2,
  Globe,
  Package as PackageIcon,
  RefreshCw,
  Shield,
  Terminal,
  Zap,
  Bookmark,
  Loader2,
  SearchX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Package, Finding } from "@/lib/ipc/bindings";
import { cn } from "@/lib/utils";
export function PageHeader({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-full min-w-0">
        <p className="sr-only">{label}</p>
        <h1 className="font-heading text-[26px] leading-tight font-semibold tracking-[-.035em] sm:text-[28px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}
export function SectionTitle({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function Loading({ label = "Reading package data…" }: { label?: string }) {
  return (
    <div
      className="panel flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="panel flex flex-col items-center gap-3 p-8 text-center" role="alert">
      <div className="rounded-full bg-warning-bg p-3 text-warning">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="font-semibold">We couldn’t complete this check</h3>
      <p className="max-w-lg text-sm leading-6 text-muted-foreground">{error.message}</p>
      {retry && (
        <Button variant="outline" onClick={retry}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-xl border bg-muted p-3">
        <SearchX className="size-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}
const apps: Record<string, { icon: typeof Globe }> = {
  firefox: { icon: Globe },
  chromium: { icon: Globe },
  code: { icon: Code2 },
  git: { icon: Code2 },
};
export function PackageAvatar({
  pkg,
  size = "normal",
}: {
  pkg: Pick<Package, "name">;
  size?: "normal" | "large";
}) {
  const found = Object.keys(apps).find((key) => pkg.name === key || pkg.name.startsWith(`${key}-`));
  const app = found
    ? apps[found]!
    : {
        icon: pkg.name.includes("lib") ? PackageIcon : pkg.name.includes("font") ? Code2 : Terminal,
      };
  const Icon = app.icon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        size === "large" ? "size-12" : "size-8",
      )}
    >
      <Icon className={size === "large" ? "size-7" : "size-4.5"} strokeWidth={1.65} />
    </span>
  );
}
export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={cn(
        "status",
        source === "aur" || source === "local" ? "status-warn" : "status-neutral",
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {source === "local" ? "Foreign" : source === "aur" ? "AUR" : source}
    </span>
  );
}
export function SignatureBadge({ pkg }: { pkg: Package }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "status",
            pkg.signature === "verified-at-install" ? "status-good" : "status-warn",
          )}
        >
          <Shield className="size-3" />
          {pkg.signature === "verified-at-install" ? "Signature recorded" : "Review origin"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {pkg.signature === "verified-at-install"
          ? "Pacman recorded signature validation at installation. Use File integrity for a separate check of installed files against local metadata."
          : pkg.repository === "aur"
            ? "Community build recipe. Review the source and build files before installation."
            : "Signature validation is not recorded. This does not establish whether the package is unsafe."}
      </TooltipContent>
    </Tooltip>
  );
}
export function Severity({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "status capitalize",
        ["critical", "high"].includes(value)
          ? "status-danger"
          : value === "medium"
            ? "status-warn"
            : "status-neutral",
      )}
    >
      <span className="size-1 rounded-full bg-current" />
      {value}
    </span>
  );
}
export function PackageRow({
  pkg,
  onOpen,
  saved,
  onSave,
}: {
  pkg: Package;
  onOpen: (p: Package) => void;
  saved?: boolean;
  onSave?: (p: Package) => void;
}) {
  return (
    <div className="package-row group flex min-h-[72px] items-center gap-3 border-b px-4 last:border-b-0 sm:px-5">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
        onClick={() => onOpen(pkg)}
        aria-label={`View ${pkg.name}`}
      >
        <PackageAvatar pkg={pkg} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="package-name truncate group-hover:text-primary">{pkg.name}</span>
            {pkg.updateAvailable && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-warning"
                aria-label="Update available"
              />
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{pkg.description}</p>
        </div>
      </button>
      <div className="hidden w-32 shrink-0 truncate text-right font-mono text-xs text-muted-foreground lg:block">
        {pkg.installedVersion ?? pkg.version}
      </div>
      <div className="hidden w-20 shrink-0 text-center sm:block">
        <SourceBadge source={pkg.repository} />
      </div>
      {onSave && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className={cn("size-8 shrink-0", saved ? "text-primary" : "text-muted-foreground")}
              aria-label={`${saved ? "Unsave" : "Save"} ${pkg.name}`}
              onClick={() => onSave(pkg)}
            >
              <Bookmark className={cn("size-3.5", saved && "fill-current")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{saved ? "Remove from saved" : "Save package"}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
export function FindingRow({ finding, onClick }: { finding: Finding; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-start gap-3 border-b px-5 py-4 text-left last:border-b-0 hover:bg-muted/40 disabled:cursor-default"
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          ["critical", "high"].includes(finding.severity)
            ? "bg-danger-bg text-destructive"
            : "bg-warning-bg text-warning",
        )}
      >
        <AlertTriangle className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">{finding.title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {finding.package}
          {finding.line
            ? ` · ${finding.file ?? "source"}:${finding.line}`
            : ` · ${finding.cves.slice(0, 2).join(", ") || "Version evidence"}`}
        </p>
      </div>
      <Severity value={finding.severity} />
      {onClick && <ArrowUpRight className="mt-1 size-3.5 text-muted-foreground" />}
    </button>
  );
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      onClick={onClick}
    >
      {children}
      <ArrowUpRight className="size-3.5" />
    </button>
  );
}
export const sharedIcons = { Check, ArrowDownToLine, Zap };
