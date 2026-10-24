import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useNavigate } from "@tanstack/react-router";
import { animate, motion, useReducedMotion, type AnimationPlaybackControls } from "framer-motion";
import { ArrowRight, ChevronDown, MousePointerClick } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { LogoUnlock, UNLOCK_SECONDS } from "@/components/brand/LogoUnlock";
import { PartLabels } from "@/components/rover/PartLabels";
import { RoverCanvas } from "@/components/rover/RoverCanvas";
import { applyPart, partNameFromHit, useRover, useRoverBvh } from "@/components/rover/useRover";
import { useCanHover } from "@/hooks/use-can-hover";
import { BRAIN_HOST_PART, clamp01, easeInOutCubic, easeOutBack } from "@/lib/rover";

// ----- Intro (put-together) timing: unchanged -----
const INTRO_TOTAL = 2.5;
const PART_DURATION = 0.9;
const STAGGER = (INTRO_TOTAL - PART_DURATION) / 16;

// Aim sits right of the rover (and the camera moved with it) so the rover reads further left
// without a bigger view shift, which would push the floor reflection past its edge.
const TARGET: [number, number, number] = [-0.1, 0.42, 0.065];
/** Share of the width the image is shifted left on wide screens (rover sits on the left). */
const VIEW_SHIFT = 0.2;
const HOVER_GLOW = 0.3;
const CLICK_MAX_PX = 6;

// ----- "Next" dive: orbit to the back of the computer enclosure, then zoom into black -----
const DIVE_ORBIT = 1.1;
const DIVE_ZOOM = 0.95;
const DIVE_TOTAL = DIVE_ORBIT + DIVE_ZOOM;
const BLACKOUT_SECONDS = 0.7; // black screen fades in over the end of the zoom
/** Camera position behind the rover (rear = +x), relative to the enclosure. */
const BACK_VIEW = new THREE.Spherical(1.25, 1.2, Math.PI / 2);
const ZOOM_END_DISTANCE = 0.03;
/** Leave even if the 3D dive runs slowly on a weak device. */
const SAFETY_SECONDS = DIVE_TOTAL + UNLOCK_SECONDS + 3;

/** When taken apart, pull the camera back and aim higher so every part stays in view. */
const APART_ZOOM = 0.3;
const APART_LIFT = 0.18;
/** On the front page the parts only travel this share of the full exploded distance. */
const HERO_SPREAD = 0.65;

/** Shift the rendered image so the rover sits on the left; eases back to center while diving. */
function ViewOffset({ diving, tRef }: { diving: boolean; tRef: React.RefObject<number> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const factor = useRef<number | null>(null);

  useFrame((_, delta) => {
    // Shift less when taken apart: the exploded arm reaches out to the upper left.
    // Constant shift: the rover (assembled or apart) stays left of the text column.
    void tRef;
    const wanted = size.width >= 900 && !diving ? VIEW_SHIFT : 0;
    const cur = factor.current ?? wanted;
    const next = THREE.MathUtils.damp(cur, wanted, diving ? 3 : 4, Math.min(delta, 0.05));
    if (factor.current !== null && Math.abs(next - factor.current) < 1e-4 && camera.view) return;
    factor.current = next;
    camera.setViewOffset(size.width, size.height, size.width * next, 0, size.width, size.height);
    camera.updateProjectionMatrix();
  });
  return null;
}

/**
 * Keeps the taken-apart rover inside the frame: zooms out and lifts the aim in step with
 * the together/apart value, applied as a delta so the user's own rotate/zoom is preserved.
 */
function ApartFraming({ diving, tRef }: { diving: boolean; tRef: React.RefObject<number> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const applied = useRef(0);
  const off = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!controls || diving) return;
    const t = tRef.current ?? 0;
    if (Math.abs(t - applied.current) < 1e-4) return;
    const scale = (1 + APART_ZOOM * t) / (1 + APART_ZOOM * applied.current);
    off.copy(camera.position).sub(controls.target).multiplyScalar(scale);
    controls.target.y += APART_LIFT * (t - applied.current);
    camera.position.copy(controls.target).add(off);
    controls.update();
    applied.current = t;
  });
  return null;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Phase 1: orbit around to the back of the computer enclosure.
 * Phase 2: zoom straight into its back panel. Calls onDone at the end.
 */
function CameraDive({
  active,
  center,
  backFace,
  blackout,
  onDone,
}: {
  active: boolean;
  center: THREE.Vector3 | null;
  backFace: THREE.Vector3 | null;
  blackout: React.RefObject<HTMLDivElement | null>;
  onDone: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const dive = useRef<{
    from: THREE.Spherical;
    fromTarget: THREE.Vector3;
    elapsed: number;
    done: boolean;
  } | null>(null);
  const tmp = useMemo(
    () => ({ sph: new THREE.Spherical(), target: new THREE.Vector3(), off: new THREE.Vector3() }),
    [],
  );

  useEffect(() => {
    if (!active || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    dive.current = {
      from: new THREE.Spherical().setFromVector3(offset),
      fromTarget: controls.target.clone(),
      elapsed: 0,
      done: false,
    };
  }, [active, controls, camera]);

  useFrame((_, delta) => {
    const d = dive.current;
    if (!d || !controls || !center || !backFace) return;
    d.elapsed = Math.min(DIVE_TOTAL, d.elapsed + Math.min(delta, 0.05));
    const { sph, target } = tmp;

    if (d.elapsed <= DIVE_ORBIT) {
      const k = easeInOutCubic(d.elapsed / DIVE_ORBIT);
      sph.set(
        THREE.MathUtils.lerp(d.from.radius, BACK_VIEW.radius, k),
        THREE.MathUtils.lerp(d.from.phi, BACK_VIEW.phi, k),
        d.from.theta + wrapAngle(BACK_VIEW.theta - d.from.theta) * k,
      );
      target.lerpVectors(d.fromTarget, center, k);
    } else {
      const p = clamp01((d.elapsed - DIVE_ORBIT) / DIVE_ZOOM);
      const k = p * p * (3 - 2 * p); // smoothstep
      // Ease the aim from the enclosure's center onto its back panel, flatten to eye level,
      // and close the distance geometrically so it feels like a continuous push-in.
      target.lerpVectors(center, backFace, k);
      sph.set(
        BACK_VIEW.radius * Math.pow(ZOOM_END_DISTANCE / BACK_VIEW.radius, k),
        THREE.MathUtils.lerp(BACK_VIEW.phi, Math.PI / 2 - 0.08, k),
        BACK_VIEW.theta,
      );
    }
    camera.position.copy(tmp.off.setFromSpherical(sph).add(target));
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
    // Black screen fades in over the end of the push-in, in step with the camera.
    if (blackout.current) {
      const b = clamp01((d.elapsed - (DIVE_TOTAL - BLACKOUT_SECONDS)) / BLACKOUT_SECONDS);
      blackout.current.style.opacity = String(b * b);
    }

    if (d.elapsed >= DIVE_TOTAL && !d.done) {
      d.done = true;
      onDone();
    }
  });
  return null;
}

function HeroRover({
  tRef,
  introDone,
  onIntroDone,
  canHover,
  hovered,
  preview,
  diving,
  portal,
  blackout,
  onHover,
  onUnhover,
  onPartTap,
  onDiveDone,
}: {
  tRef: React.RefObject<number>;
  introDone: boolean;
  onIntroDone: () => void;
  canHover: boolean;
  hovered: string | null;
  preview: string | null;
  diving: boolean;
  portal: React.RefObject<HTMLDivElement | null>;
  blackout: React.RefObject<HTMLDivElement | null>;
  onHover: (name: string) => void;
  onUnhover: (name: string) => void;
  onPartTap: (name: string) => void;
  onDiveDone: () => void;
}) {
  const rover = useRover();
  useRoverBvh(rover, canHover);
  const raycaster = useThree((s) => s.raycaster) as THREE.Raycaster & { firstHitOnly?: boolean };
  const start = useRef<number | null>(null);
  const finished = useRef(introDone);

  useEffect(() => {
    raycaster.firstHitOnly = true;
  }, [raycaster]);

  // Computer enclosure: center and the middle of its back (+x) panel, when assembled.
  const enclosure = useMemo(() => {
    const part = rover.byName.get(BRAIN_HOST_PART);
    if (!part) return { center: null, backFace: null };
    const box = new THREE.Box3();
    part.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox);
    });
    box.translate(part.assembled);
    const center = box.getCenter(new THREE.Vector3());
    return { center, backFace: new THREE.Vector3(box.max.x, center.y, center.z) };
  }, [rover]);

  useFrame((state) => {
    if (!finished.current) {
      if (start.current === null) start.current = state.clock.elapsedTime + 0.15;
      const elapsed = state.clock.elapsedTime - start.current;
      for (const p of rover.parts) {
        const local = clamp01((elapsed - p.order * STAGGER) / PART_DURATION);
        p.t = 1 - easeOutBack(local);
        p.opacity = clamp01(local * 3);
        p.glow = (1 - local) * 0.6 * (local > 0 ? 1 : 0);
        applyPart(p);
      }
      if (elapsed >= INTRO_TOTAL) {
        finished.current = true;
        onIntroDone();
      }
      return;
    }
    const t = tRef.current ?? 0;
    for (const p of rover.parts) {
      p.t = t * HERO_SPREAD;
      p.opacity = 1;
      // No glow while diving, so the enclosure keeps its real colors up close.
      p.glow = !diving && (p.name === hovered || p.name === preview) ? HOVER_GLOW : 0;
      applyPart(p);
    }
  });

  const interactive = introDone && !diving;

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive || e.nativeEvent.buttons !== 0) return;
    e.stopPropagation();
    const name = partNameFromHit(e.object);
    if (name && name !== hovered) onHover(name);
  };
  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    const name = partNameFromHit(e.object);
    if (name) onUnhover(name);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive || e.delta >= CLICK_MAX_PX) return;
    e.stopPropagation();
    const name = partNameFromHit(e.object);
    if (name) onPartTap(name);
  };

  const labels = interactive
    ? Array.from(new Set([hovered, preview].filter((n): n is string => !!n)))
    : [];

  return (
    <>
      <primitive
        object={rover.root}
        onClick={onClick}
        {...(canHover ? { onPointerMove, onPointerOut } : {})}
      />
      <PartLabels rover={rover} names={labels} layout="near" portal={portal} onOpen={() => {}} />
      <CameraDive
        active={diving}
        center={enclosure.center}
        backFace={enclosure.backFace}
        blackout={blackout}
        onDone={onDiveDone}
      />
    </>
  );
}

export function Hero() {
  const reduced = useReducedMotion() ?? false;
  const canHover = useCanHover();
  const navigate = useNavigate();
  const portal = useRef<HTMLDivElement>(null);
  const blackout = useRef<HTMLDivElement>(null);
  const tRef = useRef(0);
  const [t, setT] = useState(0);
  const [introDone, setIntroDone] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [diving, setDiving] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const tween = useRef<AnimationPlaybackControls | null>(null);
  const left = useRef(false);

  // Reduced motion: skip the fly-in and show the assembled rover.
  useEffect(() => {
    if (reduced) setIntroDone(true);
  }, [reduced]);

  const setValue = (v: number) => {
    tRef.current = v;
    setT(v);
  };

  const animateTo = (target: number, duration = 1.2) => {
    tween.current?.stop();
    if (reduced) return setValue(target);
    tween.current = animate(tRef.current, target, {
      duration,
      ease: [0.65, 0, 0.35, 1],
      onUpdate: setValue,
    });
  };

  useEffect(() => () => tween.current?.stop(), []);

  const goToDashboard = useCallback(() => {
    if (left.current) return;
    left.current = true;
    void navigate({ to: "/dashboard" });
  }, [navigate]);

  // The logo + terminal boot now lives in the dashboard, so the dive goes straight there.
  const onDiveDone = useCallback(() => goToDashboard(), [goToDashboard]);

  const startDive = () => {
    if (diving) return;
    setHovered(null);
    setPreview(null);
    if (reduced || !introDone) return goToDashboard();
    animateTo(0, 0.6);
    setDiving(true);
  };

  // Safety net: leave even if the 3D dive runs slowly on a weak device.
  useEffect(() => {
    if (!diving) return;
    const id = setTimeout(goToDashboard, SAFETY_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [diving, goToDashboard]);

  const onPartTap = (name: string) => {
    // Click / tap the rover: take it apart, or put it back together.
    animateTo(tRef.current > 0.5 ? 0 : 1);
    if (!canHover) setPreview((cur) => (cur === name ? null : name));
  };

  const hint = canHover
    ? "Click the rover to take it apart · Hover to see each part"
    : "Tap the rover to take it apart and name a part";

  return (
    <section
      id="rover"
      className={`relative h-[100svh] min-h-[600px] overflow-hidden bg-showroom ${hovered ? "cursor-pointer" : ""}`}
    >
      <RoverCanvas
        camera={{ position: [-1.52, 0.86, 1.795], fov: 36 }}
        className="absolute inset-0"
        floor="mirror"
        loaderClassName="min-[900px]:pr-[40%]"
        onPointerMissed={() => setPreview(null)}
      >
        <ViewOffset diving={diving} tRef={tRef} />
        <ApartFraming diving={diving} tRef={tRef} />
        <HeroRover
          tRef={tRef}
          introDone={introDone}
          onIntroDone={() => setIntroDone(true)}
          canHover={canHover}
          hovered={hovered}
          preview={preview}
          diving={diving}
          portal={portal}
          blackout={blackout}
          onHover={setHovered}
          onUnhover={(name) => setHovered((cur) => (cur === name ? null : cur))}
          onPartTap={onPartTap}
          onDiveDone={onDiveDone}
        />
        <OrbitControls
          makeDefault
          target={TARGET}
          enabled={!diving}
          enablePan={false}
          enableDamping
          minDistance={diving ? 0.005 : 1.5}
          maxDistance={4 * (1 + APART_ZOOM)}
          minPolarAngle={0.35}
          maxPolarAngle={1.45}
        />
      </RoverCanvas>

      {/* Floating part labels (drei <Html> portal). */}
      <div ref={portal} className="pointer-events-none absolute inset-0 z-20 overflow-hidden" />

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 fade-bottom"
        aria-hidden
      />

      {/* Right column: title, specs, Next */}
      <motion.div
        animate={{ opacity: diving ? 0 : 1, x: diving ? 30 : 0 }}
        transition={{ duration: 0.5 }}
        className="pointer-events-none absolute inset-0 z-10 mx-auto flex max-w-7xl items-end justify-end px-6 pt-24 pb-32 md:px-10 min-[900px]:items-center min-[900px]:pb-24"
      >
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto w-full max-w-md min-[900px]:w-[38%]"
        >
          <h1 className="font-display text-6xl font-bold leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl">
            <span className="text-foreground">ENGRAM</span>
            <br />
            <span className="text-brand">Rover</span>
          </h1>
          <p className="mt-6 max-w-sm text-lg leading-relaxed text-muted-foreground">
            A robot that learns by writing memory, not by retraining.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="btn btn-primary group min-h-[56px] px-8 text-base"
              onClick={startDive}
            >
              Go to dashboard
              <ArrowRight
                className="size-5 transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            </button>
          </div>
        </motion.div>
      </motion.div>

      {/* Bottom: small together / apart scroller under the rover */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: diving ? 0 : 1, y: 0 }}
        transition={{ duration: 0.7, delay: diving ? 0 : 0.5 }}
        className="absolute inset-x-0 bottom-5 z-30 flex justify-center px-4 min-[900px]:right-auto min-[900px]:w-[60%]"
      >
        <div className="flex flex-col items-center gap-2">
          <label className="card-stage flex w-[min(320px,90vw)] items-center gap-3 rounded-full px-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Together
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={t}
              disabled={!introDone || diving}
              aria-label="Take the rover apart"
              className="range-brand"
              style={{ "--fill": `${t * 100}%` } as React.CSSProperties}
              onChange={(e) => {
                tween.current?.stop();
                setValue(Number(e.target.value));
              }}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Apart
            </span>
          </label>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointerClick className="size-3.5 text-brand" aria-hidden />
            {hint}
          </p>
        </div>
      </motion.div>

      <a
        href="#build"
        className="btn btn-ghost btn-icon absolute right-6 bottom-6 z-30 hidden md:inline-flex"
        aria-label="Scroll to how we built it"
      >
        <ChevronDown className="size-5 animate-pulse-soft" />
      </a>

      {/* Dive transition: the push-in ends on a black screen (opacity driven by the dive),
          then the logo unlocks on it before the dashboard opens. */}
      {diving && (
        <div
          ref={blackout}
          className="pointer-events-auto fixed inset-0 z-50 grid place-items-center overflow-hidden bg-void"
          style={{ opacity: 0 }}
          aria-hidden
        >
          {unlocking && <LogoUnlock onDone={goToDashboard} />}
        </div>
      )}
    </section>
  );
}
