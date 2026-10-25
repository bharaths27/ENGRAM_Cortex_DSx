import { cn } from "@/lib/utils";

/**
 * ENGRAM CORTEX logo, redrawn as vector so it stays sharp and works offline:
 * dashed outer ring (orange), broken inner ring (silver) and an orange core, then the name.
 * Ring shapes are shared with the animated LogoUnlock.
 */
export const LOGO_RINGS = {
  outer: { r: 21, strokeWidth: 2.2, strokeDasharray: "4.2 5.7", stroke: "var(--logo-orange)" },
  inner: { r: 13.5, strokeWidth: 2.2, strokeDasharray: "36 6.4", stroke: "var(--logo-silver)" },
  coreRing: { r: 6.6, strokeWidth: 1.4, stroke: "var(--logo-silver)" },
  core: { r: 5.4, fill: "var(--logo-orange)" },
} as const;

/** Starting angle of the inner ring's gap. */
export const INNER_RING_ANGLE = -62;

export function EngramLogoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} aria-hidden fill="none">
      <g className="logo-spin">
        <circle cx="24" cy="24" {...LOGO_RINGS.outer} strokeLinecap="round" />
      </g>
      <g className="logo-spin-rev">
        <circle
          cx="24"
          cy="24"
          {...LOGO_RINGS.inner}
          strokeLinecap="round"
          transform={`rotate(${INNER_RING_ANGLE} 24 24)`}
        />
      </g>
      <circle cx="24" cy="24" {...LOGO_RINGS.coreRing} />
      <circle cx="24" cy="24" {...LOGO_RINGS.core} />
    </svg>
  );
}

export function EngramLogo({
  className,
  iconClassName,
  showName = true,
}: {
  className?: string;
  iconClassName?: string;
  showName?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <EngramLogoIcon className={cn("size-8", iconClassName)} />
      {showName && (
        <span className="font-sans text-[15px] font-semibold tracking-[0.22em]">
          <span className="text-logo-silver">ENGRAM</span>{" "}
          <span className="text-logo-orange">CORTEX</span>
        </span>
      )}
    </span>
  );
}
