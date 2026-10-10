import type {
  Request,
  Snapshot,
  PackagePage,
  Package,
  PackageBatch,
  Audit,
  RecipeInspection,
  RecipeReview,
  RecipeReviewSummary,
  HistoryEntry,
  UpdatePlan,
  UpdatePreparation,
  IntegrityReport,
  DependencyReport,
  PackageComparison,
  ForeignRecipeLookup,
  MaintenanceReport,
  RepositoryUpdates,
  ForeignUpdates,
  RemovalPlan,
} from "./bindings";
type Results = {
  update_preparation: UpdatePreparation;
  removal_plan: RemovalPlan;
  maintenance: MaintenanceReport;
  repository_updates: RepositoryUpdates;
  foreign_updates: ForeignUpdates;
  foreign_recipe: ForeignRecipeLookup;
  comparison: PackageComparison;
  dependencies: DependencyReport;
  integrity: IntegrityReport;
  snapshot: Snapshot;
  packages: PackagePage;
  package: Package;
  packages_by_ids: PackageBatch;
  aur_search: PackagePage;
  audit: Audit;
  recipe: RecipeInspection;
  recipe_reviews: RecipeReviewSummary[];
  recipe_review: RecipeReview | null;
  record_recipe_review: RecipeInspection;
  remove_recipe_review: null;
  history: HistoryEntry[];
  plan: UpdatePlan;
};
export async function request<R extends Request>(
  input: R,
  signal?: AbortSignal,
): Promise<Results[R["command"]]> {
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const result = await invoke<Results[R["command"]]>("query", { request: input });
      if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      return result;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  const response = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      data?.error ?? "The local package service is unavailable. Start ArchHub with bun run dev.",
    );
  }
  return response.json() as Promise<Results[R["command"]]>;
}
