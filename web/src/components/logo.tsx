import { cn } from "@/lib/utils";

/**
 * The mark: a blimp cut out of a rounded tile, nose up at 10 degrees, in the
 * button text colour on the brand blue. See brand/blimp-brand-guidelines.pdf.
 */
export function Logo({ className, spinning = false }: { className?: string; spinning?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-[25%] bg-primary text-primary-foreground",
        spinning && "animate-[logo-loading_0.9s_cubic-bezier(0.55,0.12,0.45,0.88)_infinite]",
        className,
      )}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%" fill="currentColor">
        <g transform="translate(11.5 10.5) scale(.77) rotate(-10 50 50)">
          <path d="M97 50 C97 33 78 25 58 25 C36 25 16 40 5 50 C16 60 36 75 58 75 C78 75 97 67 97 50 Z" />
          <path d="M9 27 L25 24 L36 37 L17 45 Z M9 73 L25 76 L36 63 L17 55 Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <rect x="50" y="78" width="22" height="8" rx="4" />
        </g>
      </svg>
    </span>
  );
}
