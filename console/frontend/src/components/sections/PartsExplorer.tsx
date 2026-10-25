import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  MousePointerClick,
  MoveDiagonal,
  Tags,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { PartLabels } from "@/components/rover/PartLabels";
import { useCanHover } from "@/hooks/use-can-hover";
import { RoverCanvas } from "@/components/rover/RoverCanvas";
import { applyPart, partNameFromHit, useRover, useRoverBvh } from "@/components/rover/useRover";
import { Reveal } from "@/components/sections/Reveal";
import {
  BRAIN_ID,
  GROUPS,
  INFO_ORDER,
  PART_ORDER,
  clamp01,
  displayName,
  easeInOutCubic,
  highlightPartFor,
  partInfo,
  stepInfo,
  type GroupId,
  type InfoGroupLabel,
} from "@/lib/rover";

const DEFAULT_TARGET = new THREE.Vector3(-0.05, 0.4, 0);
const DEFAULT_DISTANCE = 2.1;
const FOCUS_DISTANCE = 1.05;
const FOCUS_SECONDS = 0.8;
const CLICK_MAX_PX = 6;
const EXPLODE_SECONDS = 1.8;
const HOVER_GLOW = 0.3;

export const GROUP_DOT: Record<GroupId, string> = {
  base: "bg-group-base",
  body: "bg-group-body",
  arm: "bg-group-arm",
  hand: "bg-group-hand",
  sensor: "bg-group-sensor",
};

const LABEL_DOT: Record<InfoGroupLabel, string> = {
  Base: "bg-group-base",
  Body: "bg-group-body",
  Arm: "bg-group-arm",
  Hand: "bg-group-hand",
  Sensor: "bg-group-sensor",
  Brain: "bg-group-brain",
};

/**
 * Eases the orbit target + camera toward the selected part over 0.8 s. On wide views the
 * part is nudged left so the info card on the right does not hide it.
 */
function CameraFocus({ focus, reduced }: { focus: THREE.Vector3 | null; reduced: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const anim = useRef<{
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    elapsed: number;
  } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!controls) return;
    if (first.current && !focus) {
      first.current = false;
      return;
    }
    first.current = false;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const toTarget = (focus ?? DEFAULT_TARGET).clone();
    if (focus && size.width >= 640) {
      const right = dir.clone().negate().cross(camera.up).normalize();
      const halfWidth =
        Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
        FOCUS_DISTANCE *
        (size.width / size.height);
      toTarget.addScaledVector(right, halfWidth * 0.38);
    }
    const toPos = toTarget
      .clone()
      .add(dir.multiplyScalar(focus ? FOCUS_DISTANCE : DEFAULT_DISTANCE));
    anim.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
      elapsed: reduced ? FOCUS_SECONDS : 0,
    };
    // Size changes alone should not re-trigger the move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, controls, camera, reduced]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.elapsed = Math.min(FOCUS_SECONDS, a.elapsed + Math.min(delta, 0.05));
    const k = easeInOutCubic(a.elapsed / FOCUS_SECONDS);
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
    controls.update();
    if (a.elapsed >= FOCUS_SECONDS) anim.current = null;
  });

  return null;
}

/** 0 -> 1 -> hold -> 0 over EXPLODE_SECONDS. */
function explodeCurve(p: number) {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.35) return easeInOutCubic(p / 0.35);
  if (p < 0.65) return 1;
  return easeInOutCubic(1 - (p - 0.65) / 0.35);
}

interface ExplorerProps {
  canHover: boolean;
  hovered: string | null;
  preview: string | null;
  focusPart: string | null;
  group: GroupId | null;
  showAll: boolean;
  explode: { name: string; id: number } | null;
  reduced: boolean;
  portal: React.RefObject<HTMLDivElement | null>;
  onHover: (name: string) => void;
  onUnhover: (name: string) => void;
  onPartClick: (name: string) => void;
  onLabelOpen: (name: string) => void;
}

function ExplorerRover(props: ExplorerProps) {
  const { canHover, hovered, preview, focusPart, group, showAll, explode, reduced } = props;
  const rover = useRover();
  // Hover picking needs fast raycasts; touch devices only raycast on tap.
  useRoverBvh(rover, canHover);
  const raycaster = useThree((s) => s.raycaster) as THREE.Raycaster & { firstHitOnly?: boolean };
  const explodeStart = useRef<{ id: number; at: number | null }>({ id: -1, at: null });

  useEffect(() => {
    raycaster.firstHitOnly = true;
  }, [raycaster]);

  const focus = focusPart ? (rover.byName.get(focusPart)?.center ?? null) : null;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const time = state.clock.elapsedTime;
    if (explode && explodeStart.current.id !== explode.id)
      explodeStart.current = { id: explode.id, at: time };

    for (const p of rover.parts) {
      const dim = focusPart ? p.name !== focusPart : group ? p.group !== group : false;
      const targetOpacity = dim ? 0.25 : 1;
      const lit = p.name === hovered || p.name === preview;
      const targetGlow =
        p.name === focusPart ? 0.55 + 0.18 * Math.sin(time * 3) : lit ? HOVER_GLOW : 0;

      if (explode && p.name === explode.name && explodeStart.current.at !== null) {
        const prog = clamp01((time - explodeStart.current.at) / (reduced ? 0.01 : EXPLODE_SECONDS));
        p.t = reduced ? 0 : explodeCurve(prog);
      } else {
        p.t = THREE.MathUtils.damp(p.t, 0, 8, dt);
      }
      p.opacity = reduced ? targetOpacity : THREE.MathUtils.damp(p.opacity, targetOpacity, 8, dt);
      // Hover glow appears/disappears right away; the selection glow eases.
      p.glow =
        lit && p.name !== focusPart ? targetGlow : THREE.MathUtils.damp(p.glow, targetGlow, 12, dt);
      if (!lit && p.name !== focusPart && p.glow < 0.02) p.glow = 0;
      applyPart(p);
    }
  });

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    // Dragging to rotate: no hover.
    if (e.nativeEvent.buttons !== 0) return;
    e.stopPropagation(); // only the closest part reacts
    const name = partNameFromHit(e.object);
    if (name && name !== hovered) props.onHover(name);
  };

  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    const name = partNameFromHit(e.object);
    if (name) props.onUnhover(name);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta >= CLICK_MAX_PX) return; // a drag, not a click
    e.stopPropagation();
    const name = partNameFromHit(e.object);
    if (name) props.onPartClick(name);
  };

  // With a card open only the selected (and hovered) part keeps its label.
  const labelNames =
    showAll && !focusPart
      ? PART_ORDER
      : Array.from(new Set([focusPart, preview, hovered].filter((n): n is string => !!n)));

  return (
    <>
      <primitive
        object={rover.root}
        onClick={onClick}
        {...(canHover ? { onPointerMove, onPointerOut } : {})}
      />
      <PartLabels
        rover={rover}
        names={labelNames}
        layout={showAll && !focusPart ? "callout" : "near"}
        portal={props.portal}
        onOpen={props.onLabelOpen}
      />
      <CameraFocus focus={focus} reduced={reduced} />
    </>
  );
}

function InfoCard({
  id,
  onClose,
  onStep,
  onExplode,
}: {
  id: string;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  onExplode: () => void;
}) {
  const info = partInfo(id);
  const index = INFO_ORDER.indexOf(id) + 1;
  return (
    <motion.aside
      key="info-card"
      initial={{ x: "110%" }}
      animate={{ x: 0 }}
      exit={{ x: "110%" }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="card-stage glow-ring absolute top-3 right-3 bottom-3 z-40 bg-popover flex w-[min(360px,calc(100%-24px))] flex-col overflow-y-auto p-5"
      aria-label={`${info.title} details`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex min-h-[32px] items-center gap-2 rounded-full border border-border bg-secondary px-3 font-mono text-xs uppercase tracking-widest text-foreground">
          <span className={`size-2 rounded-full ${LABEL_DOT[info.group]}`} aria-hidden />
          {info.group}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-icon -mt-1 -mr-1"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="mt-4 flex-1"
        >
          <div className="font-mono text-xs text-muted-foreground">
            {String(index).padStart(2, "0")} / {INFO_ORDER.length}
          </div>
          <h3 className="mt-1 font-display text-2xl font-bold leading-tight">{info.title}</h3>

          <div className="mt-5">
            <div className="eyebrow text-[11px]">What it is</div>
            <p className="mt-1.5 leading-relaxed text-foreground/90">{info.what}</p>
          </div>
          {info.does && (
            <div className="mt-4">
              <div className="eyebrow text-[11px]">What it does in our robot</div>
              <p className="mt-1.5 leading-relaxed text-muted-foreground">{info.does}</p>
            </div>
          )}

          {id !== BRAIN_ID && (
            <button
              type="button"
              className="btn btn-ghost mt-5 min-h-[44px] px-4 text-sm"
              onClick={onExplode}
            >
              <MoveDiagonal className="size-4" aria-hidden />
              Explode this part
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="mt-6 flex items-center justify-between gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="btn btn-ghost px-4"
          onClick={() => onStep(-1)}
          aria-label="Previous part"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Prev
        </button>
        <button
          type="button"
          className="btn btn-ghost px-4"
          onClick={() => onStep(1)}
          aria-label="Next part"
        >
          Next
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </motion.aside>
  );
}

export function PartsExplorer() {
  const reduced = useReducedMotion() ?? false;
  const canHover = useCanHover();
  const portal = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null); // card open (part id or Brain)
  const [preview, setPreview] = useState<string | null>(null); // touch: first tap
  const [hovered, setHovered] = useState<string | null>(null); // mouse hover
  const [group, setGroup] = useState<GroupId | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [explode, setExplode] = useState<{ name: string; id: number } | null>(null);

  const focusPart = selected ? highlightPartFor(selected) : null;

  const open = useCallback((id: string) => {
    setSelected(id);
    setPreview(null);
  }, []);

  const clearAll = useCallback(() => {
    setSelected(null);
    setPreview(null);
    setHovered(null);
  }, []);

  const onPartClick = (name: string) => {
    if (canHover) return open(name);
    // Touch: first tap previews, second tap (or tapping the label) opens the card.
    if (name === preview || name === focusPart) return open(name);
    setPreview(name);
  };

  const onHover = useCallback((name: string) => setHovered(name), []);
  const onUnhover = useCallback(
    (name: string) => setHovered((cur) => (cur === name ? null : cur)),
    [],
  );

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
      if (e.key === "ArrowRight") setSelected((s) => (s ? stepInfo(s, 1) : s));
      if (e.key === "ArrowLeft") setSelected((s) => (s ? stepInfo(s, -1) : s));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const hint = canHover
    ? "Hover a part to name it. Click for details."
    : "Tap a part to name it. Tap again for details.";

  return (
    <section id="parts" className="relative scroll-mt-16 py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <Reveal className="mb-10 max-w-2xl">
          <p className="eyebrow eyebrow-line mb-4">02 · Parts explorer</p>
          <h2 className="text-metal pb-1 font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            Seventeen parts, five groups.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Point at any part of the rover to see what it is and what it does.
          </p>
        </Reveal>

        <Reveal className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
          <div className={`stage-frame ${hovered ? "cursor-pointer" : ""}`}>
            <RoverCanvas
              camera={{ position: [-1.35, 0.95, 1.45], fov: 36 }}
              className="h-[58vh] min-h-[440px] lg:h-[68vh]"
              onPointerMissed={clearAll}
            >
              <ExplorerRover
                canHover={canHover}
                hovered={hovered}
                preview={preview}
                focusPart={focusPart}
                group={group}
                showAll={showAll}
                explode={explode}
                reduced={reduced}
                portal={portal}
                onHover={onHover}
                onUnhover={onUnhover}
                onPartClick={onPartClick}
                onLabelOpen={open}
              />
              <OrbitControls
                makeDefault
                target={DEFAULT_TARGET}
                enablePan={false}
                enableDamping
                minDistance={0.6}
                maxDistance={3}
                minPolarAngle={0.3}
                maxPolarAngle={1.5}
              />
            </RoverCanvas>

            {/* Floating part labels render here (drei <Html> portal). */}
            <div
              ref={portal}
              className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
            />

            <div className="absolute top-3 left-3 z-30 flex flex-wrap gap-2">
              <button
                type="button"
                className={`btn btn-ghost ${showAll ? "btn-active" : ""}`}
                onClick={() => setShowAll((v) => !v)}
                aria-pressed={showAll}
              >
                <Tags className="size-4" aria-hidden />
                Show all labels
              </button>
              {(selected || group || preview) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    clearAll();
                    setGroup(null);
                  }}
                >
                  <Eye className="size-4" aria-hidden />
                  Show all
                </button>
              )}
            </div>

            <AnimatePresence>
              {!selected && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="card-stage pointer-events-none absolute bottom-3 left-3 z-30 inline-flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"
                >
                  <MousePointerClick className="size-4 text-brand" aria-hidden />
                  {hint}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {selected && (
                <InfoCard
                  id={selected}
                  onClose={() => setSelected(null)}
                  onStep={(dir) => setSelected((s) => (s ? stepInfo(s, dir) : s))}
                  onExplode={() => setExplode({ name: highlightPartFor(selected), id: Date.now() })}
                />
              )}
            </AnimatePresence>
          </div>

          <div className="card-stage flex flex-col p-4 lg:max-h-[68vh]">
            <div className="flex flex-wrap gap-2 pb-4" role="group" aria-label="Filter by group">
              <button
                type="button"
                className={`btn btn-ghost px-4 ${!group ? "btn-active" : ""}`}
                onClick={() => {
                  setGroup(null);
                  setSelected(null);
                }}
              >
                All
              </button>
              {GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`btn btn-ghost px-4 ${group === g.id ? "btn-active" : ""}`}
                  onClick={() => {
                    setGroup(group === g.id ? null : g.id);
                    setSelected(null);
                  }}
                >
                  <span className={`size-2 rounded-full ${GROUP_DOT[g.id]}`} aria-hidden />
                  {g.label}
                </button>
              ))}
            </div>
            <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
              {GROUPS.filter((g) => !group || g.id === group).map((g) => (
                <div key={g.id}>
                  <div className="mb-1 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span className={`size-2 rounded-full ${GROUP_DOT[g.id]}`} aria-hidden />
                    {g.label}
                    <span className="opacity-60">· {g.parts.length}</span>
                  </div>
                  <ul>
                    {g.parts.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          className="part-row"
                          data-active={selected === name}
                          aria-pressed={selected === name}
                          onClick={() => open(name)}
                          onMouseEnter={() => canHover && setHovered(name)}
                          onMouseLeave={() =>
                            canHover && setHovered((cur) => (cur === name ? null : cur))
                          }
                        >
                          <span className="w-6 font-mono text-xs opacity-60">
                            {name.slice(0, 2)}
                          </span>
                          <span className="font-medium">{displayName(name)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {!group && (
                <div>
                  <div className="mb-1 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span className="size-2 rounded-full bg-group-brain" aria-hidden />
                    Brain
                  </div>
                  <button
                    type="button"
                    className="part-row"
                    data-active={selected === BRAIN_ID}
                    aria-pressed={selected === BRAIN_ID}
                    onClick={() => open(BRAIN_ID)}
                  >
                    <span className="w-6 font-mono text-xs opacity-60">Pi</span>
                    <span className="font-medium">Raspberry Pi 5</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      in the rear enclosure
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
