import { useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/lib/ipc/client";
import { useSnapshot } from "./queries";

export function useMaintenance(enabled = true) {
  const snapshot = useSnapshot();
  return useQuery({
    queryKey: ["maintenance", snapshot.data?.fingerprint],
    queryFn: () => request({ command: "maintenance" }),
    enabled: enabled && !!snapshot.data,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useMaintenanceChecks() {
  const snapshot = useSnapshot();
  const client = useQueryClient();
  const fingerprint = snapshot.data?.fingerprint ?? "";
  const repositoryKey = ["repository-updates", fingerprint];
  const foreignKey = ["foreign-updates", fingerprint];
  const options = {
    enabled: false,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  } as const;
  const repositories = useQuery({
    ...options,
    queryKey: repositoryKey,
    queryFn: () => request({ command: "repository_updates", fingerprint }),
  });
  const foreign = useQuery({
    ...options,
    queryKey: foreignKey,
    queryFn: () => request({ command: "foreign_updates", fingerprint }),
  });
  // Intentional checks complete across navigation. Failed or pending attempts
  // withhold cached conclusions; reconnecting never sends package names again.
  function checkRepositories() {
    return client.fetchQuery({
      queryKey: repositoryKey,
      queryFn: () => request({ command: "repository_updates", fingerprint }),
      staleTime: 0,
      retry: false,
      networkMode: "always",
    });
  }
  function checkForeign() {
    return client.fetchQuery({
      queryKey: foreignKey,
      queryFn: () => request({ command: "foreign_updates", fingerprint }),
      staleTime: 0,
      retry: false,
      networkMode: "always",
    });
  }
  return {
    repositories,
    foreign,
    checkRepositories,
    checkForeign,
    repositoriesCurrent:
      repositories.fetchStatus === "idle" &&
      !repositories.isError &&
      !!fingerprint &&
      !snapshot.isError &&
      !snapshot.data?.locked &&
      repositories.data?.fingerprint === fingerprint,
    foreignCurrent:
      foreign.fetchStatus === "idle" &&
      !foreign.isError &&
      !!fingerprint &&
      !snapshot.isError &&
      !snapshot.data?.locked &&
      foreign.data?.fingerprint === fingerprint,
  };
}
