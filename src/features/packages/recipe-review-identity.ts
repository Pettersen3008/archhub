import type { RecipeReview, RecipeReviewSummary } from "@/lib/ipc/bindings";

type ReviewIdentity = Pick<
  RecipeReviewSummary,
  "packageBase" | "commit" | "digest" | "scannedAt" | "staticAnalyzerVersion" | "reviewedAt"
>;

export function matchesRecipeReviewIdentity(
  reviewed: ReviewIdentity | null,
  baseline: ReviewIdentity,
): boolean {
  return (
    reviewed !== null &&
    reviewed.packageBase === baseline.packageBase &&
    reviewed.commit === baseline.commit &&
    reviewed.digest === baseline.digest &&
    reviewed.scannedAt === baseline.scannedAt &&
    reviewed.staticAnalyzerVersion === baseline.staticAnalyzerVersion &&
    reviewed.reviewedAt === baseline.reviewedAt
  );
}

export function matchesRecipeReview(
  reviewed: RecipeReview | null,
  baseline: RecipeReviewSummary,
): reviewed is RecipeReview {
  return (
    reviewed !== null &&
    matchesRecipeReviewIdentity(
      {
        packageBase: reviewed.scan.packageBase,
        commit: reviewed.scan.commit,
        digest: reviewed.scan.digest,
        scannedAt: reviewed.scan.scannedAt,
        staticAnalyzerVersion: reviewed.scan.staticAnalyzerVersion,
        reviewedAt: reviewed.reviewedAt,
      },
      baseline,
    )
  );
}
