import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecipeFile } from "@/lib/ipc/bindings";
import { cn } from "@/lib/utils";

export default function SourceView({
  file,
  highlights,
  jump,
  label = "Build recipe source",
}: {
  file: RecipeFile;
  highlights: number[];
  jump: number;
  label?: string;
}) {
  const lines = useMemo(() => file.content.split("\n"), [file.content]);
  const [page, setPage] = useState(() => (jump > 0 ? Math.floor((jump - 1) / 400) : 0));
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [searchRevision, setSearchRevision] = useState(0);
  const matches = useMemo(() => {
    const needle = query.toLowerCase();
    return needle
      ? lines.flatMap((line, index) => (line.toLowerCase().includes(needle) ? [index + 1] : []))
      : [];
  }, [lines, query]);
  const selectedLine = query ? (matches[matchIndex] ?? 0) : jump;
  const matchingLines = useMemo(() => new Set(matches), [matches]);
  const searchInput = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const region = useRef<HTMLElement>(null);
  const target = useRef<HTMLSpanElement>(null);
  const descriptionId = useId();
  const searchDescriptionId = useId();
  const activePage = Math.min(page, Math.max(0, Math.ceil(lines.length / 400) - 1));
  const start = activePage * 400;
  useEffect(() => {
    if (jump > 0) {
      region.current?.scrollIntoView({ block: "nearest" });
      target.current?.scrollIntoView({ block: "center", inline: "nearest" });
      region.current?.focus({ preventScroll: true });
    }
  }, [jump]);
  useEffect(() => {
    if (!query || !selectedLine || !target.current || !viewport.current) return;
    region.current?.scrollIntoView({ block: "start", inline: "nearest" });
    const row = target.current.getBoundingClientRect();
    const bounds = viewport.current.getBoundingClientRect();
    viewport.current.scrollTop +=
      row.top - bounds.top - (viewport.current.clientHeight - row.height) / 2;
  }, [query, selectedLine, searchRevision]);
  function search(value: string) {
    setQuery(value);
    setMatchIndex(0);
    if (value) {
      const needle = value.toLowerCase();
      const first = lines.findIndex((line) => line.toLowerCase().includes(needle));
      if (first >= 0) setPage(Math.floor(first / 400));
    }
    setSearchRevision((revision) => revision + 1);
  }
  function moveMatch(direction: number) {
    if (!matches.length) return;
    const index = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(index);
    setPage(Math.floor((matches[index]! - 1) / 400));
    setSearchRevision((revision) => revision + 1);
    searchInput.current?.focus({ preventScroll: true });
  }
  return (
    <section aria-label={label} aria-describedby={descriptionId} ref={region} tabIndex={-1}>
      <div className="mb-2 flex min-w-0 items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
          />
          <Input
            ref={searchInput}
            className="pl-9"
            aria-label="Find in captured file"
            aria-describedby={searchDescriptionId}
            placeholder="Find in captured file…"
            value={query}
            onChange={(event) => search(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                moveMatch(event.shiftKey ? -1 : 1);
              }
            }}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous source match"
          disabled={!matches.length}
          onClick={() => moveMatch(-1)}
        >
          <ChevronUp aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next source match"
          disabled={!matches.length}
          onClick={() => moveMatch(1)}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear source search"
          disabled={!query}
          onClick={() => {
            search("");
            searchInput.current?.focus({ preventScroll: true });
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div
        id={searchDescriptionId}
        className="mb-3 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        <span>Enter next · Shift+Enter previous</span>
        <output aria-live="polite">
          {query
            ? matches.length
              ? `Match ${matchIndex + 1} of ${matches.length} ${matches.length === 1 ? "line" : "lines"}`
              : "No matching lines"
            : "Case-insensitive · this file"}
        </output>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span id={descriptionId} aria-live="polite" className="min-w-0 break-all">
          <span>
            Lines {start + 1}–{Math.min(start + 400, lines.length)} of{" "}
            {lines.length.toLocaleString()}
          </span>
          {selectedLine > start &&
            selectedLine <= Math.min(start + 400, lines.length) &&
            ` · Selected ${file.path}:${selectedLine}`}
        </span>
        {lines.length > 400 && (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={activePage === 0}
              onClick={() => setPage(activePage - 1)}
            >
              Previous source lines
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={start + 400 >= lines.length}
              onClick={() => setPage(activePage + 1)}
            >
              Next source lines
            </Button>
          </div>
        )}
      </div>
      <div
        ref={viewport}
        className="max-h-[450px] overflow-auto rounded-lg border bg-background font-mono text-xs leading-[22px]"
      >
        <pre className="min-w-max py-3">
          {lines.slice(start, start + 400).map((line, index) => (
            <span
              key={start + index}
              ref={selectedLine === start + index + 1 ? target : undefined}
              className={cn(
                "flex pr-4",
                highlights.includes(start + index + 1) && "bg-warning-bg",
                matchingLines.has(start + index + 1) && "bg-accent text-accent-foreground",
                selectedLine === start + index + 1 && "outline-1 outline-ring",
              )}
            >
              <span
                aria-hidden="true"
                className="sticky left-0 mr-4 inline-block w-12 shrink-0 border-r bg-background pr-2 text-right text-muted-foreground select-none"
              >
                {start + index + 1}
              </span>
              <code>{line || " "}</code>
            </span>
          ))}
        </pre>
      </div>
      <p className="mt-2 font-mono text-xs break-all text-muted-foreground">
        File SHA-256 · {file.digest}
      </p>
    </section>
  );
}
