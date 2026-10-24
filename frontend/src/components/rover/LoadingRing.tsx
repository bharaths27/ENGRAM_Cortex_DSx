import { useProgress } from "@react-three/drei";

/** Small ring with percentage while the ~8 MB model downloads. */
export function LoadingRing({ label = "Loading rover" }: { label?: string }) {
  const { progress } = useProgress();
  const pct = Math.round(progress);
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <svg width="64" height="64" viewBox="0 0 56 56" className="-rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" strokeWidth="4" className="stroke-border" />
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="stroke-brand transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <div className="font-mono text-xs tracking-widest text-muted-foreground whitespace-nowrap">
        {label} · {pct}%
      </div>
    </div>
  );
}
