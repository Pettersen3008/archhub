import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, ArrowUpRight, Plus, Minus, Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, Loading, ErrorState, Empty } from "@/components/layout/shared";
import { request } from "@/lib/ipc/client";
import { cn, downloadJson } from "@/lib/utils";
import { useRemovalTask, RemovalTaskResult } from "@/features/packages/removal-task";
export default function History() {
  const removal = useRemovalTask();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("all");
  const history = useQuery({
    queryKey: ["history"],
    queryFn: ({ signal }) => request({ command: "history" }, signal),
  });
  const items =
    history.data?.filter(
      (item) =>
        (action === "all" || item.action === action) &&
        item.package.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="PACKAGE ACTIVITY"
        title="Activity"
        description="Recent package changes from the pacman log."
      >
        <Button
          variant="outline"
          size="sm"
          disabled={!history.data}
          onClick={() => downloadJson("archhub-package-history.json", history.data)}
        >
          <Download className="size-3.5" />
          Export history
        </Button>
      </PageHeader>
      {removal.data?.task && (
        <div className="mb-5">
          <RemovalTaskResult task={removal.data.task} />
        </div>
      )}
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div className="relative min-w-48 flex-1 sm:max-w-72">
            <Search className="absolute top-3 left-3 size-3.5 text-muted-foreground" />
            <Input
              aria-label="Search package history"
              placeholder="Filter by package name…"
              className="bg-background pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {["all", "installed", "upgraded", "removed"].map((value) => (
              <Button
                key={value}
                size="sm"
                variant={action === value ? "secondary" : "ghost"}
                className="px-2 text-xs capitalize"
                onClick={() => setAction(value)}
              >
                {value}
              </Button>
            ))}
          </div>
        </div>
        {history.isPending ? (
          <Loading />
        ) : history.isError ? (
          <ErrorState error={history.error} retry={() => void history.refetch()} />
        ) : !items.length ? (
          <Empty
            title="No matching activity"
            description="Try another package or action filter. ArchHub reads the latest package events from the configured pacman log."
          />
        ) : (
          <div className="max-h-[650px] overflow-auto">
            {items.map((item, index) => (
              <div
                key={`${item.timestamp}-${item.package}-${index}`}
                className="flex items-start gap-4 border-b px-5 py-4 last:border-b-0"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                    item.action === "removed"
                      ? "bg-danger-bg text-destructive"
                      : item.action === "installed"
                        ? "bg-success-bg text-success"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {item.action === "removed" ? (
                    <Minus className="size-3.5" />
                  ) : item.action === "installed" ? (
                    <Plus className="size-3.5" />
                  ) : (
                    <ArrowUpRight className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold">
                    {item.package}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {item.action}
                    </span>
                  </p>
                  <p className="mt-1.5 font-mono text-xs break-all text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                  {new Date(item.timestamp).toLocaleString("en", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
          <Clock3 className="size-3.5" />
          Most recent 300 events from the last 2 MB of the pacman log.
        </div>
      </div>
    </div>
  );
}
