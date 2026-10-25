/**
 * MediaPipe hand tracking + gesture classification.
 *
 * Gestures:
 *   - 5 fingers open = open claw
 *   - fist (0 fingers) = grab / close claw
 *   - thumb only up = arm up
 *   - thumb only down = arm down
 *   - 2 fingers up = forward
 *   - 2 fingers down = back
 *   - 2 fingers left = turn left
 *   - 2 fingers right = turn right
 */

import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type GestureResult =
  | { type: "drive"; direction: "forward" | "back" | "left" | "right"; speed: number }
  | { type: "stop"; reason: "palm" | "deadman" }
  | { type: "gripper"; openness: number }
  | { type: "arm"; pose: "carry" | "reach_down" | "home" }
  | { type: "spin"; direction: "left" | "right" }
  | { type: "none" };

export interface GestureEngineOptions {
  modelPath?: string;
  onGesture: (gesture: GestureResult) => void;
  onLandmarks?: (landmarks: NormalizedLandmark[][] | null) => void;
}

// Landmark indices
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_TIP = 8;
const INDEX_PIP = 6;
const INDEX_MCP = 5;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const MIDDLE_MCP = 9;
const RING_TIP = 16;
const RING_PIP = 14;
const PINKY_TIP = 20;
const PINKY_PIP = 18;

type Lm = NormalizedLandmark;

function dist(a: Lm, b: Lm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Finger is "up/extended" if:
 * - tip is above PIP (tip.y < pip.y), OR
 * - tip is far from the palm center (extended outward even if sideways)
 */
function fingerUp(lm: Lm[], tip: number, pip: number, mcp: number): boolean {
  // Tip above PIP = clearly up
  if (lm[tip]!.y < lm[pip]!.y) return true;
  // Tip far from PIP in any direction = extended (covers sideways + toward camera)
  if (dist(lm[tip]!, lm[pip]!) > 0.04) return true;
  return false;
}

function thumbExtended(lm: Lm[]): boolean {
  // Thumb tip is far from the base of the index finger
  return dist(lm[THUMB_TIP]!, lm[INDEX_MCP]!) > 0.08;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const DEFAULT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class GestureEngine {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private rafId = 0;
  private onGesture: (g: GestureResult) => void;
  private onLandmarks: ((lm: NormalizedLandmark[][] | null) => void) | undefined;
  private modelPath: string;
  private frameCount = 0;
  private fpsTimestamp = 0;
  fps = 0;

  /** Debug info — read from UI to show what the engine sees */
  debug = "";

  constructor(opts: GestureEngineOptions) {
    this.onGesture = opts.onGesture;
    this.onLandmarks = opts.onLandmarks;
    this.modelPath = opts.modelPath ?? DEFAULT_MODEL;
  }

  async start(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: this.modelPath },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
    this.fpsTimestamp = performance.now();
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.landmarker?.close();
    this.landmarker = null;
  }

  private loop = (): void => {
    if (!this.running || !this.landmarker || !this.video) return;
    const now = performance.now();
    this.frameCount++;
    if (now - this.fpsTimestamp >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimestamp = now;
    }
    if (this.video.readyState >= 2) {
      try {
        const result = this.landmarker.detectForVideo(this.video, now);
        this.classify(result.landmarks);
      } catch { /* skip */ }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private classify(all: NormalizedLandmark[][]): void {
    this.onLandmarks?.(all.length > 0 ? all : null);
    if (all.length === 0) { this.onGesture({ type: "none" }); return; }

    const lm = all[0]!;

    // Detect which fingers are up
    const thumb = thumbExtended(lm);
    const index = fingerUp(lm, INDEX_TIP, INDEX_PIP, INDEX_MCP);
    const middle = fingerUp(lm, MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP);
    const ring = fingerUp(lm, RING_TIP, RING_PIP, RING_TIP); // compare to self as fallback
    const pinky = fingerUp(lm, PINKY_TIP, PINKY_PIP, PINKY_TIP);

    // Use a simpler count: just check tip vs pip for ring/pinky
    const ringUp = lm[RING_TIP]!.y < lm[RING_PIP]!.y;
    const pinkyUp = lm[PINKY_TIP]!.y < lm[PINKY_PIP]!.y;
    const count = [thumb, index, middle, ringUp, pinkyUp].filter(Boolean).length;

    this.debug = `T:${thumb?1:0} I:${index?1:0} M:${middle?1:0} R:${ringUp?1:0} P:${pinkyUp?1:0} = ${count}`;

    // Use strict checks for claw: tip clearly above or below PIP
    const indexCurled = lm[INDEX_TIP]!.y > lm[INDEX_PIP]!.y + 0.01;
    const middleCurled = lm[MIDDLE_TIP]!.y > lm[MIDDLE_PIP]!.y + 0.01;
    const ringCurled = lm[RING_TIP]!.y > lm[RING_PIP]!.y + 0.01;
    const pinkyCurled = lm[PINKY_TIP]!.y > lm[PINKY_PIP]!.y + 0.01;
    const allCurled = indexCurled && middleCurled && ringCurled && pinkyCurled;
    const allOpen = !indexCurled && !middleCurled && !ringCurled && !pinkyCurled;

    // === OPEN PALM (all 4 fingers straight + thumb) = open claw ===
    if (allOpen && thumb) {
      this.onGesture({ type: "gripper", openness: 1 });
      return;
    }

    // === FIST (all 4 fingers curled) = grab ===
    if (allCurled) {
      // Thumb only sticking out = arm up/down
      if (thumb) {
        const up = lm[THUMB_TIP]!.y < lm[WRIST]!.y;
        this.onGesture({ type: "arm", pose: up ? "carry" : "reach_down" });
        return;
      }
      this.onGesture({ type: "gripper", openness: 0 });
      return;
    }

    // === THUMB ONLY (thumb out, index+middle curled) = arm up/down ===
    if (thumb && indexCurled && middleCurled) {
      const up = lm[THUMB_TIP]!.y < lm[WRIST]!.y;
      this.onGesture({ type: "arm", pose: up ? "carry" : "reach_down" });
      return;
    }

    // === TWO FINGERS (index + middle up) = DRIVE ===
    if (index && middle) {
      const tipY = (lm[INDEX_TIP]!.y + lm[MIDDLE_TIP]!.y) / 2;
      const tipX = (lm[INDEX_TIP]!.x + lm[MIDDLE_TIP]!.x) / 2;
      const wy = lm[WRIST]!.y;
      const wx = lm[WRIST]!.x;

      const vert = tipY - wy;   // negative = tips above wrist = fingers pointing UP
      const horiz = tipX - wx;  // positive = tips right of wrist in raw camera

      this.debug += ` v:${vert.toFixed(2)} h:${horiz.toFixed(2)}`;

      // LEFT/RIGHT first — horizontal offset from wrist
      // Raw camera is mirrored: horiz > 0 = your LEFT, horiz < 0 = your RIGHT
      if (Math.abs(horiz) > 0.06 && Math.abs(horiz) > Math.abs(vert) * 0.7) {
        this.onGesture({ type: "drive", direction: horiz > 0 ? "right" : "left", speed: 0.6 });
        return;
      }

      // FORWARD — fingertips above wrist (vert is negative)
      if (vert < -0.03) {
        this.onGesture({ type: "drive", direction: "forward", speed: clamp(Math.abs(vert) / 0.12, 0.3, 1) });
        return;
      }

      // BACK — fingertips below wrist (vert is positive)
      if (vert > 0.06) {
        this.onGesture({ type: "drive", direction: "back", speed: clamp(vert / 0.15, 0.2, 0.6) });
        return;
      }

      // Pointing at camera (neither up/down nor left/right) = stop
      this.onGesture({ type: "stop", reason: "palm" });
      return;
    }

    this.onGesture({ type: "none" });
  }
}

export type { NormalizedLandmark };
