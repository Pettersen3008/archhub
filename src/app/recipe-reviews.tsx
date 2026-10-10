import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, FileCode2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Empty, ErrorState, Loading, PageHeader, SectionTitle } from "@/components/layout/shared";
import RecipeWorkbench from "@/features/packages/recipe-workbench";
import { request } from "@/lib/ipc/client";
import RecipeReviewRow from "@/features/packages/recipe-review-row";

export default function RecipeReviews({ navigate }: { navigate: (page: string) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ base: string; panel: "files" | "changes" } | null>(
    null,
  );
  const open = (base: string, panel: "files" | "changes") => setSelected({ base, panel });
  const reviews = useQuery({
    queryKey: ["recipe-reviews"],
    queryFn: ({ signal }) => request({ command: "recipe_reviews" }, signal),
    retry: false,
  });
  const items =
    reviews.data?.filter((review) =>
      `${review.packageBase} ${review.note}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="RECIPE REVIEW EVIDENCE"
        title="Recipe reviews"
        description="Saved files, commit identities, and personal notes. A baseline for your next review."
      >
        <Button
          size="sm"
          variant="outline"
          disabled={reviews.isFetching}
          onClick={() => void reviews.refetch()}
        >
          <RefreshCw className="size-3.5" />
          Refresh records
        </Button>
        <Button size="sm" onClick={() => navigate("aur")}>
          <FileCode2 className="size-3.5" />
          Inspect an AUR recipe
          <ArrowUpRight className="size-3.5" />
        </Button>
      </PageHeader>
      <p className="mb-4 text-xs text-muted-foreground">
        {reviews.data?.length ?? "…"} saved baselines · Current recipes are checked only when
        requested
      </p>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b p-5">
          <SectionTitle
            title="Your saved evidence"
            description="Stored on this workstation, available across its browser and desktop clients"
          />
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Search recipe reviews"
              placeholder="Package or review note…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {reviews.isPending ? (
          <Loading label="Reading saved recipe evidence…" />
        ) : reviews.isError ? (
          <ErrorState error={reviews.error} retry={() => void reviews.refetch()} />
        ) : items.length ? (
          <div>
            {items.map((review) => (
              <RecipeReviewRow key={review.packageBase} review={review} open={open} />
            ))}
          </div>
        ) : (
          <Empty
            title={
              query ? "No matching review records" : "Your first review starts with the files."
            }
            description={
              query
                ? "Try a different package name or note."
                : "Scan an AUR recipe, inspect its files and findings, then record what you checked. Future scans will compare against those exact bytes."
            }
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => (query ? setQuery("") : navigate("aur"))}
            >
              {query ? "Clear search" : "Browse AUR recipes"}
            </Button>
          </Empty>
        )}
        <p className="border-t bg-muted/35 px-5 py-4 text-xs leading-6 text-muted-foreground">
          A saved review is a personal inspection record. It does not verify installed packages,
          establish that code is benign, or approve a future build or installation. New commits
          require a new review. Check results describe the displayed capture time; recheck for later
          remote changes.
        </p>
      </section>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[700px]">
          <SheetHeader className="border-b px-6 pt-8 pb-6 sm:px-8">
            <p className="eyebrow mb-3">SAVED RECIPE EVIDENCE</p>
            <SheetTitle className="font-heading text-2xl break-all">{selected?.base}</SheetTitle>
            <SheetDescription className="text-xs leading-6">
              Inspect saved files offline, or fetch the current commit to compare changes.
            </SheetDescription>
          </SheetHeader>
          <div className="p-6 sm:p-8">
            {selected && (
              <RecipeWorkbench
                key={`${selected.base}:${selected.panel}`}
                base={selected.base}
                initialPanel={selected.panel}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
