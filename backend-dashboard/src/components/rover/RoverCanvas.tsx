import { Grid, MeshReflectorMaterial, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
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

/** White-themed single-story house floor plan with an animated rover dot navigating through rooms. */
/** 3D house floor plan from GLB with animated rover navigating through rooms. */
function GridFloor() {
  const { scene } = useGLTF("/models/floor-plan.glb");
  const houseRef = useRef<THREE.Group>(null);
  const roverRef = useRef<THREE.Group>(null);
  const progress = useRef(0);

  // Rover patrol path through the house — scaled to match the GLB
  const path: [number, number][] = [
    [0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1],
    [0, 1], [0, 1.5], [0.5, 1.5], [1, 1.5], [1.5, 1.5],
    [1.5, 1], [1.5, 0.5], [1.5, 0], [1, -0.5], [0.5, -0.5],
    [0, -0.5], [-0.5, -0.5], [-0.5, 0], [-0.5, 0.5],
    [-0.5, 1], [0, 0.5], [0, 0],
  ];

  // Auto-fit the GLB to scene on first load
  useEffect(() => {
    if (!houseRef.current) return;
    const box = new THREE.Box3().setFromObject(houseRef.current);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Scale to fit ~3 units wide
    const scale = 3 / Math.max(size.x, size.z);
    houseRef.current.scale.setScalar(scale);
    houseRef.current.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    // Update path to match scaled house
    const hx = size.x * scale / 2;
    const hz = size.z * scale / 2;
    for (let i = 0; i < path.length; i++) {
      path[i] = [(path[i]![0] / 1.5) * hx, (path[i]![1] / 1.5) * hz];
    }
  }, [scene]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    progress.current += delta * 0.3;
    const total = path.length;
    const idx = progress.current % total;
    const i = Math.floor(idx);
    const frac = idx - i;
    const a = path[i % total]!;
    const b = path[(i + 1) % total]!;
    const x = a[0] + (b[0] - a[0]) * frac;
    const z = a[1] + (b[1] - a[1]) * frac;

    if (roverRef.current) {
      roverRef.current.position.x = x;
      roverRef.current.position.z = z;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      roverRef.current.rotation.y = -angle + Math.PI / 2;
    }
  });

  return (
    <group>
      {/* House model */}
      <group ref={houseRef}>
        <primitive object={scene.clone()} />
      </group>

      {/* Rover — small orange sphere (basketball sized ~0.12 units) */}
      <group ref={roverRef} position={[0, 0.06, 0]}>
        <mesh>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshStandardMaterial color="#e8782a" emissive="#e8782a" emissiveIntensity={0.5} />
        </mesh>
        {/* Glow ring on floor */}
        <mesh position={[0, -0.055, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.05, 0.08, 16]} />
          <meshBasicMaterial color="#e8782a" transparent opacity={0.3} />
        </mesh>
      </group>
    </group>
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
