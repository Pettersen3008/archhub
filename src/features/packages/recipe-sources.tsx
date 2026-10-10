import { useState } from "react";
import { Copy, FileCode2, Fingerprint, Info, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Empty, SectionTitle } from "@/components/layout/shared";
import type { RecipeChecksum, RecipeSource, RecipeSourceEvidence } from "@/lib/ipc/bindings";
import { cn, copy } from "@/lib/utils";

const pageSize = 25;
const kindLabels: Record<string, string> = {
  download: "Download",
  vcs: "Version control",
  local: "Local file",
  signature: "Detached signature",
  unknown: "Unknown source",
};
const algorithmLabels: Record<string, string> = {
  cksums: "CRC",
  md5sums: "MD5",
  sha1sums: "SHA-1",
  sha224sums: "SHA-224",
  sha256sums: "SHA-256",
  sha384sums: "SHA-384",
  sha512sums: "SHA-512",
  b2sums: "BLAKE2",
};
const states: Record<string, string> = {
  declared: "Checksum declared",
  skipped: "SKIP",
  invalid: "Invalid value",
  unaligned: "Unaligned array",
};
function clipboard(value: string) {
  void copy(value)
    .then(() => toast.success("Copied declaration"))
    .catch(() => toast.error("Clipboard unavailable"));
}
function Pager({
  offset,
  total,
  onChange,
  name,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
  name: string;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {offset + 1}–{Math.min(offset + pageSize, total)} of {total} {name}
      </p>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          aria-label={`Previous ${name} page`}
          disabled={!offset}
          onClick={() => onChange(Math.max(0, offset - pageSize))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Next ${name} page`}
          disabled={offset + pageSize >= total}
          onClick={() => onChange(offset + pageSize)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
function Checksum({ check, jump }: { check: RecipeChecksum; jump: (line: number) => void }) {
  return (
    <div className="space-y-2 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">{algorithmLabels[check.algorithm] ?? check.algorithm}</p>
        <span
          className={cn("status", check.state === "declared" ? "status-neutral" : "status-warn")}
        >
          {states[check.state] ?? "Unknown declaration"}
        </span>
      </div>
      <p className="font-mono text-xs leading-5 break-all">{check.value || "(empty value)"}</p>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-0 text-xs"
        aria-label={`Inspect checksum line ${check.line}`}
        onClick={() => jump(check.line)}
      >
        .SRCINFO:{check.line}
      </Button>
    </div>
  );
}
export default function RecipeSources({
  evidence,
  currentKnown,
  jump,
}: {
  evidence: RecipeSourceEvidence | null | undefined;
  currentKnown: boolean;
  jump: (line: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [keyOffset, setKeyOffset] = useState(0);
  const [orphanOffset, setOrphanOffset] = useState(0);
  if (!evidence)
    return (
      <Empty
        title="Source evidence is unavailable"
        description="This capture predates source analysis. Fetch the current recipe to inspect its declarations; no verified-source result is available."
      />
    );
  const q = search.trim().toLowerCase();
  const sources = evidence.sources.filter(
    (row) =>
      (filter === "all" ||
        (filter === "review"
          ? row.notes.length > 0 || row.checksums.some((c) => c.state !== "declared")
          : row.kind === filter)) &&
      [
        row.declaration,
        row.name,
        row.architecture ?? "common",
        ...row.checksums.flatMap((c) => [c.algorithm, c.value]),
      ].some((value) => value.toLowerCase().includes(q)),
  );
  const activeOffset = Math.min(
    offset,
    Math.max(0, Math.ceil(sources.length / pageSize) - 1) * pageSize,
  );
  function sourceRow(row: RecipeSource) {
    return (
      <article key={row.line} className="min-w-0 space-y-3 border-t p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-mono text-xs font-medium break-all">
              {row.name || "Unnamed source"}
            </h4>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span
                className={cn("status", row.kind === "unknown" ? "status-warn" : "status-neutral")}
              >
                {kindLabels[row.kind] ?? "Unknown source"}
              </span>
              <span className="status status-neutral">{row.architecture ?? "Common sources"}</span>
              <span className="status status-neutral">
                {row.transport === "unknown" ? "Unknown transport" : row.transport.toUpperCase()}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={`Copy source line ${row.line}`}
            onClick={() => clipboard(row.declaration)}
          >
            <Copy className="size-3.5" />
          </Button>
        </div>
        <p className="font-mono text-xs leading-6 break-all text-muted-foreground">
          {row.location || "(empty source location)"}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-0 text-xs"
          aria-label={`Inspect source line ${row.line}`}
          onClick={() => jump(row.line)}
        >
          <FileCode2 className="size-3" />
          .SRCINFO:{row.line}
        </Button>
        {row.reference && (
          <div className="rounded-lg border bg-muted/35 p-3">
            <p className="text-xs font-medium">
              {row.reference.fullCommit ? "Full commit reference" : "Mutable or partial reference"}
            </p>
            <p className="mt-1 font-mono text-xs leading-5 break-all">
              {row.reference.kind} · {row.reference.value}
            </p>
          </div>
        )}
        {row.signedCheckout && (
          <p className="text-xs leading-5">
            Signed checkout requested · verification not performed
          </p>
        )}
        {row.signatureFor.length > 0 && (
          <p className="text-xs leading-5 text-muted-foreground">
            Possible signature for source {row.signatureFor.length === 1 ? "line" : "lines"}{" "}
            {row.signatureFor.join(", ")} · not verified
          </p>
        )}
        <details className="rounded-lg border">
          <summary className="cursor-pointer p-3 text-xs font-medium">
            {row.checksums.length
              ? `${row.checksums.length} checksum ${row.checksums.length === 1 ? "declaration" : "declarations"}`
              : "No checksum declared"}
          </summary>
          <div className="space-y-2 border-t p-3">
            {row.checksums.length ? (
              row.checksums.map((check) => (
                <Checksum key={`${check.algorithm}:${check.line}`} check={check} jump={jump} />
              ))
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                No checksum array was captured for this source group. Review the raw metadata and
                other integrity declarations.
              </p>
            )}
          </div>
        </details>
        {row.notes.length > 0 && (
          <ul className="space-y-2">
            {row.notes.map((note) => (
              <li key={note} className="flex gap-2 text-xs leading-5 text-muted-foreground">
                <Info className="mt-1 size-3 shrink-0 text-warning" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </article>
    );
  }
  return (
    <section aria-label="Source declaration evidence" className="min-w-0 space-y-4">
      <SectionTitle
        title="Declared sources"
        description="Read the integrity contract before a build."
      />
      <div className="rounded-lg border bg-muted/35 p-4">
        <div className="flex flex-wrap gap-2">
          <span className={cn("status", evidence.complete ? "status-neutral" : "status-warn")}>
            {evidence.complete ? "Metadata extracted" : "Metadata extraction incomplete"}
          </span>
          <span className="status status-neutral">Source bytes not verified</span>
        </div>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">
          {currentKnown
            ? "Declarations belong to the pinned recipe capture above."
            : "Captured snapshot · the current recipe is unknown."}{" "}
          Checksums, signatures and key fingerprints are declarations. No upstream files were
          downloaded or authenticated.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Captured sources</p>
          <p className="mt-1 font-heading text-2xl">
            {evidence.sources.length}
            {!evidence.complete && (
              <span className="ml-1 text-xs text-muted-foreground">captured</span>
            )}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Signing-key declarations</p>
          <p className="mt-1 font-heading text-2xl">{evidence.signingKeys.length}</p>
        </div>
      </div>
      {evidence.warnings.length > 0 && (
        <details open className="rounded-lg border border-warning/30 bg-warning-bg">
          <summary className="cursor-pointer p-3 text-xs font-medium text-warning">
            Metadata needs review · {evidence.warnings.length} warnings
          </summary>
          <ul className="space-y-2 border-t p-3">
            {evidence.warnings.slice(0, 10).map((warning, index) => (
              <li key={`${index}:${warning}`} className="text-xs leading-5 text-muted-foreground">
                {warning}
              </li>
            ))}
          </ul>
          {evidence.warnings.length > 10 && (
            <p className="px-3 pb-3 text-xs leading-5 text-warning">
              Showing 10 of {evidence.warnings.length} captured warnings. Export the scan for all
              warnings and raw files.
            </p>
          )}
        </details>
      )}
      <div className="overflow-hidden rounded-lg border">
        <div className="space-y-3 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-foreground" />
            <Input
              aria-label="Search source declarations"
              className="pl-9"
              placeholder="Search URLs, names, architectures or checksums…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <Select
            value={filter}
            onValueChange={(value) => {
              setFilter(value);
              setOffset(0);
            }}
          >
            <SelectTrigger aria-label="Filter source declarations" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                ["all", "All declarations"],
                ["review", "Needs review"],
                ["download", "Downloads"],
                ["vcs", "Version control"],
                ["local", "Local files"],
                ["signature", "Detached signatures"],
                ["unknown", "Unknown sources"],
              ].map(([value, label]) => (
                <SelectItem key={value} value={value!}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {sources.length} of {evidence.sources.length} captured sources
          </p>
        </div>
        {sources.length ? (
          sources.slice(activeOffset, activeOffset + pageSize).map(sourceRow)
        ) : (
          <Empty
            title={
              search || filter !== "all"
                ? "No declarations match"
                : "No sources declared in this capture"
            }
            description="This describes captured metadata. Missing or stale declarations can hide sources fetched by the executable recipe."
          />
        )}
        <Pager offset={activeOffset} total={sources.length} name="sources" onChange={setOffset} />
      </div>
      <details className="overflow-hidden rounded-lg border">
        <summary className="cursor-pointer p-4 text-xs font-medium">
          <Fingerprint className="mr-2 inline size-3.5" />
          Signing-key fingerprints · {evidence.signingKeys.length}
        </summary>
        <div className="space-y-3 border-t p-4">
          <p className="text-xs leading-6 text-muted-foreground">
            Key ownership, trust, expiry and revocation were not checked. A declared fingerprint
            does not prove who signed a source.
          </p>
          {evidence.signingKeys.length ? (
            evidence.signingKeys.slice(keyOffset, keyOffset + pageSize).map((key) => (
              <div key={key.line} className="space-y-2 rounded-lg border p-3">
                <span
                  className={cn("status", key.fullFingerprint ? "status-neutral" : "status-warn")}
                >
                  {key.fullFingerprint ? "Full fingerprint declared" : "Unsupported fingerprint"}
                </span>
                <p className="font-mono text-xs leading-5 break-all">
                  {key.value || "(empty value)"}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-0 text-xs"
                  aria-label={`Inspect signing-key line ${key.line}`}
                  onClick={() => jump(key.line)}
                >
                  .SRCINFO:{key.line}
                </Button>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No signing-key fingerprints captured.</p>
          )}
        </div>
        <Pager
          offset={keyOffset}
          total={evidence.signingKeys.length}
          name="signing keys"
          onChange={setKeyOffset}
        />
      </details>
      {evidence.unassignedChecksums.length > 0 && (
        <details className="overflow-hidden rounded-lg border">
          <summary className="cursor-pointer p-4 text-xs font-medium">
            Unassigned checksum values · {evidence.unassignedChecksums.length}
          </summary>
          <div className="space-y-2 border-t p-4">
            <p className="text-xs leading-6 text-muted-foreground">
              These values have no source at the corresponding position in their architecture group.
              No association is asserted.
            </p>
            {evidence.unassignedChecksums
              .slice(orphanOffset, orphanOffset + pageSize)
              .map((check) => (
                <div key={`${check.algorithm}:${check.line}`}>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {check.architecture ?? "Common sources"}
                  </p>
                  <Checksum check={check} jump={jump} />
                </div>
              ))}
          </div>
          <Pager
            offset={orphanOffset}
            total={evidence.unassignedChecksums.length}
            name="unassigned checksums"
            onChange={setOrphanOffset}
          />
        </details>
      )}
      <details className="rounded-lg border">
        <summary className="cursor-pointer p-4 text-xs font-medium">
          Source evidence scope & identity
        </summary>
        <div className="space-y-3 border-t p-4">
          {evidence.limitations.map((limit) => (
            <p key={limit} className="text-xs leading-6 text-muted-foreground">
              {limit}
            </p>
          ))}
          <p className="font-mono text-xs leading-5 break-all text-muted-foreground">
            Analyzer v{evidence.analyzerVersion} · .SRCINFO SHA-256 ·{" "}
            {evidence.metadataDigest ?? "unavailable"}
          </p>
        </div>
      </details>
    </section>
  );
}
