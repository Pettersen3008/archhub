import type { Snapshot } from "@/lib/ipc/bindings";

export function repositoryFreshness(snapshot?: Snapshot) {
  const uncertain =
    snapshot?.repositories.filter(
      (repository) =>
        repository.updatedAt === null ||
        !Number.isFinite(repository.updatedAt) ||
        repository.updatedAt > snapshot.capturedAt + 60 ||
        snapshot.capturedAt - repository.updatedAt > 7 * 86400,
    ) ?? [];
  return { uncertain, usable: !!snapshot?.repositories.length && uncertain.length === 0 };
}
