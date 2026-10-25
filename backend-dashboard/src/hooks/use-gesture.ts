/**
 * React hook wrapping GestureEngine for hand-gesture robot control.
 *
 * Handles lifecycle, throttled command dispatch to the ENGRAM API,
 * and exposes the current gesture + landmarks for UI rendering.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { GestureEngine, type GestureResult, type NormalizedLandmark } from "@/lib/gesture-engine";
import { api, getApiBase } from "@/lib/engram";

/* ------------------------------------------------------------------ */
/*  Throttle helpers                                                   */
/* ------------------------------------------------------------------ */

function makeThrottle(ms: number) {
  let lastSent = 0;
  return (fn: () => void) => {
    const now = Date.now();
    if (now - lastSent >= ms) {
      lastSent = now;
      fn();
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Command senders                                                    */
/* ------------------------------------------------------------------ */

function sendDrive(direction: "forward" | "back" | "left" | "right", speed: number) {
  const base = getApiBase();
  if (direction === "left" || direction === "right") {
    const v = direction === "right" ? speed : -speed;
    api(base, "/teleop", { method: "POST", json: { action: "turn", value: v } }).catch(() => {});
  } else {
    const v = direction === "forward" ? speed : -speed;
    api(base, "/teleop", { method: "POST", json: { action: "drive", value: v } }).catch(() => {});
  }
}

function sendGripper(openness: number) {
  const base = getApiBase();
  api(base, "/teleop", { method: "POST", json: { action: "gripper", value: openness } }).catch(() => {});
}

function sendArm(pose: string) {
  const base = getApiBase();
  api(base, "/commands", { method: "POST", json: { text: `arm ${pose}`, who: "gesture" } }).catch(() => {});
}

function sendStop() {
  const base = getApiBase();
  api(base, "/stop", { method: "POST", json: {} }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseGestureReturn {
  gesture: GestureResult;
  landmarks: NormalizedLandmark[][] | null;
  locked: boolean;
  lastGesture: GestureResult;
  fps: number;
}

export function useGesture(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
): UseGestureReturn {
  const [gesture, setGesture] = useState<GestureResult>({ type: "none" });
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[][] | null>(null);
  const [locked, setLocked] = useState(false);
  const [lastGesture, setLastGesture] = useState<GestureResult>({ type: "none" });
  const [fps, setFps] = useState(0);

  const engineRef = useRef<GestureEngine | null>(null);

  // Throttles — stable across renders
  const driveThrottle = useRef(makeThrottle(200));
  const gripperThrottle = useRef(makeThrottle(300));
  // Stop has a simple debounce to avoid spamming
  const lastStopSent = useRef(0);

  const handleGesture = useCallback((g: GestureResult) => {
    setGesture(g);
    if (g.type !== "none") {
      setLastGesture(g);
    }

    // Send stop immediately (no throttle), but debounce to once per 500ms
    if (g.type === "stop") {
      const now = Date.now();
      if (now - lastStopSent.current >= 500) {
        lastStopSent.current = now;
        sendStop();
      }
      return;
    }

  }, []);

  // Separate effect for sending throttled commands (drive/gripper) based on current gesture
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      const g = gestureRef.current;
      if (!g) return;

      if (g.type === "drive") {
        driveThrottle.current(() => sendDrive(g.direction, g.speed));
      } else if (g.type === "spin") {
        driveThrottle.current(() => sendDrive(g.direction, 0.8));
      } else if (g.type === "gripper") {
        gripperThrottle.current(() => sendGripper(g.openness));
      } else if (g.type === "arm") {
        const v = g.pose === "carry" ? 1 : g.pose === "reach_down" ? -1 : 0;
        gripperThrottle.current(() => {
          const base = getApiBase();
          api(base, "/teleop", { method: "POST", json: { action: "arm", value: v } }).catch(() => {});
        });
      }
    }, 50); // Check at 20Hz, actual sends are throttled

    return () => clearInterval(interval);
  }, [enabled]);

  // Keep a ref to the latest gesture for the command interval
  const gestureRef = useRef<GestureResult>(gesture);
  gestureRef.current = gesture;

  // Engine lifecycle
  useEffect(() => {
    if (!enabled) {
      engineRef.current?.stop();
      engineRef.current = null;
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const engine = new GestureEngine({
      onGesture: handleGesture,
      onLandmarks: setLandmarks,
    });
    engineRef.current = engine;

    // Wait for the video to be ready, then start
    const tryStart = () => {
      if (video.readyState >= 2) {
        engine.start(video);
      } else {
        video.addEventListener("loadeddata", () => engine.start(video), { once: true });
      }
    };
    tryStart();

    // FPS polling
    const fpsPoll = setInterval(() => {
      if (engineRef.current) {
        setFps(engineRef.current.fps);
      }
    }, 1000);

    return () => {
      clearInterval(fpsPoll);
      engine.stop();
      engineRef.current = null;
    };
  }, [enabled, handleGesture, videoRef]);

  return { gesture, landmarks, locked, lastGesture, fps };
}
