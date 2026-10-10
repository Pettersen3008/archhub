import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import TerminalCommand from "@/components/layout/terminal-command";
import { request } from "@/lib/ipc/client";
import type { RemovalTarget } from "@/lib/ipc/bindings";
import { bytes, date, downloadJson } from "@/lib/utils";
import { useSnapshot } from "./queries";
import RemovalApply from "./removal-task";

// Match Rust's byte ordering for validated ASCII package identifiers.
const targetOrder = (a: RemovalTarget, b: RemovalTarget) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

export default function RemovalReview({
  targets,
  sourceFingerprint,
  label = "Review selected removals",
}: {
  targets: RemovalTarget[];
  sourceFingerprint?: string;
  label?: string;
}) {
  const snapshot = useSnapshot();
  const client = useQueryClient();
  const fingerprint = sourceFingerprint ?? snapshot.data?.fingerprint ?? "";
  const ordered = [...targets].sort(targetOrder);
  const identity = JSON.stringify(ordered);
  const queryKey = ["removal-plan", fingerprint, identity];
  const read = () => request({ command: "removal_plan", targets: ordered, fingerprint });
  const query = useQuery({
    queryKey,
    queryFn: read,
    enabled: false,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const busy = query.fetchStatus !== "idle";
  const inventoryCurrent =
    !!fingerprint &&
    snapshot.fetchStatus === "idle" &&
    !snapshot.isError &&
    !snapshot.data?.locked &&
    snapshot.data?.fingerprint === fingerprint;
  const data = query.data;
  const captureMatches =
    data?.fingerprint === fingerprint &&
    JSON.stringify([...(data?.targets ?? [])].sort(targetOrder)) === identity;
  const current = inventoryCurrent && captureMatches && !busy && !query.isError;
  const valid =
    targets.length > 0 &&
    targets.length <= 100 &&
    targets.every(
      (target) =>
        /^[a-zA-Z0-9@._+][a-zA-Z0-9@._+-]{0,199}$/.test(target.name) &&
        !!target.version &&
        target.version.length <= 200,
    ) &&
    new Set(targets.map((target) => target.name)).size === targets.length;
  async function check() {
    await client
      .fetchQuery({ queryKey, queryFn: read, staleTime: 0, retry: false, networkMode: "always" })
      .catch(() => {});
  }
  const safeCommand =
    current &&
    data?.dependencyCheckPassed &&
    !data.blockers.length &&
    !data.heldPackages.length &&
    valid
      ? `sudo pacman -R -- ${ordered.map((target) => `'${target.name}'`).join(" ")}`
      : null;
  // Both implementations must agree; a command string from metadata is never
  // accepted as an arbitrary browser execution/copy instruction.
  const command = safeCommand && data?.command === safeCommand ? safeCommand : null;
  return (
    <section aria-label="Removal review" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={!valid || !inventoryCurrent || busy}
          onClick={() => void check()}
        >
          {busy ? "Checking removal…" : label}
        </Button>
        {data && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void downloadJson("archhub-removal-plan.json", {
                plan: data,
                actionableCommand: command,
                currentSnapshotMatches: current,
                captureStatus: busy
                  ? "pending"
                  : query.isError
                    ? "failed"
                    : current
                      ? "captured"
                      : "not-current",
              })
            }
          >
            Export removal plan
          </Button>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Checks plain removal of {targets.length} selected package{targets.length === 1 ? "" : "s"}.
        Dependencies and consumers are not added to the selection. Nothing is removed during review.
      </p>
      {!inventoryCurrent && (
        <output className="text-xs text-warning">
          Inventory changed, is locked, or is unavailable. Refresh inventory before reviewing.
        </output>
      )}
      {query.isError && !busy && (
        <p role="alert" className="text-xs text-warning">
          {query.error.message}
        </p>
      )}
      {data && !current && (
        <output className="text-xs text-warning">
          {busy
            ? "Checking — previous removal results are withheld."
            : "Removal availability is unknown. Review again for a current command."}
        </output>
      )}
      {current && data && (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            {data.packages.length} packages ·{" "}
            {data.installedSize ? bytes(data.installedSize) : "0 B"} installed metadata size ·
            reviewed {date(data.capturedAt)}
          </p>
          <ul
            aria-label="Reviewed removal packages"
            className="max-h-60 divide-y overflow-y-auto rounded-md border"
          >
            {data.packages.map((pkg) => (
              <li key={pkg.name} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 font-medium break-all">{pkg.name}</span>
                <span className="font-mono break-all text-muted-foreground">
                  {pkg.installedVersion}
                </span>
              </li>
            ))}
          </ul>
          {data.dependencyCheckPassed ? (
            <p className="text-xs text-muted-foreground">
              Required dependency check passed for this selection.
            </p>
          ) : (
            <p className="text-xs font-medium text-warning">
              Removal is blocked by required dependencies.
            </p>
          )}
          {!!data.blockers.length && (
            <ul
              aria-label="Removal blockers"
              className="max-h-60 space-y-2 overflow-y-auto text-xs leading-5"
            >
              {data.blockers.map((blocker, index) => (
                <li key={index} className="break-words">
                  {blocker.consumer} requires <code>{blocker.dependency}</code>
                  {blocker.causingPackage ? ` · removal of ${blocker.causingPackage}` : ""}
                </li>
              ))}
            </ul>
          )}
          {!!data.heldPackages.length && (
            <p className="text-xs leading-5 break-words text-warning">
              Held by pacman’s HoldPkg policy: {data.heldPackages.join(", ")}. ArchHub withholds the
              removal command.
            </p>
          )}
          {!!data.optionalImpacts.length && (
            <div className="space-y-2">
              <p className="text-xs font-medium">
                Optional features losing their installed providers
              </p>
              <ul
                aria-label="Optional removal impacts"
                className="max-h-60 space-y-2 overflow-y-auto text-xs leading-5 text-muted-foreground"
              >
                {data.optionalImpacts.map((impact, index) => (
                  <li key={index} className="break-words">
                    {impact.consumer} · <code>{impact.dependency}</code>
                    {impact.description ? `: ${impact.description}` : ""}
                    {` · ${impact.removedProviders.join(", ")}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {command && (
            <>
              <TerminalCommand
                command={command}
                label={
                  targets.length === 1
                    ? `remove command for ${targets[0]!.name}`
                    : "reviewed removal command"
                }
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Run in your terminal and review pacman’s final prompts. Installed size is not a
                reclaimable-space estimate; scripts and hooks can have additional effects.
              </p>
            </>
          )}
          <details className="evidence-disclosure">
            <summary>Removal capture & limitations</summary>
            <div className="space-y-2 p-3">
              {data.limitations.map((limitation) => (
                <p key={limitation} className="text-xs leading-5 text-muted-foreground">
                  {limitation}
                </p>
              ))}
            </div>
          </details>
        </>
      )}
      <RemovalApply plan={data ?? null} current={!!command} />
    </section>
  );
}
