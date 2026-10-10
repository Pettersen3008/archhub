import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Severity } from "@/components/layout/shared";
import type { Finding, RecipeReview, RecipeReviewSummary, RecipeScan } from "@/lib/ipc/bindings";
import SourceView from "./recipe-source-view";
import { compareRecipeFindings, type FindingChange } from "./recipe-finding-comparison";
import { matchesRecipeReview } from "./recipe-review-identity";
import { cn } from "@/lib/utils";

const labels = { new: "Newly reported", retained: "Still reported", absent: "No longer reported" };
const pageSize = 25;

export default function RecipeFindingChanges({
  current,
  baseline,
  reviewed,
  refreshReviewed,
  loadingReviewed,
}: {
  current: RecipeScan;
  baseline: RecipeReviewSummary;
  reviewed: RecipeReview | null;
  refreshReviewed: () => void;
  loadingReviewed: boolean;
}) {
  const saved = matchesRecipeReview(reviewed, baseline) ? reviewed : null;
  const comparison = useMemo(
    () => (saved ? compareRecipeFindings(current, saved.scan) : null),
    [current, saved],
  );
  const [filter, setFilter] = useState<"all" | FindingChange["kind"]>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState<{
    side: "current" | "reviewed";
    finding: Finding;
    revision: number;
  } | null>(null);
  const returnTarget = useRef<HTMLButtonElement | null>(null);
  const changes = comparison?.available ? comparison.changes : [];
  const needle = query.trim().toLowerCase();
  const filtered = changes.filter((change) => {
    const finding = change.current ?? change.reviewed!;
    return (
      (filter === "all" || change.kind === filter) &&
      [
        finding.title,
        finding.description,
        change.current?.id ?? "",
        change.reviewed?.id ?? "",
        finding.file ?? "PKGBUILD",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  });
  const activePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const selectedScan = selection?.side === "current" ? current : saved?.scan;
  const selectedFile = selectedScan?.files.find(
    (file) => file.path === (selection?.finding.file ?? "PKGBUILD"),
  );
  const selected = comparison?.available && selection && selectedFile ? selection : null;
  return (
    <section
      aria-label="Static finding changes"
      className="min-w-0 space-y-3 rounded-lg border p-3"
    >
      <h3 className="text-xs font-semibold">Static finding changes</h3>
      {!comparison ? (
        <div className="space-y-2">
          <p
            className={cn(
              "text-xs leading-5",
              loadingReviewed ? "text-muted-foreground" : "text-warning",
            )}
          >
            {loadingReviewed
              ? "Reading saved evidence for this comparison…"
              : "Finding comparison is unavailable: reload the saved evidence to match this baseline."}
          </p>
          <Button variant="outline" size="sm" disabled={loadingReviewed} onClick={refreshReviewed}>
            {loadingReviewed ? "Loading finding baseline…" : "Reload finding baseline"}
          </Button>
        </div>
      ) : !comparison.available ? (
        <p className="text-xs leading-5 text-warning">{comparison.reason}</p>
      ) : (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            Matched by rule, file, exact line text and finding metadata; line numbers may move.
            Matching observations can have different surrounding code. A missing observation does
            not establish that a risk is fixed.
          </p>
          <div aria-label="Filter finding changes" className="flex flex-wrap gap-1">
            {(["all", "new", "retained", "absent"] as const).map((kind) => (
              <Button
                key={kind}
                variant={filter === kind ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                aria-pressed={filter === kind}
                onClick={() => {
                  setFilter(kind);
                  setPage(0);
                  setSelection(null);
                }}
              >
                {kind === "all" ? "All observations" : labels[kind]} (
                {kind === "all"
                  ? changes.length
                  : changes.filter((change) => change.kind === kind).length}
                )
              </Button>
            ))}
          </div>
          {changes.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Search finding changes"
                placeholder="Search patterns, files or rule IDs…"
                className="pl-9"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                  setSelection(null);
                }}
              />
            </div>
          )}
          <div className="divide-y">
            {filtered
              .slice(activePage * pageSize, (activePage + 1) * pageSize)
              .map((change, index) => {
                const finding = change.current ?? change.reviewed!;
                return (
                  <div key={activePage * pageSize + index} className="space-y-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-xs font-semibold break-words">{finding.title}</p>
                      <Severity value={finding.severity} />
                    </div>
                    <p className="text-xs text-muted-foreground">{labels[change.kind]}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{finding.description}</p>
                    <div className="flex flex-wrap gap-2">
                      {(["reviewed", "current"] as const).map((side) => {
                        const observation = change[side];
                        if (!observation) return null;
                        const path = observation.file ?? "PKGBUILD";
                        return (
                          <Button
                            key={side}
                            size="sm"
                            variant="outline"
                            className="h-auto min-h-8 max-w-full min-w-0 text-xs"
                            aria-label={`Inspect ${side} finding ${path} line ${observation.line}`}
                            onClick={(event) => {
                              returnTarget.current = event.currentTarget;
                              setSelection((prior) => ({
                                side,
                                finding: observation,
                                revision: (prior?.revision ?? 0) + 1,
                              }));
                            }}
                          >
                            <span className="break-all whitespace-normal">
                              {side === "reviewed" ? "Reviewed" : "Current"} · {path}:
                              {observation.line}
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
          {!filtered.length && (
            <p className="text-xs leading-5 text-muted-foreground">
              {changes.length
                ? "No observations match these filters."
                : "Neither capture reports static findings. Text heuristics do not establish recipe safety."}
            </p>
          )}
          {filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span aria-live="polite" className="text-xs text-muted-foreground">
                Observations {activePage * pageSize + 1}–
                {Math.min((activePage + 1) * pageSize, filtered.length)} of {filtered.length}
              </span>
              {filtered.length > pageSize && (
                <div className="flex gap-1">
                  <Button
                    aria-label="Previous finding change page"
                    variant="outline"
                    size="sm"
                    disabled={activePage === 0}
                    onClick={() => {
                      setPage(activePage - 1);
                      setSelection(null);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    aria-label="Next finding change page"
                    variant="outline"
                    size="sm"
                    disabled={(activePage + 1) * pageSize >= filtered.length}
                    onClick={() => {
                      setPage(activePage + 1);
                      setSelection(null);
                    }}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
          {selected && selectedFile && (
            <div className="space-y-3 border-t pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold break-all">
                  {selected.side === "reviewed" ? "Reviewed" : "Current"} finding ·{" "}
                  {selectedFile.path}
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelection(null);
                    returnTarget.current?.focus();
                  }}
                >
                  Return to findings
                </Button>
              </div>
              <p className="font-mono text-xs break-all text-muted-foreground">
                Captured commit · {selectedScan!.commit}
              </p>
              <SourceView
                key={`${selected.side}:${selected.finding.id}:${selected.revision}`}
                file={selectedFile}
                jump={selected.finding.line!}
                highlights={[selected.finding.line!]}
                label="Finding source context"
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
