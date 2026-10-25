import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Cpu, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { RoverCanvas } from "@/components/rover/RoverCanvas";
import { applyPart, useRover } from "@/components/rover/useRover";
import { Reveal } from "@/components/sections/Reveal";
import {
  BUILD_STEPS,
  BUILD_STEP_MS,
  GROUPS,
  clamp01,
  easeOutBack,
  partStepState,
} from "@/lib/rover";

const FLY_SECONDS = 0.9;
const FLY_STAGGER = 0.12;

function BuildRover({ step, reduced }: { step: number; reduced: boolean }) {
  const rover = useRover();
  const changedAt = useRef<number | null>(null);
  const initialised = useRef(false);

  useEffect(() => {
    changedAt.current = null; // captured on next frame
  }, [step]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = state.clock.elapsedTime;
    if (changedAt.current === null) changedAt.current = now;
    const since = now - changedAt.current;

    // Index of each part within its group, for staggering.
    const groupStart: Record<number, number> = {};
    GROUPS.forEach((g, gi) => (groupStart[gi] = rover.parts.findIndex((p) => p.groupIndex === gi)));

    for (const p of rover.parts) {
      const s = partStepState(p.groupIndex, step);
      if (!initialised.current) {
        p.t = 0;
        p.opacity = s === "ghost" ? 0.1 : 1;
      }
      if (s === "adding" && !reduced) {
        const idx = p.order - (groupStart[p.groupIndex] ?? 0);
        const local = clamp01((since - idx * FLY_STAGGER) / FLY_SECONDS);
        p.t = 1 - easeOutBack(local);
        p.opacity = Math.max(0.1, clamp01(local * 2.5));
        p.glow = (1 - local) * 0.7;
      } else {
        p.t = reduced ? 0 : THREE.MathUtils.damp(p.t, 0, 8, dt);
        const target = s === "ghost" ? 0.1 : 1;
        p.opacity = reduced ? target : THREE.MathUtils.damp(p.opacity, target, 6, dt);
        const brain = step >= GROUPS.length;
        const wave =
          brain && !reduced
            ? 0.32 * (0.5 + 0.5 * Math.sin(now * 2.6 - p.order * 0.45))
            : brain
              ? 0.2
              : 0;
        p.glow = THREE.MathUtils.damp(p.glow, wave, 8, dt);
      }
      applyPart(p);
    }
    initialised.current = true;
  });

  return <primitive object={rover.root} />;
}

export function BuildSteps() {
  const reduced = useReducedMotion() ?? false;
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(false);
  const total = BUILD_STEPS.length;
  const current = BUILD_STEPS[step] ?? BUILD_STEPS[0]!;

  useEffect(() => {
    if (!auto) return;
    const id = setTimeout(() => setStep((s) => (s + 1) % total), BUILD_STEP_MS);
    return () => clearTimeout(id);
  }, [auto, step, total]);

  const go = (next: number) => setStep(Math.min(total - 1, Math.max(0, next)));

  return (
    <section
      id="build"
      className="relative -scroll-mt-10 border-t border-border bg-stage-raised/40 py-24 md:py-32"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <Reveal className="mb-10 max-w-2xl">
          <p className="eyebrow mb-4">How we built it</p>
          <h2 className="pb-1 font-display text-4xl font-bold text-foreground tracking-tight md:text-5xl">
            From chassis to brain.
          </h2>
        </Reveal>

        <Reveal className="grid items-stretch gap-5 lg:grid-cols-[1.35fr_1fr]">
          <div className="stage-frame hud-corners">
            <RoverCanvas
              camera={{ position: [-1.4, 1.0, 1.5], fov: 36 }}
              className="h-[52vh] min-h-[400px] lg:h-[62vh]"
            >
              <BuildRover step={step} reduced={reduced} />
              <OrbitControls
                makeDefault
                target={[-0.05, 0.42, 0]}
                enablePan={false}
                enableDamping
                minDistance={1.2}
                maxDistance={3}
                minPolarAngle={0.3}
                maxPolarAngle={1.45}
                autoRotate={!reduced}
                autoRotateSpeed={0.4}
              />
            </RoverCanvas>

            <AnimatePresence>
              {step === total - 1 && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  className="card-stage glow-ring absolute top-4 left-4 flex items-center gap-3 px-4 py-3"
                >
                  <div className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                    <Cpu className="size-5" aria-hidden />
                  </div>
                  <div className="text-sm">
                    <div className="font-semibold">ENGRAM computer</div>
                    <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                      offline
                      <span className="relative inline-flex h-0.5 w-10 overflow-hidden rounded bg-border">
                        <motion.span
                          className="absolute inset-y-0 w-3 rounded bg-brand"
                          animate={reduced ? { x: 14 } : { x: [-12, 40] }}
                          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                        />
                      </span>
                      rover
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="card-stage flex flex-col p-6 md:p-8">
            <div className="flex gap-1.5" aria-hidden>
              {BUILD_STEPS.map((s, i) => (
                <div key={s.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                  {i < step && <div className="h-full w-full bg-brand" />}
                  {i === step && (
                    <motion.div
                      key={`${step}-${auto}`}
                      className="h-full bg-brand"
                      initial={{ width: auto && !reduced ? "0%" : "100%" }}
                      animate={{ width: "100%" }}
                      transition={{
                        duration: auto && !reduced ? BUILD_STEP_MS / 1000 : 0,
                        ease: "linear",
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div
              className="mt-3 font-mono text-xs uppercase tracking-widest text-muted-foreground"
              aria-live="polite"
            >
              Step {step + 1} of {total}
            </div>

            <div className="relative mt-8 min-h-[170px] flex-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.35 }}
                >
                  <h3 className=" font-display text-3xl font-bold md:text-4xl">
                    {current.title}
                  </h3>
                  <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
                    {current.caption}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => go(step - 1)}
                disabled={step === 0}
              >
                <ChevronLeft className="size-4" aria-hidden />
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => go(step + 1)}
                disabled={step === total - 1}
              >
                Next
                <ChevronRight className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className={`btn btn-ghost ml-auto ${auto ? "btn-active" : ""}`}
                onClick={() => setAuto((a) => !a)}
                aria-pressed={auto}
              >
                {auto ? (
                  <Pause className="size-4" aria-hidden />
                ) : (
                  <Play className="size-4" aria-hidden />
                )}
                Auto play
              </button>
            </div>

            <div className="mt-6 flex flex-wrap gap-1.5">
              {BUILD_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(i)}
                  className={`btn btn-ghost min-h-[40px] px-3 text-xs ${i === step ? "btn-active" : ""}`}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
