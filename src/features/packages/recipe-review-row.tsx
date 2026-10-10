import { ArrowUpRight, Download, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { RecipeReviewSummary } from "@/lib/ipc/bindings";
import { request } from "@/lib/ipc/client";
import { cn, date, downloadJson } from "@/lib/utils";
import { matchesRecipeReviewIdentity } from "./recipe-review-identity";
import { useRecipeInspection } from "./recipe-query";

const labels: Record<string, string> = {
  reviewed: "Matches saved snapshot",
  changed: "Changed since review",
  "analysis-changed": "Analyzer changed · review findings again",
  incomplete: "Incomplete coverage",
};

export default function RecipeReviewRow({
  review,
  open,
}: {
  review: RecipeReviewSummary;
  open: (base: string, panel: "files" | "changes") => void;
}) {
  const recipe = useRecipeInspection(review.packageBase);
  const inspection = recipe.data;
  const baselineMatches =
    !!inspection &&
    inspection.scan.packageBase === review.packageBase &&
    matchesRecipeReviewIdentity(inspection.baseline, review);
  const available =
    !recipe.isChecking && !recipe.isError && baselineMatches && !!labels[inspection!.status];
  const comparisonAvailable = available && inspection!.scan.complete;
  const status = recipe.isChecking
    ? "Checking current recipe…"
    : recipe.isError
      ? "Current check failed · remote state unknown"
      : !inspection
        ? "Remote state not checked"
        : !baselineMatches
          ? "Saved record changed · refresh records"
          : (labels[inspection.status] ?? "Current state unknown");
  return (
    <article
      aria-label={`Saved review for ${review.packageBase}`}
      className="flex flex-wrap items-start gap-4 border-b p-5 last:border-b-0"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted text-primary">
        <GitCommitHorizontal className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          className="text-left text-sm font-semibold break-all hover:text-primary"
          onClick={() => open(review.packageBase, "files")}
          aria-label={`Open saved review for ${review.packageBase}`}
        >
          {review.packageBase}
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          Reviewed {date(review.reviewedAt)} · {review.fileCount} files · {review.findingCount}{" "}
          flagged patterns
        </p>
        <p className="mt-2 line-clamp-2 text-xs leading-6">{review.note}</p>
        <p className="mt-2 font-mono text-xs break-all text-muted-foreground">
          Reviewed commit {review.commit.slice(0, 12)}
        </p>
        <output className="mt-3 block space-y-2">
          <span
            className={cn(
              "status",
              recipe.isError ||
                (!!inspection &&
                  !recipe.isChecking &&
                  (!available || inspection.status !== "reviewed"))
                ? "status-warn"
                : "status-neutral",
            )}
          >
            {status}
          </span>
          {recipe.isError && !recipe.isChecking && (
            <span className="block text-xs leading-5 break-words text-muted-foreground">
              {recipe.error.message}
            </span>
          )}
          {available && (
            <>
              <span className="block text-xs leading-5 text-muted-foreground">
                Captured {date(inspection!.scan.scannedAt)} · commit{" "}
                {inspection!.scan.commit.slice(0, 12)}
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                {inspection!.scan.complete
                  ? `${inspection!.changes.length} changed ${inspection!.changes.length === 1 ? "file" : "files"} · ${inspection!.scan.findings.length} current ${inspection!.scan.findings.length === 1 ? "pattern" : "patterns"}`
                  : "A complete comparison is unavailable."}
              </span>
            </>
          )}
        </output>
      </div>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <Button
          size="sm"
          variant="outline"
          disabled={recipe.isChecking}
          aria-label={`Check current recipe for ${review.packageBase}`}
          onClick={() => void recipe.check().catch(() => {})}
        >
          <RefreshCw className={cn("size-3", recipe.isChecking && "animate-spin")} />
          {recipe.isChecking ? (
            "Checking…"
          ) : recipe.isError ? (
            "Retry check"
          ) : inspection ? (
            "Recheck"
          ) : (
            <span>
              Check<span className="hidden sm:inline"> current</span>
            </span>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={`${comparisonAvailable ? "Review comparison" : "Open evidence"} for ${review.packageBase}`}
          onClick={() => open(review.packageBase, comparisonAvailable ? "changes" : "files")}
        >
          {comparisonAvailable ? "Compare" : "Open evidence"}
          <ArrowUpRight className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Export saved review for ${review.packageBase}`}
          onClick={async () => {
            try {
              const saved = await request({ command: "recipe_review", base: review.packageBase });
              if (!saved)
                throw new Error("Saved review is no longer available. Refresh the records.");
              downloadJson(`archhub-${review.packageBase}-review.json`, saved);
            } catch (error) {
              toast.error(String(error));
            }
          }}
        >
          <Download className="size-3" />
          Export
        </Button>
      </div>
    </article>
  );
}
