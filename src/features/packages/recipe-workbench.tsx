import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  GitCompareArrows,
  Info,
  ScanLine,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, FindingRow, Loading, SectionTitle } from "@/components/layout/shared";
import type { RecipeFile, RecipeInspection, RecipeReviewSummary } from "@/lib/ipc/bindings";
import { request } from "@/lib/ipc/client";
import RecipeSources from "./recipe-sources";
import SourceView from "./recipe-source-view";
import RecipeChanges from "./recipe-changes";
import RecipeFindingChanges from "./recipe-finding-changes";
import { useRecipeInspection } from "./recipe-query";
import { bytes, cn, copy, date, downloadJson, openUrl } from "@/lib/utils";

function clipboard(value: string) {
  void copy(value)
    .then(() => toast.success("Copied to clipboard"))
    .catch(() => toast.error("Clipboard unavailable"));
}

function hasSourceLocation(files: RecipeFile[], path: string, line: number | null) {
  const file = files.find((entry) => entry.path === path);
  return !!file && Number.isInteger(line) && line! > 0 && line! <= file.content.split("\n").length;
}

const statusLabels: Record<string, string> = {
  reviewed: "Reviewed snapshot",
  changed: "Changed since review",
  "analysis-changed": "Analyzer changed · review findings again",
  incomplete: "Incomplete coverage",
  unreviewed: "Not reviewed",
  captured: "Previous capture · current state unknown",
};
const findingsPerPage = 25;

export default function RecipeWorkbench({
  base,
  autoStart = false,
  initialPanel = "files",
}: {
  base: string;
  autoStart?: boolean;
  initialPanel?: "files" | "changes";
}) {
  const client = useQueryClient();
  const [filePath, setFilePath] = useState("PKGBUILD");
  const [jumpSelection, setJumpSelection] = useState<{ capture: string; line: number } | null>(
    null,
  );
  const [jumpRevision, setJumpRevision] = useState(0);
  const [panel, setPanel] = useState<string>(initialPanel);
  const [findingPage, setFindingPage] = useState(0);
  const [findingSearch, setFindingSearch] = useState("");
  const [findingFilter, setFindingFilter] = useState("all");
  const [note, setNote] = useState("");
  const [acknowledgedIdentity, setAcknowledgedIdentity] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const formId = useId();
  const key = ["recipe", base];
  const stored = useQuery({
    queryKey: ["recipe-review", base],
    queryFn: ({ signal }) => request({ command: "recipe_review", base }, signal),
    retry: false,
  });
  const recipe = useRecipeInspection(base, autoStart);
  const scan = recipe.data?.scan ?? stored.data?.scan;
  const capture = scan ? `${scan.commit}:${scan.digest}` : "";
  const jump = jumpSelection?.capture === capture ? jumpSelection.line : 0;
  function showSource(path: string, line: number) {
    if (!scan || !hasSourceLocation(scan.files, path, line)) {
      toast.error("Source location unavailable in this capture.");
      return;
    }
    setPanel("files");
    setFilePath(path);
    setJumpSelection({ capture, line });
    setJumpRevision((revision) => revision + 1);
  }
  const baseline: RecipeReviewSummary | null = recipe.data
    ? recipe.data.baseline
    : stored.data
      ? {
          staticAnalyzerVersion: stored.data.scan.staticAnalyzerVersion,
          packageBase: base,
          commit: stored.data.scan.commit,
          digest: stored.data.scan.digest,
          scannedAt: stored.data.scan.scannedAt,
          reviewedAt: stored.data.reviewedAt,
          note: stored.data.note,
          fileCount: stored.data.scan.files.length,
          findingCount: stored.data.scan.findings.length,
        }
      : null;
  const currentKnown = !!recipe.data && !recipe.isError && !recipe.isChecking;
  const reviewIdentity = scan
    ? `${base}:${capture}:${scan.staticAnalyzerVersion ?? "unversioned"}`
    : null;
  const acknowledged =
    currentKnown && !!scan?.complete && !!reviewIdentity && acknowledgedIdentity === reviewIdentity;
  const capturedIsSaved =
    !!scan &&
    !!stored.data &&
    scan.digest === stored.data.scan.digest &&
    scan.commit === stored.data.scan.commit &&
    scan.staticAnalyzerVersion === stored.data.scan.staticAnalyzerVersion;
  const selected = scan?.files.find((file) => file.path === filePath) ?? scan?.files[0];
  const needle = findingSearch.trim().toLowerCase();
  const findings = (scan?.findings ?? []).filter(
    (finding) =>
      (findingFilter === "all" || ["high", "critical"].includes(finding.severity)) &&
      [finding.title, finding.description, finding.id, finding.file ?? "PKGBUILD"]
        .join(" ")
        .toLowerCase()
        .includes(needle),
  );
  const activeFindingPage = Math.min(
    findingPage,
    Math.max(0, Math.ceil(findings.length / findingsPerPage) - 1),
  );
  const status = currentKnown ? recipe.data!.status : capturedIsSaved ? "saved" : "captured";
  function cacheInspection(value: RecipeInspection) {
    client.setQueryData(key, value);
    client.setQueryData(
      ["recipe-review", base],
      value.baseline
        ? { scan: value.scan, reviewedAt: value.baseline.reviewedAt, note: value.baseline.note }
        : null,
    );
    void client.invalidateQueries({ queryKey: ["recipe-reviews"] });
  }
  const save = useMutation({
    mutationFn: () => {
      if (!recipe.data || !currentKnown || !acknowledged)
        throw new Error("Fetch and review the current capture before saving this review.");
      return request({
        command: "record_recipe_review",
        staticAnalyzerVersion: recipe.data.scan.staticAnalyzerVersion ?? null,
        base,
        digest: recipe.data.scan.digest,
        commit: recipe.data.scan.commit,
        note,
      });
    },
    onSuccess: (value) => {
      cacheInspection(value);
      setAcknowledgedIdentity(null);
      setNote("");
      toast.success("Review saved for this exact snapshot");
    },
  });
  const remove = useMutation({
    mutationFn: () => {
      if (!baseline) throw new Error("No saved review is available.");
      return request({
        command: "remove_recipe_review",
        base,
        digest: baseline.digest,
        commit: baseline.commit,
      });
    },
    onSuccess: () => {
      client.setQueryData(["recipe-review", base], null);
      if (recipe.data)
        client.setQueryData(key, {
          ...recipe.data,
          baseline: null,
          status: recipe.data.scan.complete ? "unreviewed" : "incomplete",
          changes: [],
        });
      void client.invalidateQueries({ queryKey: ["recipe-reviews"] });
      setRemoving(false);
      toast.success("Saved review removed");
    },
  });
  return (
    <div className="space-y-5">
      <section>
        <SectionTitle
          title="Build recipe analysis"
          description="Commit-specific static analysis · no code execution"
        />
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          Inspect the build files and installation scripts, then follow each finding to its source.
          Save a personal review to compare future changes.
        </p>
        <Button
          className="mt-4 w-full"
          disabled={recipe.isChecking || save.isPending || remove.isPending}
          onClick={() => {
            setAcknowledgedIdentity(null);
            save.reset();
            void recipe.check().catch(() => {});
          }}
        >
          <ScanLine className={cn("size-4", recipe.isChecking && "animate-pulse")} />
          {recipe.isChecking
            ? "Fetching & scanning…"
            : recipe.data
              ? "Scan current build files again"
              : "Fetch & run static scan"}
        </Button>
      </section>
      {stored.isError && <ErrorState error={stored.error} retry={() => void stored.refetch()} />}
      {recipe.isChecking && !scan ? (
        <Loading label="Resolving commit and fetching build files…" />
      ) : (
        recipe.isError &&
        !recipe.isChecking && (
          <ErrorState error={recipe.error} retry={() => void recipe.check().catch(() => {})} />
        )
      )}
      {scan && (
        <>
          <section className="rounded-lg border bg-muted/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold">
                {scan.findings.length}{" "}
                {scan.findings.length === 1 ? "pattern requires" : "patterns require"} review
              </p>
              <span
                className={cn(
                  "status",
                  ["changed", "analysis-changed", "incomplete"].includes(status)
                    ? "status-warn"
                    : "status-neutral",
                )}
              >
                {status === "reviewed" && <Check className="size-3" />}
                {statusLabels[status] ?? "Saved snapshot · current state unknown"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Scanned {date(scan.scannedAt)} · {scan.files.length} captured files.{" "}
              {currentKnown
                ? "Fetched files share the commit below."
                : capturedIsSaved
                  ? "This is saved evidence. Fetch again to check the current recipe."
                  : "This is a previous capture. Fetch again to check the current recipe."}
            </p>
            {status === "analysis-changed" && (
              <p className="mt-2 text-xs leading-5 text-warning">
                Files and commit match your saved review, but the static analyzer version changed.
                Inspect the current findings before recording another review.
              </p>
            )}
            <dl className="mt-4 space-y-3 text-xs">
              <div>
                <dt className="mb-1 text-muted-foreground">Static analyzer</dt>
                <dd className="text-muted-foreground">
                  {scan.staticAnalyzerVersion != null
                    ? `Rules v${scan.staticAnalyzerVersion} · text heuristics`
                    : "Unversioned capture · findings retained as recorded"}
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-muted-foreground">AUR commit</dt>
                <dd className="font-mono break-all">{scan.commit}</dd>
              </div>
              <div>
                <dt className="mb-1 text-muted-foreground">Bundle SHA-256</dt>
                <dd className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all">{scan.digest}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label="Copy recipe digest"
                    onClick={() => clipboard(scan.digest)}
                  >
                    <Copy className="size-3" />
                  </Button>
                </dd>
              </div>
            </dl>
          </section>
          {scan.warnings.length > 0 && (
            <section role="alert" className="rounded-lg border border-warning/30 bg-warning-bg p-4">
              <h3 className="text-xs font-semibold text-warning">Coverage is incomplete</h3>
              <ul className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
                {scan.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-warning">
                A review cannot be recorded while these coverage issues remain.
              </p>
            </section>
          )}
          <Tabs value={panel} onValueChange={setPanel}>
            <TabsList className="grid w-full grid-cols-2 gap-1 group-data-[orientation=horizontal]/tabs:h-auto sm:flex">
              <TabsTrigger className="text-xs" value="files">
                Files & findings
              </TabsTrigger>
              <TabsTrigger className="text-xs" value="sources">
                Sources
              </TabsTrigger>
              <TabsTrigger className="text-xs" value="changes">
                Changes
                {recipe.data && recipe.data.changes.length > 0
                  ? ` (${recipe.data.changes.length})`
                  : ""}
              </TabsTrigger>
              <TabsTrigger className="text-xs" value="review">
                Review record
              </TabsTrigger>
            </TabsList>
            <TabsContent value="files" className="space-y-5 pt-3">
              {scan.findings.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  <div className="space-y-3 border-b p-3">
                    <div aria-label="Filter static findings" className="flex flex-wrap gap-1">
                      {[
                        ["all", "All patterns"],
                        ["high", "High & critical"],
                      ].map(([value, label]) => (
                        <Button
                          key={value}
                          size="sm"
                          className="h-8 text-xs"
                          variant={findingFilter === value ? "secondary" : "ghost"}
                          aria-pressed={findingFilter === value}
                          onClick={() => {
                            setFindingFilter(value!);
                            setFindingPage(0);
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        aria-label="Search static findings"
                        placeholder="Search patterns, files or rule IDs…"
                        value={findingSearch}
                        onChange={(event) => {
                          setFindingSearch(event.target.value);
                          setFindingPage(0);
                        }}
                      />
                    </div>
                  </div>
                  {findings
                    .slice(
                      activeFindingPage * findingsPerPage,
                      (activeFindingPage + 1) * findingsPerPage,
                    )
                    .map((finding) => {
                      const validLocation = hasSourceLocation(
                        scan.files,
                        finding.file ?? "PKGBUILD",
                        finding.line,
                      );
                      return (
                        <div key={finding.id}>
                          <FindingRow
                            finding={finding}
                            onClick={
                              validLocation
                                ? () => showSource(finding.file ?? "PKGBUILD", finding.line!)
                                : undefined
                            }
                          />
                          <p className="border-b px-5 pb-4 pl-16 text-xs leading-5 text-muted-foreground">
                            {finding.description}
                            {!validLocation && (
                              <span className="mt-2 block text-warning">
                                Source location unavailable in this capture.
                              </span>
                            )}
                          </p>
                        </div>
                      );
                    })}
                  {!findings.length && (
                    <p className="p-4 text-xs leading-5 text-muted-foreground">
                      No patterns match these filters. The full capture remains in the export.
                    </p>
                  )}
                  {findings.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/35 p-3">
                      <span aria-live="polite" className="text-xs text-muted-foreground">
                        Findings {activeFindingPage * findingsPerPage + 1}–
                        {Math.min((activeFindingPage + 1) * findingsPerPage, findings.length)} of{" "}
                        {findings.length}
                        {findings.length !== scan.findings.length &&
                          ` · ${scan.findings.length} captured`}
                      </span>
                      {findings.length > findingsPerPage && (
                        <div className="flex gap-1">
                          <Button
                            aria-label="Previous finding page"
                            size="sm"
                            variant="outline"
                            disabled={activeFindingPage === 0}
                            onClick={() => setFindingPage(activeFindingPage - 1)}
                          >
                            Previous
                          </Button>
                          <Button
                            aria-label="Next finding page"
                            size="sm"
                            variant="outline"
                            disabled={(activeFindingPage + 1) * findingsPerPage >= findings.length}
                            onClick={() => setFindingPage(activeFindingPage + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {selected && (
                <section>
                  <div className="mb-3 flex min-w-0 items-center gap-2">
                    <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                    <Select
                      value={selected.path}
                      onValueChange={(path) => {
                        setFilePath(path);
                        setJumpSelection(null);
                        setJumpRevision((revision) => revision + 1);
                      }}
                    >
                      <SelectTrigger aria-label="Build file" className="min-w-0 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {scan.files.map((file) => (
                          <SelectItem key={file.path} value={file.path}>
                            {file.path}
                            {file.role === "install" ? " · install script" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {bytes(new TextEncoder().encode(selected.content).byteLength)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="Copy build file"
                      onClick={() => clipboard(selected.content)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                  <SourceView
                    key={`${capture}:${selected.path}:${jump}:${jumpRevision}:${selected.digest}`}
                    file={selected}
                    jump={jump}
                    highlights={scan.findings
                      .filter((finding) => finding.file === selected.path)
                      .map((finding) => finding.line!)
                      .filter(Boolean)}
                  />
                </section>
              )}
            </TabsContent>
            <TabsContent value="sources" className="pt-3">
              <RecipeSources
                key={`${scan.digest}:${scan.commit}`}
                evidence={scan.sourceEvidence}
                currentKnown={currentKnown}
                jump={(line) => showSource(".SRCINFO", line)}
              />
            </TabsContent>
            <TabsContent value="changes" className="space-y-4 pt-3">
              <SectionTitle
                title="Changes since your review"
                description={
                  baseline
                    ? `Compared with the snapshot reviewed ${date(baseline.reviewedAt)}`
                    : "Record a review to create a comparison baseline."
                }
              />
              {baseline && (
                <p className="font-mono text-xs break-all text-muted-foreground">
                  Reviewed commit · {baseline.commit}
                </p>
              )}
              {scan.complete && currentKnown && baseline && (
                <RecipeFindingChanges
                  key={`findings:${scan.commit}:${scan.digest}:${scan.scannedAt}:${scan.staticAnalyzerVersion}:${baseline.commit}:${baseline.digest}:${baseline.scannedAt}:${baseline.reviewedAt}:${baseline.staticAnalyzerVersion}`}
                  current={scan}
                  baseline={baseline}
                  reviewed={stored.isError ? null : (stored.data ?? null)}
                  refreshReviewed={() => void stored.refetch()}
                  loadingReviewed={stored.isFetching}
                />
              )}
              {!scan.complete ? (
                <p className="rounded-lg border bg-warning-bg p-4 text-xs leading-6 text-warning">
                  A full comparison is unavailable. Resolve the coverage warnings and capture all
                  required files before comparing this snapshot.
                </p>
              ) : !currentKnown ? (
                <p className="rounded-lg border bg-muted/35 p-4 text-xs leading-6 text-muted-foreground">
                  Fetch the current recipe to compare it with your saved evidence. Current remote
                  state is unknown.
                </p>
              ) : !baseline ? (
                <p className="text-xs leading-6 text-muted-foreground">
                  There is no saved review for this package base yet. Inspect its files and add a
                  review record.
                </p>
              ) : recipe.data!.changes.length > 0 ? (
                <RecipeChanges
                  key={`files:${scan.commit}:${scan.digest}:${scan.scannedAt}:${scan.staticAnalyzerVersion}:${baseline.commit}:${baseline.digest}:${baseline.scannedAt}:${baseline.reviewedAt}:${baseline.staticAnalyzerVersion}`}
                  changes={recipe.data!.changes}
                  current={scan}
                  baseline={baseline}
                  reviewed={stored.isError ? null : (stored.data ?? null)}
                  refreshReviewed={() => void stored.refetch()}
                  loadingReviewed={stored.isFetching}
                />
              ) : (
                <div className="flex items-start gap-3 rounded-lg border bg-muted/35 p-4">
                  <GitCompareArrows className="mt-1 size-4 shrink-0 text-primary" />
                  <p className="text-xs leading-6 text-muted-foreground">
                    {scan.commit !== baseline.commit
                      ? "The AUR commit changed, but the captured file contents are identical. Review this new commit before recording a new baseline."
                      : status === "analysis-changed"
                        ? "Captured files and commit match your saved review. The static analyzer changed; inspect the current findings and record another review."
                        : "Captured files and commit match your saved review. This comparison does not verify sources or installed bytes."}
                  </p>
                </div>
              )}
              {baseline && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const saved = await request({ command: "recipe_review", base });
                      if (!saved) throw new Error("Saved review is no longer available.");
                      downloadJson(`archhub-${base}-review.json`, saved);
                    } catch (error) {
                      toast.error(String(error));
                    }
                  }}
                >
                  <Download className="size-3.5" />
                  Export saved review
                </Button>
              )}
            </TabsContent>
            <TabsContent value="review" className="space-y-5 pt-3">
              <SectionTitle
                title="Your review record"
                description="A personal checkpoint for these exact files and commit"
              />
              {baseline && (
                <section className="rounded-lg border bg-muted/35 p-4">
                  <p className="text-xs text-muted-foreground">
                    Last recorded {date(baseline.reviewedAt)}
                    {baseline.staticAnalyzerVersion != null
                      ? ` · rules v${baseline.staticAnalyzerVersion}`
                      : " · unversioned analyzer"}
                  </p>
                  <p className="mt-2 text-xs leading-6 whitespace-pre-wrap">{baseline.note}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-3 text-destructive"
                    onClick={() => setRemoving(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Remove saved review
                  </Button>
                </section>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (acknowledged && currentKnown && scan.complete && !recipe.isChecking)
                    save.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <label htmlFor={`${formId}-note`} className="text-xs font-semibold">
                    Review note
                  </label>
                  <Textarea
                    id={`${formId}-note`}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    minLength={8}
                    maxLength={1000}
                    required
                    rows={4}
                    className="mt-2"
                    placeholder="Describe the sources, install actions, and findings you checked…"
                    aria-describedby={`${formId}-help`}
                  />
                  <p id={`${formId}-help`} className="mt-2 text-xs leading-5 text-muted-foreground">
                    8–1000 characters. Notes and captured files are saved on this workstation and
                    shared by its browser and desktop clients.
                  </p>
                </div>
                <label className="flex items-start gap-3 text-xs leading-6">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={!currentKnown || !scan.complete || save.isPending || remove.isPending}
                    onChange={(event) =>
                      setAcknowledgedIdentity(
                        event.target.checked && currentKnown && scan.complete
                          ? reviewIdentity
                          : null,
                      )
                    }
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  I reviewed the captured files and findings.
                </label>
                {save.isError && (
                  <p role="alert" className="text-xs leading-6 text-destructive">
                    {save.error.message}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    !acknowledged ||
                    [...note.trim()].length < 8 ||
                    !currentKnown ||
                    !scan.complete ||
                    recipe.isChecking ||
                    save.isPending ||
                    remove.isPending
                  }
                >
                  <Check className="size-4" />
                  {save.isPending ? "Saving review…" : "Record this review"}
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  A saved review applies to this snapshot. New commits and file changes require
                  another review. This record does not establish safety or permit installation.
                </p>
                {!currentKnown && (
                  <p className="text-xs text-warning">
                    Fetch the current recipe before recording a review.
                  </p>
                )}
              </form>
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadJson(
                  `archhub-${base}-scan.json`,
                  currentKnown
                    ? recipe.data
                    : {
                        scan,
                        status: capturedIsSaved
                          ? "saved-current-unknown"
                          : "capture-current-unknown",
                        baseline,
                      },
                )
              }
            >
              <Download className="size-3" />
              Export scan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openUrl(scan.url).catch((error) => toast.error(String(error)))}
            >
              <ExternalLink className="size-3" />
              Review pinned recipe
            </Button>
          </div>
          <section className="rounded-lg bg-warning-bg/50 p-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-warning">
              <Info className="size-3.5" />
              Scan limitations
            </h3>
            <ul className="mt-3 space-y-2">
              {scan.limitations.map((text) => (
                <li key={text} className="text-xs leading-5 text-muted-foreground">
                  {text}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this review baseline?</DialogTitle>
            <DialogDescription>
              The saved note and captured files for {base} will be removed. Export them first if you
              want to keep a copy.
            </DialogDescription>
          </DialogHeader>
          {remove.isError && (
            <p role="alert" className="text-sm text-destructive">
              {remove.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setRemoving(false)}
            >
              Keep review
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Removing…" : "Remove baseline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
