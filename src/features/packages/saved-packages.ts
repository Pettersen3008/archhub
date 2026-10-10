import { request } from "@/lib/ipc/client";
import type { PackageBatch } from "@/lib/ipc/bindings";

export async function readSavedPackages(ids: string[], signal: AbortSignal) {
  const unique = [...new Set(ids)];
  const result: PackageBatch = { items: [], missingIds: [], fingerprint: "", capturedAt: 0 };
  // At most two bounded reads in flight, including a collection of 1000 bookmarks.
  for (let offset = 0; offset < unique.length; offset += 64) {
    const batches = [unique.slice(offset, offset + 32), unique.slice(offset + 32, offset + 64)];
    const responses = await Promise.all(
      batches
        .filter((batch) => batch.length)
        .map((batch) => request({ command: "packages_by_ids", ids: batch }, signal)),
    );
    for (const response of responses) {
      if (result.fingerprint && result.fingerprint !== response.fingerprint) {
        throw new Error("Inventory changed while loading saved packages. Try again.");
      }
      result.fingerprint = response.fingerprint;
      result.capturedAt = response.capturedAt;
      result.items.push(...response.items);
      result.missingIds.push(...response.missingIds);
    }
  }
  return result;
}
