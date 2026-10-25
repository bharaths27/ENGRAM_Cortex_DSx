import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { Pause, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Reveal } from "@/components/sections/Reveal";
import { LOOP_NODES, PLANNER_CALLS_EXAMPLE } from "@/lib/rover";

const CX = 240;
const CY = 230;
const R = 150;
const DWELL = 1.1; // seconds resting on each node
const TRAVEL = 1.2; // seconds moving to the next node
const N = LOOP_NODES.length;

const angleOf = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

function LoopDiagram() {
  const reduced = useReducedMotion() ?? false;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const pos = useMotionValue(0); // continuous position around the loop, 0..N
  const clock = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });

  useEffect(() => {
    if (reduced) setPaused(true);
  }, [reduced]);

  useAnimationFrame((_, delta) => {
    const dt = Math.min(delta / 1000, 0.25);
    if (paused || !inView) {
      // Ease the dot onto the active node.
      const cur = pos.get();
      let diff = active - cur;
      if (diff > N / 2) diff -= N;
      if (diff < -N / 2) diff += N;
      pos.set(reduced ? active : (cur + diff * Math.min(1, dt * 8) + N) % N);
      return;
    }
    clock.current += dt;
    const seg = DWELL + TRAVEL;
    const total = clock.current % (seg * N);
    const i = Math.floor(total / seg);
    const within = total - i * seg;
    const move = within < DWELL ? 0 : (within - DWELL) / TRAVEL;
    const eased = move < 0.5 ? 2 * move * move : 1 - Math.pow(-2 * move + 2, 2) / 2;
    pos.set((i + eased) % N);
    const shown = move > 0.5 ? (i + 1) % N : i;
    if (shown !== active) setActive(shown);
  });

  const dotX = useTransform(pos, (p) => CX + R * Math.cos(angleOf(p)));
  const dotY = useTransform(pos, (p) => CY + R * Math.sin(angleOf(p)));

  const pick = (i: number) => {
    setPaused(true);
    setActive(i);
  };

  const resume = () => {
    const seg = DWELL + TRAVEL;
    clock.current = active * seg;
    setPaused(false);
  };

  return (
    <div ref={ref} className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
      <svg
        viewBox="0 0 480 470"
        className="mx-auto w-full max-w-[520px]"
        role="group"
        aria-label="ENGRAM loop"
      >
        <defs>
          <filter id="dot-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={CX} cy={CY} r={R} fill="none" className="stroke-border" strokeWidth="2" />
        <motion.circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          className="stroke-brand/40"
          strokeWidth="2"
          strokeDasharray="4 10"
          animate={reduced ? { strokeDashoffset: 0 } : { strokeDashoffset: [0, -56] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
        {LOOP_NODES.map((node, i) => {
          const a = angleOf(i);
          const x = CX + R * Math.cos(a);
          const y = CY + R * Math.sin(a);
          const lx = CX + (R + 50) * Math.cos(a);
          const ly = CY + (R + 50) * Math.sin(a);
          const isActive = i === active;
          return (
            <g
              key={node.title}
              role="button"
              tabIndex={0}
              aria-label={`${i + 1}. ${node.title}`}
              aria-pressed={isActive}
              className="cursor-pointer outline-none"
              onClick={() => pick(i)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && pick(i)}
            >
              <circle cx={x} cy={y} r={36} fill="transparent" />
              <motion.circle
                cx={x}
                cy={y}
                r={26}
                className={isActive ? "fill-brand-soft stroke-brand" : "fill-stage stroke-border"}
                strokeWidth={2}
                animate={{ scale: isActive ? 1.12 : 1 }}
                style={{ transformOrigin: `${x}px ${y}px` }}
              />
              <text
                x={x}
                y={y + 5}
                textAnchor="middle"
                className={`font-mono text-[15px] font-bold ${isActive ? "fill-brand" : "fill-muted-foreground"}`}
              >
                {i + 1}
              </text>
              <text
                x={lx}
                y={ly + 5}
                textAnchor="middle"
                className={`text-[15px] font-semibold ${isActive ? "fill-foreground" : "fill-muted-foreground"}`}
              >
                {node.title}
              </text>
            </g>
          );
        })}
        <motion.circle cx={dotX} cy={dotY} r={8} className="fill-brand" filter="url(#dot-glow)" />
        <text
          x={CX}
          y={CY - 6}
          textAnchor="middle"
          className="fill-foreground font-display text-[26px] font-bold"
        >
          ENGRAM
        </text>
        <text
          x={CX}
          y={CY + 20}
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-[11px] tracking-[0.2em]"
        >
          MEMORY LOOP
        </text>
      </svg>

      <div className="card-stage p-6 md:p-8">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Step {active + 1} of {N}
          </span>
          <button
            type="button"
            className={`btn btn-ghost ${paused ? "btn-active" : ""}`}
            onClick={paused ? resume : () => setPaused(true)}
          >
            {paused ? (
              <Play className="size-4" aria-hidden />
            ) : (
              <Pause className="size-4" aria-hidden />
            )}
            {paused ? "Play loop" : "Pause"}
          </button>
        </div>
        <div className="mt-6 min-h-[150px]" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <h3 className="font-display text-3xl font-bold">{LOOP_NODES[active]?.title}</h3>
              <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
                {LOOP_NODES[active]?.text}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
        <p className="mt-4 text-sm text-muted-foreground/80">
          Tap any step on the loop to pause and read it.
        </p>
      </div>
    </div>
  );
}

const RUNS = [
  { label: "Run 1", lines: ["find cup", "grasp", "place on tray"] },
  { label: "Run 2", lines: ["find cup", "grasp", "place on tray"] },
  { label: "Run 3", lines: ["find mug", "grasp", "place on tray"] },
  { label: "Run 4", lines: ["find cup", "grasp", "place on tray"] },
];
const SPREAD = ["14%", "38%", "62%", "86%"];

function Dreaming() {
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [phase, setPhase] = useState<0 | 1 | 2>(0); // spread, gather, merged

  useEffect(() => {
    if (reduced) {
      setPhase(2);
      return;
    }
    if (!inView) return;
    const durations = [1800, 900, 2600];
    const id = setTimeout(() => setPhase((p) => ((p + 1) % 3) as 0 | 1 | 2), durations[phase]);
    return () => clearTimeout(id);
  }, [phase, inView, reduced]);

  return (
    <div ref={ref} className="card-stage p-6 md:p-8">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-brand" aria-hidden />
        <h3 className="font-display text-2xl font-bold">Dreaming</h3>
      </div>
      <div className="relative mt-6 h-48 overflow-hidden rounded-2xl border border-border bg-stage/60 bg-blueprint">
        {RUNS.map((run, i) => (
          <motion.div
            key={run.label}
            className="absolute top-1/2 w-[22%] min-w-[96px] rounded-xl border border-border bg-stage-raised p-3 shadow-lg"
            initial={false}
            animate={{
              left: phase === 0 ? (SPREAD[i] ?? "50%") : "50%",
              x: "-50%",
              y: phase === 0 ? "-50%" : `calc(-50% + ${(i - 1.5) * 5}px)`,
              rotate: phase === 0 ? (i - 1.5) * 3 : (i - 1.5) * 1.5,
              opacity: phase === 2 ? 0 : 1,
              scale: phase === 2 ? 0.85 : 1,
            }}
            transition={{
              duration: 0.8,
              ease: [0.22, 1, 0.36, 1],
              delay: phase === 1 ? i * 0.05 : 0,
            }}
          >
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {run.label}
            </div>
            <div className="mt-2 space-y-1">
              {run.lines.map((l) => (
                <div key={l} className="truncate text-xs text-foreground/80">
                  {l}
                </div>
              ))}
            </div>
          </motion.div>
        ))}
        <motion.div
          className="card-stage glow-ring absolute top-1/2 left-1/2 w-[44%] min-w-[180px] p-4"
          initial={false}
          animate={{
            x: "-50%",
            y: "-50%",
            opacity: phase === 2 ? 1 : 0,
            scale: phase === 2 ? 1 : 0.7,
          }}
          transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <div className="font-mono text-[10px] uppercase tracking-widest text-brand">
            Learned skill
          </div>
          <div className="mt-1 font-semibold">Put cup on tray</div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">0 planner calls</div>
        </motion.div>
      </div>
      <p className="mt-5 leading-relaxed text-muted-foreground">
        After runs, ENGRAM compiles repeated plans into skills. Next time it reuses the skill and
        needs zero planner calls. The AI model's files never change.
      </p>
    </div>
  );
}

function PlannerChart() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const max = Math.max(...PLANNER_CALLS_EXAMPLE);

  return (
    <div ref={ref} className="card-stage flex flex-col p-6 md:p-8">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-2xl font-bold">Planner calls per run</h3>
        <span className="shrink-0 rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Example
        </span>
      </div>
      <div className="mt-6 flex h-48 flex-1 items-end gap-3 sm:gap-5">
        {PLANNER_CALLS_EXAMPLE.map((v, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <motion.span
              className={`font-mono text-sm font-bold ${v === 0 ? "text-brand" : "text-foreground"}`}
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ delay: 0.3 + i * 0.15 }}
            >
              {v}
            </motion.span>
            <motion.div
              className={`w-full rounded-t-lg ${v === 0 ? "bg-brand" : "bg-muted-foreground/40"}`}
              initial={{ height: 0 }}
              animate={inView ? { height: v === 0 ? 4 : `${(v / max) * 100}%` } : {}}
              transition={{ duration: 0.7, delay: 0.2 + i * 0.15, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 border-t border-border pt-2 sm:gap-5">
        {PLANNER_CALLS_EXAMPLE.map((_, i) => (
          <div key={i} className="flex-1 text-center font-mono text-[11px] text-muted-foreground">
            Run {i + 1}
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Illustrative example, not live data. Once a skill is learned, the planner is skipped.
      </p>
    </div>
  );
}

export function EngramLoop() {
  return (
    <section id="engram" className="relative scroll-mt-16 border-t border-border py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <Reveal className="mb-12 max-w-2xl">
          <p className="eyebrow eyebrow-line mb-4">04 · How ENGRAM works</p>
          <h2 className="text-metal pb-1 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            It remembers. It never retrains.
          </h2>
        </Reveal>
        <Reveal>
          <LoopDiagram />
        </Reveal>
        <div className="mt-16 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <Dreaming />
          </Reveal>
          <Reveal delay={0.1} className="flex">
            <PlannerChart />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
