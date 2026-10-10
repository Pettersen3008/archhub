import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copy } from "@/lib/utils";

export default function TerminalCommand({ command, label }: { command: string; label: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-md border bg-muted/30 p-3">
      <code className="min-w-0 flex-1 text-xs leading-6 break-all whitespace-pre-wrap">
        {command}
      </code>
      <Button
        variant="outline"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={() =>
          void copy(command)
            .then(() => toast.success("Command copied — run it in your terminal"))
            .catch((error) =>
              toast.error(error instanceof Error ? error.message : "Could not copy command"),
            )
        }
      >
        <Copy className="size-3.5" />
        Copy
      </Button>
    </div>
  );
}
