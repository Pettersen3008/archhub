import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/ipc/client";
import type { Audit, UpdatePlan } from "@/lib/ipc/bindings";
export function useSnapshot() {
  return useQuery({
    queryKey: ["snapshot"],
    queryFn: ({ signal }) => request({ command: "snapshot", refresh: false }, signal),
    refetchInterval: 60_000,
  });
}
export function useAudit(enabled = true) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["audit"],
    // Read-only checks must finish across route changes. Cancelling on unmount
    // would restore the previous successful query state during a recheck.
    queryFn: () => request({ command: "audit", refresh: false }),
    enabled,
    staleTime: 300_000,
    retry: false,
    retryOnMount: false,
    refetchOnMount: (value) => value.state.status !== "error",
    refetchOnReconnect: (value) => value.state.status !== "error",
  });
  function check(read: () => Promise<Audit> = () => request({ command: "audit", refresh: true })) {
    return client.fetchQuery({
      queryKey: ["audit"],
      queryFn: read,
      staleTime: 0,
      retry: false,
      // Explicit checks target local HTTP/IPC. Let that service report network
      // failures, and start the requested operation before observer options change.
      networkMode: "always",
    });
  }
  async function checkPlan(fingerprint: string): Promise<UpdatePlan> {
    const state = client.getQueryState(["audit"]);
    if (state && state.fetchStatus !== "idle") {
      throw new Error("An advisory check is already running. Wait for it before creating a plan.");
    }
    let plan: UpdatePlan | undefined;
    try {
      await check(async () => {
        plan = await request({ command: "plan", fingerprint });
        if (!plan.security?.audit) {
          throw new Error(
            plan.security?.unavailableReason ?? "Advisory evidence unavailable in this plan",
          );
        }
        return plan.security.audit;
      });
    } catch (error) {
      // A metadata plan remains useful when its advisory check fails. The audit
      // query retains that failure for every consumer instead of reviving old data.
      if (!plan) throw error;
    }
    if (!plan) throw new Error("Review plan was not captured");
    return plan;
  }
  return {
    ...query,
    isChecking: query.fetchStatus !== "idle",
    check: () => check(),
    checkPlan,
  };
}
export function usePackages(
  query: string,
  scope: string,
  repository = "all",
  offset = 0,
  sort = "name",
  enabled = true,
) {
  const snapshot = useSnapshot();
  return useQuery({
    queryKey: ["packages", query, scope, repository, offset, sort, snapshot.data?.fingerprint],
    queryFn: ({ signal }) =>
      request({ command: "packages", query, scope, repository, offset, limit: 100, sort }, signal),
    enabled: enabled && !!snapshot.data,
  });
}
