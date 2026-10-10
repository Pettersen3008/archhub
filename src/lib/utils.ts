import { clsx, type ClassValue } from "clsx";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function bytes(value: number) {
  if (!value) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** exponent).toFixed(exponent >= 2 ? 1 : 0)} ${units[exponent]}`;
}
export function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function date(timestamp: number) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    timestamp * 1000,
  );
}
export function safeUrl(value?: string | null) {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export async function openUrl(value: string) {
  const url = safeUrl(value);
  if (!url) throw new Error("This package has no valid website URL.");
  if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
export async function copy(value: string) {
  await navigator.clipboard.writeText(value);
}
export async function downloadJson(name: string, value: unknown) {
  try {
    const content = JSON.stringify(value, null, 2);
    if ("__TAURI_INTERNALS__" in window) {
      const [{ save }, { writeTextFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const path = await save({
        title: "Export ArchHub evidence",
        defaultPath: name,
        filters: [{ name: "JSON evidence", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, content);
    } else {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    toast.success("Evidence exported");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Evidence export failed");
  }
}
