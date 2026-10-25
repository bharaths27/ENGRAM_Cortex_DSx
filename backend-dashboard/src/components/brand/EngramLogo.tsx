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

export function EngramLogoIcon({ className, animate = false }: { className?: string; animate?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" className={cn("shrink-0", className)} aria-hidden fill="none">
      {animate && (
        <style>{`
          @keyframes engram-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .engram-r1 { animation: engram-spin 8s linear infinite; transform-origin: 24px 24px; }
          .engram-r2 { animation: engram-spin 6s linear infinite reverse; transform-origin: 24px 24px; }
          .engram-r3 { animation: engram-spin 12s linear infinite; transform-origin: 24px 24px; }
        `}</style>
      )}
      <circle cx="24" cy="24" {...LOGO_RINGS.outer} strokeLinecap="round"
        className={animate ? "engram-r1" : undefined} />
      <circle cx="24" cy="24" {...LOGO_RINGS.inner} strokeLinecap="round"
        transform={animate ? undefined : `rotate(${INNER_RING_ANGLE} 24 24)`}
        className={animate ? "engram-r2" : undefined} />
      <circle cx="24" cy="24" {...LOGO_RINGS.coreRing}
        className={animate ? "engram-r3" : undefined} />
      <circle cx="24" cy="24" {...LOGO_RINGS.core} />
    </svg>
  );
}

export function EngramLogo({
  className,
  iconClassName,
  showName = true,
  animate = false,
}: {
  className?: string;
  iconClassName?: string;
  showName?: boolean;
  animate?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <EngramLogoIcon className={cn("size-8", iconClassName)} animate={animate} />
      {showName && (
        <span className="font-sans text-[15px] font-semibold tracking-[0.22em]">
          <span className="text-logo-silver">ENGRAM</span>{" "}
          <span className="text-logo-orange">CORTEX</span>
        </span>
      )}
    </span>
  );
}
