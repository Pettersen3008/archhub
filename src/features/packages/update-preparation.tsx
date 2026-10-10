import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSnapshot } from "./queries";
import { request } from "@/lib/ipc/client";
import { cn, copy, date, downloadJson, openUrl } from "@/lib/utils";

const feedUrl = "https://archlinux.org/feeds/news/";
const archiveUrl = "https://archlinux.org/news/";
const maxAge = 15 * 60;

export function officialNewsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "archlinux.org" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/news\/[a-zA-Z0-9_.-]+\/$/.test(url.pathname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function UpdatePreparation({ navigate }: { navigate: (page: string) => void }) {
  const snapshot = useSnapshot();
  const client = useQueryClient();
  const fingerprint = snapshot.data?.fingerprint ?? "";
  const key = ["update-preparation", fingerprint];
  const query = useQuery({
    queryKey: key,
    queryFn: () => request({ command: "update_preparation", fingerprint }),
    enabled: false,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const [clock, setClock] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now() / 1000), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const [newsReview, setNewsReview] = useState("");
  const [recoveryReview, setRecoveryReview] = useState("");
  const [offset, setOffset] = useState(0);
  const data = query.data;
  const checking = query.fetchStatus !== "idle";
  const inventoryCurrent =
    !!snapshot.data &&
    !snapshot.isError &&
    snapshot.fetchStatus === "idle" &&
    !snapshot.data.locked;
  const command = snapshot.data?.omarchy ? "omarchy update" : "sudo pacman -Syu";
  const complete =
    !!data?.repositories &&
    !!data.news &&
    !data.repositoryError &&
    !data.newsError &&
    data.repositories.fingerprint === data.fingerprint &&
    data.command === command &&
    data.news.sourceUrl === feedUrl &&
    /^[a-f0-9]{64}$/.test(data.news.digest) &&
    data.news.items.length > 0 &&
    data.news.items.every((item) => officialNewsUrl(item.url) && Number.isFinite(item.publishedAt));
  const captureTimes = useMemo(
    () =>
      data
        ? [data.capturedAt, data.repositories?.checkedAt, data.news?.checkedAt].filter(
            (t): t is number => t !== undefined,
          )
        : [],
    [data],
  );
  function isRecent(at: number) {
    return (
      captureTimes.length === 3 &&
      captureTimes.every(
        (time) => Number.isFinite(time) && time > 0 && time <= at + 60 && at - time < maxAge,
      )
    );
  }
  const recent = isRecent(clock);
  useEffect(() => {
    const oldest = Math.min(...captureTimes);
    const remaining = (oldest + maxAge) * 1000 - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = window.setTimeout(() => setClock(Date.now() / 1000), remaining + 1);
    return () => window.clearTimeout(timer);
  }, [captureTimes]);
  const matching = inventoryCurrent && data?.fingerprint === fingerprint;
  const current = !checking && !query.isError && matching && recent && complete;
  const identity = data
    ? JSON.stringify([query.dataUpdatedAt, data.capturedAt, data.fingerprint, data.news?.digest])
    : "";
  const reviewed = !!identity && newsReview === identity && recoveryReview === identity;
  const ready = current && reviewed;
  const status = checking
    ? "Checking"
    : query.isError
      ? "Check failed"
      : !data
        ? "Not checked"
        : !matching
          ? "Historical capture"
          : !complete
            ? "Partial capture"
            : !recent
              ? "Capture expired"
              : reviewed
                ? "Ready for terminal handoff"
                : "Checks captured — review required";
  async function check() {
    setNewsReview("");
    setRecoveryReview("");
    setOffset(0);
    try {
      await client.fetchQuery({
        queryKey: key,
        queryFn: () => request({ command: "update_preparation", fingerprint }),
        staleTime: 0,
        retry: false,
        networkMode: "always",
      });
      setClock(Date.now() / 1000);
      await client.fetchQuery({
        queryKey: ["snapshot"],
        queryFn: () => request({ command: "snapshot", refresh: true }),
        staleTime: 0,
        retry: false,
        networkMode: "always",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update check failed");
    }
  }
  function open(value: string) {
    void openUrl(value).catch(() => toast.error("Could not open the official news page"));
  }
  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="eyebrow mb-2">FULL SYSTEM UPDATE</p>
            <h2 className="text-lg font-semibold">Prepare your next update</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Check current repository versions and read official Arch notices before starting{" "}
              {snapshot.data?.omarchy ? "Omarchy’s supported updater" : "the full system updater"}{" "}
              in your terminal.
            </p>
          </div>
          <Button disabled={checking || !inventoryCurrent} onClick={() => void check()}>
            <RefreshCw className={cn("size-4", checking && "animate-spin")} />
            {checking ? "Checking update readiness…" : "Check update readiness"}
          </Button>
        </div>
        <output className="mt-4 block text-sm font-medium" aria-live="polite">
          {status}
        </output>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Checks use temporary databases and configured mirrors. They leave the system package
          databases unchanged. AUR, foreign packages, toolchains and Omarchy migrations are outside
          the repository count.
        </p>
        {!inventoryCurrent && (
          <p className="mt-3 text-xs text-warning">
            Package inventory is unavailable, refreshing, or locked. Refresh inventory after the
            package manager finishes.
          </p>
        )}
        {query.isError && (
          <p role="alert" className="mt-3 text-sm text-warning">
            {query.error.message}. Earlier captures remain historical evidence.
          </p>
        )}
        {data && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Captured {date(data.capturedAt)} · expires after 15 minutes
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const fresh = isRecent(Date.now() / 1000);
                void downloadJson("archhub-update-preparation.json", {
                  preparation: data,
                  status:
                    !fresh &&
                    (status === "Ready for terminal handoff" ||
                      status === "Checks captured — review required")
                      ? "Capture expired"
                      : status,
                  currentSnapshotMatches: matching,
                  review: { news: newsReview === identity, recovery: recoveryReview === identity },
                  handoffCommand: ready && fresh ? command : null,
                });
              }}
            >
              <Download className="size-3.5" />
              Export update preparation
            </Button>
          </div>
        )}
      </section>
      {data && (
        <section className="panel p-5">
          <h2 className="text-sm font-semibold">Repository version changes</h2>
          {data.repositoryError && (
            <p role="alert" className="mt-3 text-sm text-warning">
              {data.repositoryError}
            </p>
          )}
          {data.repositories && (
            <>
              <p className="mt-2 text-xs text-muted-foreground">
                {data.repositories.packages.length} version changes from configured mirrors ·{" "}
                {date(data.repositories.checkedAt)}
                {!current && " · review capture status above"}
              </p>
              {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- A named scroll region needs a keyboard tab stop (WCAG 2.1.1). */}
              <section
                className="mt-4 max-h-72 divide-y overflow-y-auto focus-visible:ring-2 focus-visible:ring-ring"
                tabIndex={0}
                aria-label="Captured repository version changes"
              >
                {data.repositories.packages.slice(offset, offset + 25).map((pkg) => (
                  <div key={pkg.name} className="flex flex-wrap justify-between gap-2 py-2 text-xs">
                    <span className="font-medium">{pkg.name}</span>
                    <span className="font-mono text-muted-foreground">
                      {pkg.installedVersion} → {pkg.availableVersion}
                    </span>
                  </div>
                ))}
              </section>
              {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
              {data.repositories.packages.length > 25 && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <span>
                    {offset + 1}–{Math.min(offset + 25, data.repositories.packages.length)} of{" "}
                    {data.repositories.packages.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 25))}
                  >
                    Previous version changes
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={offset + 25 >= data.repositories.packages.length}
                    onClick={() => setOffset(offset + 25)}
                  >
                    Next version changes
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Official Arch update notices</h2>
          <Button variant="outline" size="sm" onClick={() => open(archiveUrl)}>
            <ExternalLink className="size-3.5" />
            Open news archive
          </Button>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Read notices that apply to your setup, especially manual interventions. The feed covers
          recent publications; check older entries in the archive if you skipped updates. ArchHub
          does not determine applicability or mark an issue resolved.
        </p>
        {data?.newsError && (
          <p role="alert" className="mt-3 text-sm text-warning">
            {data.newsError}
          </p>
        )}
        {data?.news && (
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              Retrieved {date(data.news.checkedAt)}
              {data.news.publishedAt ? ` · feed last published ${date(data.news.publishedAt)}` : ""}
            </p>
            <ul className="mt-3 max-h-80 divide-y overflow-y-auto">
              {data.news.items.map((item) => {
                const url = officialNewsUrl(item.url);
                return (
                  <li key={item.url} className="py-3">
                    <button
                      className="text-left text-sm leading-6 font-medium underline decoration-border underline-offset-4 disabled:no-underline disabled:opacity-60"
                      disabled={!url}
                      onClick={() => url && open(url)}
                    >
                      {item.title}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {date(item.publishedAt)}
                      {!url && " · official link unavailable"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <section className="panel space-y-4 p-5">
        <h2 className="text-sm font-semibold">Review, then continue in your terminal</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          A handoff is available after a complete, current capture and your review. The updater
          determines the final transaction; read its output before accepting changes.
        </p>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            className="mt-1 size-4 shrink-0 accent-primary"
            type="checkbox"
            disabled={!current}
            checked={!!identity && newsReview === identity}
            onChange={(event) => setNewsReview(event.target.checked ? identity : "")}
          />
          I have read the relevant Arch notices and handled any manual steps that apply.
        </label>
        <label className="flex items-start gap-3 text-sm leading-6">
          <input
            className="mt-1 size-4 shrink-0 accent-primary"
            type="checkbox"
            disabled={!current}
            checked={!!identity && recoveryReview === identity}
            onChange={(event) => setRecoveryReview(event.target.checked ? identity : "")}
          />
          I have a current backup or recovery point and know how to recover if the update fails.
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4">
          <code className="text-sm">{command}</code>
          <Button
            disabled={!ready}
            onClick={() => {
              if (!ready || !isRecent(Date.now() / 1000)) {
                setClock(Date.now() / 1000);
                return;
              }
              void copy(command)
                .then(() => toast.success("Updater command copied"))
                .catch(() => toast.error("Clipboard unavailable"));
            }}
          >
            <CheckCircle2 className="size-4" />
            Copy full updater command
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("security")}>
            Review security evidence
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate("maintenance")}>
            Check foreign packages
          </Button>
        </div>
        {data && (
          <details className="evidence-disclosure">
            <summary>Capture scope and limitations</summary>
            <div className="space-y-2 p-4 text-xs leading-5 text-muted-foreground">
              {[
                ...data.limitations,
                ...(data.repositories?.limitations ?? []),
                ...(data.news?.limitations ?? []),
              ].map((text) => (
                <p key={text}>{text}</p>
              ))}
              <p className="font-mono break-all">State fingerprint: {data.fingerprint}</p>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
