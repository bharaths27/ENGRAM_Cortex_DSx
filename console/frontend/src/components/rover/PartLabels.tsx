import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import { displayName, groupOf } from "@/lib/rover";
import type { Rover } from "./useRover";

interface LabelRefs {
  group: THREE.Group | null;
  label: HTMLButtonElement | null;
  line: HTMLDivElement | null;
}

const ROW_GAP = 36; // min vertical distance between callout labels (px)
const COLUMN_GAP = 44; // distance from the model's outline to the label column (px)
const LABEL_ROOM = 190; // room kept for a "near" label before flipping it left (px)
const EDGE = 12; // min gap between a label and the canvas edge (px)
const TOP_SAFE = 68; // keep callouts below the toolbar (px)
const BOTTOM_SAFE = 64; // and above the hint pill (px)

/**
 * Floating labels anchored (drei <Html>) to each part's live center.
 * "near": a short leader to the upper right. "callout": every label sorted into a left or
 * right column with leader lines so they never sit on top of each other.
 */
export function PartLabels({
  rover,
  names,
  layout,
  portal,
  onOpen,
}: {
  rover: Rover;
  names: string[];
  layout: "near" | "callout";
  portal: React.RefObject<HTMLElement | null>;
  onOpen: (name: string) => void;
}) {
  const refs = useRef(new Map<string, LabelRefs>());
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const tmp = useRef(new THREE.Vector3());

  const slot = (name: string) => {
    let r = refs.current.get(name);
    if (!r) {
      r = { group: null, label: null, line: null };
      refs.current.set(name, r);
    }
    return r;
  };

  useFrame(() => {
    const items: { name: string; sx: number; sy: number }[] = [];
    for (const name of names) {
      const part = rover.byName.get(name);
      const r = refs.current.get(name);
      if (!part || !r?.group) continue;
      // Follow the part when it slides out (explode).
      r.group.position.copy(part.center).add(part.object.position).sub(part.assembled);
      const v = tmp.current.copy(r.group.position).project(camera);
      items.push({ name, sx: ((v.x + 1) / 2) * size.width, sy: ((1 - v.y) / 2) * size.height });
    }
    if (!items.length) return;

    const offsets = new Map<string, { dx: number; dy: number }>();
    if (layout === "near") {
      for (const it of items) {
        const flip = it.sx > size.width - LABEL_ROOM;
        offsets.set(it.name, { dx: flip ? -22 : 22, dy: -22 });
      }
    } else {
      const minX = Math.min(...items.map((i) => i.sx));
      const maxX = Math.max(...items.map((i) => i.sx));
      const midX = (minX + maxX) / 2;
      const widthOf = (name: string) => refs.current.get(name)?.label?.offsetWidth ?? 180;
      const sides = {
        left: items.filter((i) => i.sx < midX).sort((a, b) => a.sy - b.sy),
        right: items.filter((i) => i.sx >= midX).sort((a, b) => a.sy - b.sy),
      };
      const wL = Math.max(0, ...sides.left.map((i) => widthOf(i.name)));
      const wR = Math.max(0, ...sides.right.map((i) => widthOf(i.name)));
      let leftCol = Math.max(wL + EDGE, minX - COLUMN_GAP);
      let rightCol = Math.min(size.width - wR - EDGE, maxX + COLUMN_GAP);
      // Narrow view: meet in the middle so the two columns never overlap each other.
      if (leftCol > rightCol - 8) {
        const m = (leftCol + rightCol) / 2;
        leftCol = m - 4;
        rightCol = m + 4;
      }
      for (const side of ["left", "right"] as const) {
        const col = sides[side];
        const ys = col.map((i) => i.sy);
        for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + ROW_GAP);
        // Re-center the stack on the anchors so it doesn't drift downward.
        if (ys.length) {
          const shift =
            (ys.reduce((a, b) => a + b, 0) - col.reduce((a, b) => a + b.sy, 0)) / ys.length;
          for (let i = 0; i < ys.length; i++) ys[i] = ys[i]! - shift;
          // Keep the stack inside the safe vertical band.
          const over = ys[ys.length - 1]! - (size.height - BOTTOM_SAFE);
          if (over > 0) for (let i = 0; i < ys.length; i++) ys[i] = ys[i]! - over;
          const under = TOP_SAFE - ys[0]!;
          if (under > 0) for (let i = 0; i < ys.length; i++) ys[i] = ys[i]! + under;
        }
        col.forEach((it, i) => {
          const x = side === "left" ? leftCol : rightCol;
          offsets.set(it.name, { dx: x - it.sx, dy: ys[i]! - it.sy });
        });
      }
    }

    for (const it of items) {
      const r = refs.current.get(it.name);
      const o = offsets.get(it.name);
      if (!r?.label || !r.line || !o) continue;
      const left = o.dx < 0;
      r.label.style.transform = `translate(${o.dx}px, ${o.dy}px) translate(${left ? "-100%" : "0"}, -50%)`;
      r.line.style.width = `${Math.hypot(o.dx, o.dy)}px`;
      r.line.style.transform = `rotate(${Math.atan2(o.dy, o.dx)}rad)`;
    }
  });

  return (
    <>
      {names.map((name) => {
        const r = slot(name);
        const group = groupOf(name);
        return (
          <group key={name} ref={(g) => void (r.group = g)}>
            <Html
              portal={portal as React.RefObject<HTMLElement>}
              zIndexRange={[30, 20]}
              pointerEvents="none"
            >
              <div className="relative size-0">
                <div className="label-leader" ref={(el) => void (r.line = el)} />
                <div className="label-anchor" />
                <button
                  type="button"
                  ref={(el) => void (r.label = el)}
                  className="label-pin absolute top-0 left-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(name);
                  }}
                >
                  <span className="size-2 shrink-0 rounded-full bg-brand" aria-hidden />
                  <span className="font-semibold">{displayName(name)}</span>
                  {group && layout === "near" && (
                    <span className="text-muted-foreground">· {group.label}</span>
                  )}
                </button>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}
