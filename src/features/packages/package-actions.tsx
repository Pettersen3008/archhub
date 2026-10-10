import { useSnapshot } from "./queries";
import { useMaintenance } from "./maintenance-query";
import type { Package } from "@/lib/ipc/bindings";
import TerminalCommand from "@/components/layout/terminal-command";
import RemovalReview from "./removal-plan";

// Single-quote targets even after validation: metadata never becomes shell code.
export function packageCommands(pkg: Package, omarchy: boolean, helper?: string | null) {
  if (!/^[a-zA-Z0-9@._+][a-zA-Z0-9@._+-]{0,199}$/.test(pkg.name)) return {};
  const target = `'${pkg.name}'`;
  const update = omarchy ? "omarchy update" : "sudo pacman -Syu";
  const remove = pkg.installedVersion ? `sudo pacman -R -- ${target}` : undefined;
  const install =
    pkg.repository === "local"
      ? undefined
      : pkg.repository === "aur"
        ? ["yay", "paru"].includes(helper ?? "")
          ? omarchy
            ? `${update} && ${helper} -S -- ${target}`
            : `${helper} -Syu -- ${target}`
          : undefined
        : omarchy
          ? `${update} && sudo pacman -S -- ${target}`
          : `sudo pacman -Syu -- ${target}`;
  return { install, remove };
}

export default function PackageActions({ pkg }: { pkg: Package }) {
  const snapshot = useSnapshot();
  const maintenance = useMaintenance(pkg.repository === "aur");
  if (!snapshot.data || snapshot.isError) return null;
  const commands = packageCommands(pkg, snapshot.data.omarchy, maintenance.data?.aurHelper);
  return (
    <section aria-label="Package actions" className="space-y-3">
      <h2 className="text-sm font-medium">Use your package manager</h2>
      {commands.install && (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            {pkg.repository === "aur"
              ? "Review the build recipe first. This command updates the system and asks your AUR helper to build/install the package."
              : "This command includes a full system update before installing the selected package."}
          </p>
          <TerminalCommand command={commands.install} label={`install command for ${pkg.name}`} />
        </>
      )}
      {pkg.repository === "aur" && !commands.install && (
        <p className="text-xs leading-5 text-muted-foreground">
          Review the build recipe, then use your chosen AUR build workflow. Install commands are
          available when yay or paru is installed.
        </p>
      )}
      {commands.remove && (
        <>
          <RemovalReview
            targets={[{ name: pkg.name, version: pkg.installedVersion! }]}
            label={`Review removal of ${pkg.name}`}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Commands run in your terminal. ArchHub does not execute them.
      </p>
    </section>
  );
}
