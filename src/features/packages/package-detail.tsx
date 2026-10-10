import { useState } from "react";
import { Bookmark, ExternalLink, ScanLine, Shield, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PackageAvatar,
  SourceBadge,
  SignatureBadge,
  SectionTitle,
} from "@/components/layout/shared";
import RecipeWorkbench from "./recipe-workbench";
import ForeignRecipe from "./foreign-recipe";
import PackageActions from "./package-actions";
import type { Package } from "@/lib/ipc/bindings";
import { bytes, cn, openUrl, safeUrl } from "@/lib/utils";
export default function PackageDetail({
  pkg,
  close,
  saved,
  onSave,
  inspectFiles,
  inspectDependencies,
}: {
  pkg: Package | null;
  close: () => void;
  saved: string[];
  onSave: (pkg: Package) => void;
  inspectFiles: (pkg: Package) => void;
  inspectDependencies: (pkg: Package) => void;
}) {
  return (
    <Sheet
      open={!!pkg}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
        {pkg && (
          <Detail
            key={pkg.id}
            pkg={pkg}
            saved={saved.includes(pkg.id)}
            onSave={() => onSave(pkg)}
            inspectFiles={() => inspectFiles(pkg)}
            inspectDependencies={() => inspectDependencies(pkg)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
function Detail({
  pkg,
  saved,
  onSave,
  inspectFiles,
  inspectDependencies,
}: {
  pkg: Package;
  saved: boolean;
  onSave: () => void;
  inspectFiles: () => void;
  inspectDependencies: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [scanEnabled, setScanEnabled] = useState(false);
  const website = safeUrl(pkg.url);
  const source =
    pkg.repository === "aur"
      ? `https://aur.archlinux.org/packages/${encodeURIComponent(pkg.name)}`
      : ["core", "extra", "multilib"].includes(pkg.repository)
        ? `https://archlinux.org/packages/?q=${encodeURIComponent(pkg.name)}`
        : website;
  function open(value: string) {
    void openUrl(value).catch((error) => toast.error(String(error)));
  }
  return (
    <>
      <SheetHeader className="border-b px-6 pt-8 pb-6 sm:px-8">
        <p className="eyebrow mb-4">PACKAGE DETAILS</p>
        <div className="flex items-center gap-4">
          <PackageAvatar pkg={pkg} size="large" />
          <div className="min-w-0">
            <SheetTitle className="font-heading text-[25px] font-medium tracking-tight break-all">
              {pkg.name}
            </SheetTitle>
            <SheetDescription className="mt-1 font-mono text-xs">{pkg.version}</SheetDescription>
            <div className="mt-2 flex gap-2">
              <SourceBadge source={pkg.repository} />
              {pkg.installedVersion && <span className="status status-good">Installed</span>}
              {pkg.repository === "aur" && !pkg.maintainer && (
                <span className="status status-warn">Unmaintained</span>
              )}
              {pkg.outOfDate && <span className="status status-warn">Flagged out of date</span>}
            </div>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">{pkg.description}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {source && (
            <Button size="sm" variant="outline" onClick={() => open(source)}>
              <ExternalLink className="size-3.5" />
              Package source
            </Button>
          )}
          {website && (
            <Button size="sm" variant="ghost" onClick={() => open(website)}>
              Website
              <ExternalLink className="size-3" />
            </Button>
          )}
          <Button
            aria-label={saved ? "Remove saved package" : "Save package"}
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={pkg.repository === "aur"}
            onClick={onSave}
          >
            <Bookmark className={cn("size-3.5", saved && "fill-current")} />
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
      </SheetHeader>
      <Tabs value={tab} onValueChange={setTab} className="gap-0">
        <div className="border-b px-6 py-3 sm:px-8">
          <TabsList className="h-9 w-full">
            <TabsTrigger value="overview" className="text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="trust" className="text-xs">
              Origin & trust
            </TabsTrigger>
            {pkg.packageBase && (
              <TabsTrigger value="recipe" className="text-xs">
                <ScanLine className="mr-1 size-3.5" />
                Static scan
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        <TabsContent value="overview" className="space-y-7 p-6 sm:p-8">
          <PackageActions pkg={pkg} />
          <section>
            <SectionTitle title="Package information" />
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-5">
              {[
                ["Available version", pkg.version],
                ["Installed version", pkg.installedVersion ?? "Not installed"],
                [
                  "Repository",
                  pkg.repository === "local" ? "Foreign / unverified" : pkg.repository,
                ],
                ["Architecture", pkg.architecture],
                ["Installed size", bytes(pkg.installedSize)],
                ["Download size", bytes(pkg.downloadSize)],
                ["License", pkg.licenses.join(", ") || "Not in this metadata"],
                [
                  "Install reason",
                  pkg.installedVersion ? (pkg.explicit ? "Explicit" : "Dependency") : "—",
                ],
                ...(pkg.packageBase !== null
                  ? [
                      ["AUR maintainer", pkg.maintainer ?? "Unmaintained"],
                      ["Community votes", String(pkg.votes ?? 0)],
                    ]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="mb-1.5 text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-xs break-all">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          {pkg.updateAvailable && (
            <div className="rounded-lg border bg-warning-bg/50 p-4">
              <p className="text-xs font-medium text-warning">
                A newer version is in the local package index
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs">
                {pkg.installedVersion}
                <ArrowRight className="size-3" />
                {pkg.version}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Use a coordinated full system upgrade after reviewing changes.
              </p>
            </div>
          )}
          <section>
            <SectionTitle
              title="Dependencies"
              description={
                pkg.repository === "aur"
                  ? "See captured build metadata"
                  : `Declared for ${pkg.repository === "local" ? "installed" : "available"} version ${pkg.version}`
              }
            />
            {pkg.dependencies.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {pkg.dependencies.map((dependency) => (
                  <span
                    key={dependency}
                    className="rounded-md border bg-background px-2 py-1 font-mono text-xs"
                  >
                    {dependency}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                {pkg.repository === "aur"
                  ? "Inspect .SRCINFO in the Static scan tab for declared dependencies."
                  : "No runtime dependencies listed."}
              </p>
            )}
            {pkg.installedVersion && (
              <Button className="mt-4" variant="outline" size="sm" onClick={inspectDependencies}>
                Inspect installed dependency paths
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </section>
          {pkg.packageBase && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setTab("recipe");
                setScanEnabled(true);
              }}
            >
              <ScanLine className="size-4" />
              Inspect & scan build files
            </Button>
          )}
        </TabsContent>
        <TabsContent
          value="trust"
          forceMount
          hidden={tab !== "trust"}
          className="space-y-6 p-6 sm:p-8"
        >
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4">
            <Shield className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Trust needs supporting evidence</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                Package metadata is useful context. It cannot establish that installed files are
                unchanged or that a build recipe is safe.
              </p>
            </div>
          </div>
          {pkg.repository === "local" && pkg.installedVersion && <ForeignRecipe pkg={pkg} />}
          <section>
            <SectionTitle title="Signature evidence" />
            <div className="my-3">
              <SignatureBadge pkg={pkg} />
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              {pkg.signature === "verified-at-install"
                ? "Pacman’s local database records signature validation at install time. This label is separate from an installed-file check and does not represent a new signature verification."
                : pkg.repository === "aur"
                  ? "The AUR publishes community build recipes. It does not provide Arch-signed package artifacts. Review the recipe, its sources, and the generated artifact."
                  : "The local metadata does not record signature validation. Review installation provenance and effective repository signature policy."}
            </p>
          </section>
          {pkg.installedVersion && (
            <section className="rounded-lg border p-4">
              <SectionTitle title="Installed-file evidence" />
              <p className="my-3 text-xs leading-6 text-muted-foreground">
                Compare this installed version with pacman’s local file metadata. Review changed
                files, configuration differences and checks that could not finish.
              </p>
              <Button variant="outline" size="sm" onClick={inspectFiles}>
                <ScanLine className="size-3.5" />
                Inspect installed files
                <ArrowRight className="size-3.5" />
              </Button>
            </section>
          )}
          {pkg.repository !== "local" && (
            <section>
              <SectionTitle title="Repository origin" />
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                {pkg.repository === "aur"
                  ? "This package name is present in the AUR RPC response. Any installed version is matched by name; this does not prove it was built from this recipe."
                  : `A package named ${pkg.name} is available in ${pkg.repository}, following configured repository priority. A name match alone does not prove the origin of the installed artifact.`}
              </p>
            </section>
          )}
          {pkg.repository !== "local" && (
            <section>
              <SectionTitle title="Recommended review" />
              <ol className="mt-3 space-y-3 text-xs leading-6 text-muted-foreground">
                <li>1. Verify the source and repository policy.</li>
                <li>2. Check applicable advisories and version ranges.</li>
                <li>3. Inspect recipes, install scripts, and upstream source.</li>
                <li>4. Keep build and installation privileges separate.</li>
              </ol>
            </section>
          )}
        </TabsContent>
        {pkg.packageBase && (
          <TabsContent value="recipe" className="space-y-5 p-6 sm:p-8">
            <RecipeWorkbench base={pkg.packageBase} autoStart={scanEnabled} />
          </TabsContent>
        )}
      </Tabs>
      <div className="mt-auto border-t bg-muted/25 px-6 py-4 sm:px-8">
        <p className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
          <Shield className="size-3.5 shrink-0" />
          Browsing and scanning leave your package state unchanged.
        </p>
      </div>
    </>
  );
}
