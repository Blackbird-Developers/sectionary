"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A popup over the page on the browser's own <dialog>: showModal() gives the
 * dimmed backdrop, keeps focus inside, makes the page behind inert and closes
 * on Escape, with no library. `onClose` runs for Escape, the close button and
 * a click on the backdrop; set `dismissable={false}` for a popup that only
 * its own buttons may close.
 */
export function Dialog({
  open,
  onClose,
  label,
  dismissable = true,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The accessible name, when no visible heading names the popup. */
  label?: string;
  dismissable?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(e) => {
        // Escape: React decides whether it closes, so `open` stays the truth.
        e.preventDefault();
        if (dismissable) closeRef.current();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself, outside its box.
        if (!dismissable || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) closeRef.current();
      }}
      className={cn(
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl border bg-background p-0 text-foreground shadow-2xl outline-none",
        "backdrop:bg-black/50 backdrop:backdrop-blur-[2px]",
        "dialog-in",
        className,
      )}
    >
      {open && (
        <>
          {dismissable && (
            <button
              type="button"
              onClick={() => closeRef.current()}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring touch:size-11"
            >
              <X className="size-4" />
            </button>
          )}
          {children}
        </>
      )}
    </dialog>
  );
}
