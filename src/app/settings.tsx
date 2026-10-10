import { Monitor, Moon, Sun, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/layout/shared";
import { useSnapshot } from "@/features/packages/queries";
import { cn, copy, openUrl } from "@/lib/utils";
import { toast } from "sonner";
export type Preferences = { theme: "light" | "dark" | "system"; compact: boolean };
export default function Settings({
  preferences,
  setPreferences,
}: {
  preferences: Preferences;
  setPreferences: (value: Preferences) => void;
}) {
  const snapshot = useSnapshot();
  return (
    <div className="animate-in-soft">
      <PageHeader
        label="SETTINGS"
        title="Settings"
        description="Appearance, local data and repository policy."
      />
      <div className="max-w-3xl space-y-5">
        <section className="panel divide-y">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <h2 className="text-sm font-medium">Appearance</h2>
              <p className="mt-1 text-xs text-muted-foreground">Choose your workspace theme.</p>
            </div>
            <div className="flex gap-1 rounded-md bg-muted p-1">
              {(
                [
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "system", label: "System", icon: Monitor },
                ] as const
              ).map((theme) => (
                <Button
                  key={theme.value}
                  size="sm"
                  variant={preferences.theme === theme.value ? "outline" : "ghost"}
                  aria-pressed={preferences.theme === theme.value}
                  onClick={() => setPreferences({ ...preferences, theme: theme.value })}
                  className={cn("text-xs", preferences.theme === theme.value && "bg-card")}
                >
                  <theme.icon className="size-3.5" />
                  {theme.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 p-5">
            <div>
              <label htmlFor="compact" className="text-sm font-medium">
                Compact package rows
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Fit more packages into the list.</p>
            </div>
            <Switch
              id="compact"
              checked={preferences.compact}
              onCheckedChange={(compact) => setPreferences({ ...preferences, compact })}
            />
          </div>
        </section>
        <details className="evidence-disclosure">
          <summary>Configured repositories</summary>
          <div className="divide-y">
            {snapshot.data?.repositories.map((repo) => (
              <div
                key={repo.name}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="text-xs font-medium">{repo.name}</span>
                <div className="flex flex-wrap gap-2">
                  {repo.signaturePolicy.map((policy) => (
                    <span key={policy} className="font-mono text-xs text-muted-foreground">
                      {policy}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="border-t p-4 text-xs leading-5 text-muted-foreground">
            Effective policy from pacman-conf, including repository overrides. These settings are
            read-only.
          </p>
        </details>
        <details className="evidence-disclosure">
          <summary>Data & permissions</summary>
          <div className="space-y-4 p-4 text-xs leading-6 text-muted-foreground">
            <p>
              Inventory and history stay on this machine. AUR searches and recipes use
              aur.archlinux.org. Advisory checks fetch the public Arch Security Tracker feed and
              match installed names locally.
            </p>
            <p>
              Preferences and saved package identifiers stay in this browser or desktop client.
              Recipe notes and captured files are stored on the workstation and shared between its
              clients. Export or remove them under Security → Recipe reviews.
            </p>
            <p>
              No telemetry, accounts or package mutation. Your system updater applies package
              changes.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void openUrl("https://wiki.archlinux.org/title/Security").catch((error) =>
                    toast.error(String(error)),
                  )
                }
              >
                Arch security documentation
                <ExternalLink className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!snapshot.data}
                onClick={() =>
                  void copy(snapshot.data!.fingerprint)
                    .then(() => toast.success("Inventory fingerprint copied"))
                    .catch(() => toast.error("Clipboard unavailable"))
                }
              >
                <Copy className="size-3" />
                Copy state fingerprint
              </Button>
            </div>
          </div>
        </details>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span>
            <kbd className="rounded border px-1.5 py-0.5 font-mono">Ctrl / ⌘ K</kbd> Search &
            navigate
          </span>
          <span>
            <kbd className="rounded border px-1.5 py-0.5 font-mono">Esc</kbd> Close details
          </span>
        </div>
      </div>
    </div>
  );
}
