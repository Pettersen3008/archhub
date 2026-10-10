import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RemovalPlan, RemovalTask, RemovalTaskState } from "@/lib/ipc/bindings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { date, downloadJson } from "@/lib/utils";
import { request } from "@/lib/ipc/client";

const synchronized = new WeakMap<object, number>();
const native = () => "__TAURI_INTERNALS__" in window;
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
export function useRemovalTask() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["removal-task-state"],
    queryFn: () => invoke<RemovalTaskState>("removal_task_state"),
    enabled: native(),
    retry: false,
    staleTime: 2000,
    networkMode: "always",
    refetchInterval: (q) => (q.state.data?.task?.status === "running" ? 1000 : false),
    refetchOnWindowFocus: true,
  });
  const task = query.data?.task;
  useEffect(() => {
    if (!task || task.status === "running" || synchronized.get(client) === task.id) return;
    synchronized.set(client, task.id);
    void client.resetQueries({ queryKey: ["removal-plan"] });
    void client
      .fetchQuery({
        queryKey: ["snapshot"],
        queryFn: () => request({ command: "snapshot", refresh: true }),
        staleTime: 0,
        retry: false,
        networkMode: "always",
      })
      .then(() =>
        Promise.all(
          ["packages", "maintenance", "history"].map((key) =>
            client.invalidateQueries({ queryKey: [key] }),
          ),
        ),
      )
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Cannot refresh package state after removal",
        ),
      );
  }, [task, client]);
  return { ...query, isNative: native() };
}

export function RemovalTaskResult({ task }: { task: RemovalTask }) {
  return (
    <section aria-label="Removal task outcome" className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">
        {task.status === "running"
          ? "Removal task running"
          : task.status === "removed"
            ? "Packages removed"
            : task.status === "rejected"
              ? "Removal not started"
              : "Removal needs attention"}
      </h2>
      <p className="text-xs break-words text-muted-foreground">
        {task.request.targets.map((p) => `${p.name} ${p.version}`).join(", ")} · started{" "}
        {date(task.startedAt)}
      </p>
      <p
        role={task.status === "unknown" || task.status === "partial" ? "alert" : undefined}
        className="text-xs leading-5 text-muted-foreground"
      >
        {task.status === "running"
          ? "Complete the administrator authentication prompt. The task continues when you navigate away. Keep ArchHub open until its outcome is shown in Activity. Do not start another package operation while it runs."
          : task.status === "unknown"
            ? "The outcome is unknown. Package changes may have occurred. Refresh inventory and inspect pacman's log before another attempt."
            : (task.outcome?.message ??
              "The outcome is unknown. Package changes may have occurred. Refresh inventory and inspect pacman's log before another attempt.")}
      </p>
      {!!task.outcome?.remaining.length && (
        <p className="text-xs leading-5 break-words text-warning">
          Still installed: {task.outcome.remaining.map((p) => `${p.name} ${p.version}`).join(", ")}
        </p>
      )}
      {!!task.diagnostics && (
        <details className="evidence-disclosure">
          <summary>Task diagnostics</summary>
          <pre className="max-h-60 overflow-auto p-3 text-xs break-words whitespace-pre-wrap">
            {task.diagnostics}
          </pre>
        </details>
      )}
      {task.status !== "running" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void downloadJson("archhub-removal-outcome.json", task)}
        >
          Export removal outcome
        </Button>
      )}
    </section>
  );
}

export default function RemovalApply({
  plan,
  current,
}: {
  plan: RemovalPlan | null;
  current: boolean;
}) {
  const tasks = useRemovalTask();
  const client = useQueryClient();
  const [selection, setSelection] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = JSON.stringify([plan?.fingerprint, plan?.executionDigest, plan?.targets]);
  const open = selection === identity;
  const busy = starting || tasks.data?.task?.status === "running";
  const usable =
    current &&
    !!plan?.executionDigest &&
    plan.dependencyCheckPassed &&
    !plan.blockers.length &&
    !plan.heldPackages.length;
  const available = tasks.data?.available && !tasks.isError;
  async function start() {
    if (!plan || !usable || !available || !acknowledged || busy) return;
    setStarting(true);
    setError(null);
    try {
      const task = await invoke<RemovalTask>("start_removal_task", {
        request: {
          protocol: 1,
          targets: plan.targets,
          fingerprint: plan.fingerprint,
          executionDigest: plan.executionDigest,
        },
      });
      client.setQueryData<RemovalTaskState>(["removal-task-state"], (old) => ({ ...old!, task }));
      setSelection(null);
      setAcknowledged(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }
  if (!tasks.isNative) return null;
  const task = tasks.data?.task;
  return (
    <div className="space-y-3">
      {task && <RemovalTaskResult task={task} />}
      {!available && (
        <p className="text-xs leading-5 text-muted-foreground">
          {tasks.error?.message ??
            tasks.data?.unavailableReason ??
            "Checking authenticated removal availability…"}{" "}
          You can use the copied terminal command.
        </p>
      )}
      {available && !usable && plan?.executionUnavailableReason && (
        <p className="text-xs leading-5 text-warning">{plan?.executionUnavailableReason}</p>
      )}
      {available && (
        <Button
          size="sm"
          variant="outline"
          disabled={!usable || busy}
          onClick={() => {
            setSelection(identity);
            setAcknowledged(false);
            setError(null);
          }}
        >
          Remove reviewed packages…
        </Button>
      )}
      {plan && (
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!value && !starting) setSelection(null);
          }}
        >
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Remove {plan.targets.length} reviewed package{plan.targets.length === 1 ? "" : "s"}?
              </DialogTitle>
              <DialogDescription>
                Administrator authentication follows. Package scripts and hooks can make additional
                changes. Have a recovery option before proceeding.
              </DialogDescription>
            </DialogHeader>
            <ul
              aria-label="Packages to remove"
              className="max-h-48 space-y-2 overflow-y-auto text-xs"
            >
              {plan.targets.map((target) => (
                <li key={target.name} className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium break-all">{target.name}</span>
                  <code className="break-all">{target.version}</code>
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-3 text-xs leading-5">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-primary"
                checked={acknowledged}
                disabled={starting}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I reviewed the selection and understand that removal changes the system.
            </label>
            {!usable && (
              <p role="alert" className="text-xs text-warning">
                The review is no longer current. Close this dialog and review again.
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-warning">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={starting} onClick={() => setSelection(null)}>
                Keep packages
              </Button>
              <Button
                disabled={!usable || !available || !acknowledged || busy}
                onClick={() => void start()}
              >
                {starting ? "Preparing authentication…" : "Authenticate and remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
