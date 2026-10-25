import { useGLTF } from "@react-three/drei";
import { useLoader } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, type MeshBVH } from "three-mesh-bvh";

import {
  MODEL_URL,
  PARTS_URL,
  PART_ORDER,
  BRAND_HEX,
  groupIndexOf,
  groupOf,
  type GroupId,
  type PartSpec,
} from "@/lib/rover";

type GlowMaterial = THREE.Material & {
  opacity: number;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

export interface RoverPart {
  name: string;
  group: GroupId;
  groupIndex: number;
  order: number;
  object: THREE.Object3D;
  materials: GlowMaterial[];
  assembled: THREE.Vector3;
  exploded: THREE.Vector3;
  /** Bounding-box center when assembled (world space, model at origin). */
  center: THREE.Vector3;
  // Smoothed per-frame values owned by the scene that renders this clone.
  t: number;
  opacity: number;
  glow: number;
}

export interface Rover {
  root: THREE.Object3D;
  parts: RoverPart[];
  byName: Map<string, RoverPart>;
}

/**
 * Loads the GLB + part list and returns an independent clone with per-part
 * cloned materials. Draco/Meshopt are disabled so nothing is fetched from a CDN.
 */
export function useRover(): Rover {
  const gltf = useGLTF(MODEL_URL, false, false);
  const raw = useLoader(THREE.FileLoader, PARTS_URL) as unknown as string | ArrayBuffer;

  return useMemo(() => {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    const specs = JSON.parse(text) as PartSpec[];
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);

    const parts: RoverPart[] = [];
    for (const spec of specs) {
      const object = root.getObjectByName(spec.name);
      const group = groupOf(spec.name);
      if (!object || !group) continue;

      const materials: GlowMaterial[] = [];
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const cloneOne = (m: THREE.Material) => {
          const c = m.clone() as GlowMaterial;
          c.transparent = true;
          if (c.emissive) {
            c.emissive = new THREE.Color(BRAND_HEX);
            c.emissiveIntensity = 0;
          }
          materials.push(c);
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(cloneOne)
          : cloneOne(mesh.material);
        mesh.userData["partName"] = spec.name;
        // Uses the BVH once useRoverBvh has built it; plain raycast until then.
        mesh.raycast = acceleratedRaycast;
      });
      object.userData["partName"] = spec.name;

      const assembled = new THREE.Vector3(...spec.assembled);
      object.position.copy(assembled);
      object.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

      parts.push({
        name: spec.name,
        group: group.id,
        groupIndex: groupIndexOf(spec.name),
        order: PART_ORDER.indexOf(spec.name),
        object,
        materials,
        assembled,
        exploded: new THREE.Vector3(...spec.exploded),
        center,
        t: 0,
        opacity: 1,
        glow: 0,
      });
    }
    parts.sort((a, b) => a.order - b.order);
    return { root, parts, byName: new Map(parts.map((p) => [p.name, p])) };
  }, [gltf, raw]);
}

/** Push a part's current t / opacity / glow onto its node and materials. */
export function applyPart(part: RoverPart) {
  part.object.position.lerpVectors(part.assembled, part.exploded, part.t);
  part.object.visible = part.opacity > 0.01;
  for (const m of part.materials) {
    m.opacity = part.opacity;
    m.depthWrite = part.opacity > 0.6;
    if (m.emissiveIntensity !== undefined) m.emissiveIntensity = part.glow;
  }
}

/** Walk up from a raycast hit to the part node. */
export function partNameFromHit(object: THREE.Object3D | null): string | null {
  let o: THREE.Object3D | null = object;
  while (o) {
    if (typeof o.userData["partName"] === "string") return o.userData["partName"];
    o = o.parent;
  }
  return null;
}

/**
 * Build raycast acceleration trees for the (shared) geometries, one per task so the
 * page never freezes. Makes hover picking on the ~2M-triangle model cheap.
 */
export function useRoverBvh(rover: Rover, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const geoms: THREE.BufferGeometry[] = [];
    for (const p of rover.parts) {
      p.object.traverse((o) => {
        const g = (o as THREE.Mesh).geometry as
          (THREE.BufferGeometry & { boundsTree?: MeshBVH }) | undefined;
        if ((o as THREE.Mesh).isMesh && g && !g.boundsTree && !geoms.includes(g)) geoms.push(g);
      });
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (cancelled) return;
      const g = geoms.shift() as (THREE.BufferGeometry & { boundsTree?: MeshBVH }) | undefined;
      if (!g) return;
      if (!g.boundsTree) g.boundsTree = computeBoundsTree.call(g) as MeshBVH;
      timer = setTimeout(next, 16);
    };
    timer = setTimeout(next, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rover, enabled]);
}

useGLTF.preload(MODEL_URL, false, false);
