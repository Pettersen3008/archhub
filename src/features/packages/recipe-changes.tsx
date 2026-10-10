import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  RecipeFile,
  RecipeFileChange,
  RecipeReview,
  RecipeReviewSummary,
  RecipeScan,
} from "@/lib/ipc/bindings";
import { cn } from "@/lib/utils";
import SourceView from "./recipe-source-view";
import { matchesRecipeReview } from "./recipe-review-identity";

type Side = "reviewed" | "current";
type Row = { text: string; reviewed: number | null; current: number | null };

// Coordinates are presentation hints. Source jumps also require exact captured text.
function diffRows(diff: string): Row[] {
  let before = 0;
  let after = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  return diff.split("\n").map((text) => {
    const row: Row = { text, reviewed: null, current: null };
    if (text.startsWith("@@")) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(text);
      oldRemaining = newRemaining = 0;
      if (hunk) {
        const coordinates = [hunk[1], hunk[2] ?? "1", hunk[3], hunk[4] ?? "1"].map(Number);
        if (coordinates.every((value) => Number.isSafeInteger(value) && value >= 0)) {
          [before, oldRemaining, after, newRemaining] = coordinates as [
            number,
            number,
            number,
            number,
          ];
          if ((before === 0 && oldRemaining > 0) || (after === 0 && newRemaining > 0))
            oldRemaining = newRemaining = 0;
        }
      }
    } else if (text.startsWith("-")) {
      if (oldRemaining > 0) {
        row.reviewed = before++;
        oldRemaining--;
      } else oldRemaining = newRemaining = 0;
    } else if (text.startsWith("+")) {
      if (newRemaining > 0) {
        row.current = after++;
        newRemaining--;
      } else oldRemaining = newRemaining = 0;
    } else if (text.startsWith(" ")) {
      if (oldRemaining > 0 && newRemaining > 0) {
        row.reviewed = before++;
        row.current = after++;
        oldRemaining--;
        newRemaining--;
      } else oldRemaining = newRemaining = 0;
    } else if (text !== "\\ No newline at end of file") {
      oldRemaining = newRemaining = 0;
    }
    return row;
  });
}

function matchesLine(lines: string[] | undefined, line: number | null, text: string) {
  return !!lines && line !== null && line > 0 && lines[line - 1] === text.slice(1);
}

export default function RecipeChanges({
  changes,
  current,
  baseline,
  reviewed,
  refreshReviewed,
  loadingReviewed,
}: {
  changes: RecipeFileChange[];
  current: RecipeScan;
  baseline: RecipeReviewSummary;
  reviewed: RecipeReview | null;
  refreshReviewed: () => void;
  loadingReviewed: boolean;
}) {
  const saved = matchesRecipeReview(reviewed, baseline) ? reviewed : null;
  const [selection, setSelection] = useState<{
    side: Side;
    file: RecipeFile;
    line: number;
    revision: number;
  } | null>(null);
  const returnTarget = useRef<HTMLButtonElement | null>(null);
  // Revalidate the loaded baseline on every render, including another client's update.
  const selected = selection && (selection.side === "current" || saved) ? selection : null;
  function open(side: Side, file: RecipeFile, line: number, target: HTMLButtonElement) {
    returnTarget.current = target;
    setSelection((prior) => ({ side, file, line, revision: (prior?.revision ?? 0) + 1 }));
  }
  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">
        Select a reviewed or current line number to inspect its full captured file.
      </p>
      {!saved && (
        <div className="space-y-2">
          <output
            className={cn(
              "block text-xs leading-5",
              loadingReviewed ? "text-muted-foreground" : "text-warning",
            )}
          >
            {loadingReviewed
              ? "Reading saved evidence for this comparison…"
              : "Reviewed source context is unavailable: the loaded record does not match this comparison. Reload saved evidence; if the baseline changed, fetch the recipe again."}
          </output>
          <Button variant="outline" size="sm" disabled={loadingReviewed} onClick={refreshReviewed}>
            {loadingReviewed ? "Loading saved evidence…" : "Reload saved evidence"}
          </Button>
        </div>
      )}
      {changes.map((change) => {
        const oldFile = saved?.scan.files.find((file) => file.path === change.path);
        const newFile = current.files.find((file) => file.path === change.path);
        const oldLines = oldFile?.content.split("\n");
        const newLines = newFile?.content.split("\n");
        return (
          <section key={change.path} className="min-w-0 overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/40 p-3">
              <span className="min-w-0 font-mono text-xs break-all">{change.path}</span>
              <span className="status status-neutral capitalize">{change.kind}</span>
            </div>
            <div className="flex border-b text-xs text-muted-foreground" aria-hidden="true">
              <span className="w-16 shrink-0 py-2 text-center">Reviewed</span>
              <span className="w-16 shrink-0 py-2 text-center">Current</span>
              <span className="px-3 py-2">Captured diff{change.truncated ? " preview" : ""}</span>
            </div>
            <pre
              aria-label={`Changes in ${change.path}`}
              className="max-h-80 overflow-auto bg-background py-3 font-mono text-xs leading-6"
            >
              {diffRows(change.diff).map((row, index) => (
                <span
                  key={index}
                  className={cn(
                    "flex min-w-max pr-3",
                    row.text.startsWith("+") && "bg-success-bg text-success",
                    row.text.startsWith("-") && "bg-danger-bg text-destructive",
                    row.text.startsWith("@@") && "bg-muted text-muted-foreground",
                  )}
                >
                  <span className="sticky left-0 flex shrink-0 border-r bg-background">
                    {(["reviewed", "current"] as const).map((side) => {
                      const file = side === "reviewed" ? oldFile : newFile;
                      const line = row[side];
                      return matchesLine(
                        side === "reviewed" ? oldLines : newLines,
                        line,
                        row.text,
                      ) ? (
                        <button
                          key={side}
                          className="w-16 px-2 text-right text-primary underline decoration-primary/40 underline-offset-2 hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                          aria-label={`Inspect ${side} ${change.path} line ${line}`}
                          onClick={(event) => open(side, file!, line!, event.currentTarget)}
                        >
                          {line}
                        </button>
                      ) : (
                        <span
                          key={side}
                          className="w-16 px-2 text-right text-muted-foreground"
                          aria-hidden="true"
                        >
                          {line ?? "·"}
                        </span>
                      );
                    })}
                  </span>
                  <code className="px-3">{row.text || " "}</code>
                </span>
              ))}
            </pre>
            {change.truncated && (
              <p className="border-t bg-warning-bg p-3 text-xs leading-5 text-warning">
                Diff preview is truncated. Export the saved review and current scan to inspect the
                full files.
              </p>
            )}
          </section>
        );
      })}
      {selected && (
        <section className="min-w-0 border-t pt-4" aria-label="Changed-line source context">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold break-all">
              {selected.side === "reviewed" ? "Reviewed" : "Current"} file · {selected.file.path}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelection(null);
                returnTarget.current?.focus();
              }}
            >
              Return to diff
            </Button>
          </div>
          <p className="mb-3 font-mono text-xs break-all text-muted-foreground">
            Captured commit · {selected.side === "reviewed" ? baseline.commit : current.commit}
          </p>
          <SourceView
            key={`${selected.side}:${selected.file.path}:${selected.line}:${selected.revision}`}
            file={selected.file}
            jump={selected.line}
            highlights={[]}
            label={
              selected.side === "reviewed" ? "Reviewed recipe source" : "Current recipe source"
            }
          />
        </section>
      )}
    </div>
  );
}
