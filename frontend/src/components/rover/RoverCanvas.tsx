import { Grid, MeshReflectorMaterial } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

import { cn } from "@/lib/utils";
import type { Vec3 } from "@/lib/rover";
import { LoadingRing } from "./LoadingRing";

/** Mount the WebGL canvas only while its section is near the viewport. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setNear(entries[0]?.isIntersecting ?? false), {
      rootMargin: "25% 0px 25% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return near;
}

/** Rendered inside Suspense next to the model: fires once everything has loaded. */
function Ready({ onReady }: { onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

function StageLights() {
  // One hemisphere light and two directional lights. No shadows, no env maps.
  return (
    <>
      <hemisphereLight args={["#e4eef7", "#1a2230", 1.6]} />
      <directionalLight position={[-3, 4, 3]} intensity={2.6} color="#fff6ec" />
      <directionalLight position={[3, 2.5, -3]} intensity={1.4} color="#dde4ee" />
    </>
  );
}

function GridFloor() {
  return (
    <Grid
      position={[0, 0, 0]}
      args={[10, 10]}
      cellSize={0.1}
      cellThickness={0.6}
      cellColor="#2a2e35"
      sectionSize={0.5}
      sectionThickness={1}
      sectionColor="#6e4320"
      fadeDistance={5}
      fadeStrength={2}
      infiniteGrid
    />
  );
}

/**
 * Glossy showroom floor: a blurred mirror reflection of the rover that fades out with height
 * and towards the edges, so it melts into the backdrop behind the (transparent) canvas.
 */
function MirrorFloor() {
  // Radial fade drawn locally (no image files): opaque in the middle, clear at the rim.
  const fade = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(0.35, "#d0d0d0");
      grad.addColorStop(0.7, "#3a3a3a");
      grad.addColorStop(1, "#000000");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 256);
    }
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => fade.dispose(), [fade]);

  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, 0]} renderOrder={-1}>
      <planeGeometry args={[7, 7]} />
      <MeshReflectorMaterial
        resolution={512}
        blur={[120, 40]}
        mixBlur={0.6}
        mixStrength={1.25}
        mixContrast={1}
        // mirror=1: the floor shows only the reflection (tinted by color), the backdrop
        // shows through everywhere else.
        mirror={1}
        depthScale={1.2}
        minDepthThreshold={0.2}
        maxDepthThreshold={1}
        color="#9a9ca0"
        metalness={0}
        roughness={1}
        alphaMap={fade}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

export function RoverCanvas({
  camera,
  children,
  className,
  loaderClassName,
  floor = "grid",
  onPointerMissed,
}: {
  onPointerMissed?: (e: MouseEvent) => void;
  camera: { position: Vec3; fov?: number };
  children: ReactNode;
  className?: string;
  loaderClassName?: string;
  /** "grid": technical grid floor. "mirror": glossy showroom floor with a reflection. */
  floor?: "grid" | "mirror";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (!near) setReady(false);
  }, [near]);

  return (
    <div ref={ref} className={cn("stage-canvas relative", className)}>
      {near ? (
        <Canvas
          dpr={[1, 2]}
          camera={{ position: camera.position, fov: camera.fov ?? 35, near: 0.05, far: 60 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onPointerMissed={(e) => onPointerMissed?.(e)}
        >
          <StageLights />
          {floor === "grid" && <GridFloor />}
          <Suspense fallback={null}>
            {children}
            {floor === "mirror" && <MirrorFloor />}
            <Ready onReady={markReady} />
          </Suspense>
        </Canvas>
      ) : null}
      {!ready && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 grid place-items-center",
            loaderClassName,
          )}
        >
          <LoadingRing />
        </div>
      )}
    </div>
  );
}
