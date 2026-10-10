import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/ipc/client";

export function useRecipeInspection(base: string, autoStart = false) {
  const client = useQueryClient();
  const queryKey = ["recipe", base];
  // A scan is an explicit, bounded read. Finish it across route changes;
  // cancelling the last observer would restore the previous successful state.
  const queryFn = () => request({ command: "recipe", base });
  const query = useQuery({
    queryKey,
    queryFn,
    enabled: autoStart,
    staleTime: 300_000,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // The local HTTP/IPC service owns external source-connectivity errors.
    networkMode: "always",
  });
  return {
    ...query,
    isChecking: query.fetchStatus !== "idle",
    check: () =>
      client.fetchQuery({ queryKey, queryFn, staleTime: 0, retry: false, networkMode: "always" }),
  };
}
