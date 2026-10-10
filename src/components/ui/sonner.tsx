import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--normal-bg-hover": "var(--muted)",
          "--normal-border-hover": "var(--input)",
          "--gray2": "var(--muted)",
          "--gray5": "var(--input)",
          "--border-radius": "var(--radius)",
          fontFamily: "var(--font-sans)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-destructive",
          warning: "[&_[data-icon]]:text-warning",
          info: "[&_[data-icon]]:text-primary",
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}
