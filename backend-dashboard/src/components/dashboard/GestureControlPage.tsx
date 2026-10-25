/**
 * Gesture control page for the ENGRAM rover.
 * Dual camera: user webcam (hand tracking) + robot POV.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "@tanstack/react-router";
import {
  Camera, Hand, Mic, MicOff, Octagon,
  Video, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  RotateCw, RotateCcw as RotateLeft, GripVertical, Crosshair,
  Shield, Eye, ChevronUp, ChevronDown, ArrowLeftCircle,
} from "lucide-react";

import { EngramLogo } from "@/components/brand/EngramLogo";
import { cn } from "@/lib/utils";
import { useApiBase, useHealth, useRobotState, useStop, useClearStop } from "@/hooks/use-engram";
import { useGesture } from "@/hooks/use-gesture";
import { useSpeech } from "@/hooks/use-speech";
import { api } from "@/lib/engram";
import type { NormalizedLandmark } from "@/lib/gesture-engine";

/* ------------------------------------------------------------------ */
/*  Skeleton drawing                                                   */
/* ------------------------------------------------------------------ */

const CONNS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
];

function drawHand(ctx: CanvasRenderingContext2D, lms: NormalizedLandmark[][], w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  for (const hand of lms) {
    ctx.strokeStyle = "rgba(232,120,42,0.6)";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [a, b] of CONNS) {
      const la = hand[a], lb = hand[b];
      if (!la || !lb) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * w, la.y * h);
      ctx.lineTo(lb.x * w, lb.y * h);
      ctx.stroke();
    }
    for (let i = 0; i < hand.length; i++) {
      const lm = hand[i]!;
      const tip = [4, 8, 12, 16, 20].includes(i);
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, tip ? 4 : 2, 0, Math.PI * 2);
      ctx.fillStyle = tip ? "#e8782a" : "#a8b2bc";
      ctx.fill();
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Gesture text                                                       */
/* ------------------------------------------------------------------ */

type G = ReturnType<typeof useGesture>["gesture"];

function label(g: G): string {
  switch (g.type) {
    case "drive": return g.direction.toUpperCase();
    case "spin": return `SPIN ${g.direction.toUpperCase()}`;
    case "stop": return g.reason === "deadman" ? "HAND LOST" : "STOP";
    case "gripper": return g.openness > 0.5 ? "OPEN CLAW" : "GRAB";
    case "arm": return g.pose === "carry" ? "ARM UP" : g.pose === "reach_down" ? "ARM DOWN" : "ARM HOME";
    case "none": return "IDLE";
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export function GestureControlPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [robotCamKey, setRobotCamKey] = useState(0);
  const [base] = useApiBase();

  const health = useHealth();
  const robot = useRobotState();
  const stopMut = useStop();
  const clearStop = useClearStop();
  const online = health.isSuccess && health.data?.ok;

  const [voiceQueue, setVoiceQueue] = useState<{ cmd: string; status: "pending" | "running" | "done" }[]>([]);
  const [voiceDir, setVoiceDir] = useState<string | null>(null);
  const runningQueue = useRef(false);

  // Disable gesture commands when voice mode is active
  const { gesture, landmarks, locked, lastGesture, fps } = useGesture(videoRef, cameraOn && !voiceMode);

  // Use Gemini to parse voice into robot commands, then execute in order
  const GEMINI_KEY = (typeof window !== "undefined" && (window as any).__GEMINI_KEY) || import.meta.env.VITE_GEMINI_KEY || "";

  type RobotCmd = { action: "drive" | "turn" | "gripper" | "stop" | "arm"; value: number; label: string };

  async function parseWithGemini(text: string): Promise<RobotCmd[]> {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `You control a small rover robot. Parse this voice command into a JSON array of robot actions. If the user says "X times" or a number, repeat that action that many times.

Each action: action (drive|turn|gripper|stop|arm), value (float -1 to 1), label (short description).

drive: value 0.8=forward, -0.8=back.
turn: value 0.6=right, -0.6=left.
gripper: value 0=close/grab, 1=open.
stop: value 0.
arm: value 1=up, -1=down.

Examples:
"move forward 4 times" -> [{"action":"drive","value":0.8,"label":"forward"},{"action":"drive","value":0.8,"label":"forward"},{"action":"drive","value":0.8,"label":"forward"},{"action":"drive","value":0.8,"label":"forward"}]
"left twice then forward" -> [{"action":"turn","value":-0.6,"label":"left"},{"action":"turn","value":-0.6,"label":"left"},{"action":"drive","value":0.8,"label":"forward"}]

Voice command: "${text}"

Respond ONLY with a JSON array, no markdown.` }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
          }),
        },
      );
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
      // Extract JSON array from response
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    } catch {
      // Fallback: basic parsing
    }
    // Fallback: split into words and map each direction keyword to a command
    return fallbackParse(text);
  }

  function fallbackParse(text: string): RobotCmd[] {
    const t = text.toLowerCase().replace(/[.,!?]/g, " ").trim();
    const cmds: RobotCmd[] = [];
    const actions: Record<string, RobotCmd> = {
      forward: { action: "drive", value: 0.8, label: "forward" },
      ahead: { action: "drive", value: 0.8, label: "forward" },
      back: { action: "drive", value: -0.8, label: "reverse" },
      backward: { action: "drive", value: -0.8, label: "reverse" },
      reverse: { action: "drive", value: -0.8, label: "reverse" },
      left: { action: "turn", value: -0.6, label: "left" },
      right: { action: "turn", value: 0.6, label: "right" },
      stop: { action: "stop", value: 0, label: "stop" },
      grab: { action: "gripper", value: 0, label: "grab" },
      open: { action: "gripper", value: 1, label: "open" },
      up: { action: "arm", value: 1, label: "arm up" },
      down: { action: "arm", value: -1, label: "arm down" },
    };
    const nums: Record<string, number> = {
      once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4,
      five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    };

    // Split on "then", "and", commas
    const parts = t.split(/\b(?:then|and then|and)\b|,/).map(s => s.trim()).filter(Boolean);

    for (const part of parts) {
      const words = part.split(/\s+/);
      let action: RobotCmd | null = null;
      let repeat = 1;

      for (const w of words) {
        if (actions[w] && !action) action = { ...actions[w]! };
        else if (nums[w]) repeat = nums[w]!;
        else { const n = parseInt(w); if (!isNaN(n) && n > 0 && n <= 20) repeat = n; }
      }

      // "move" alone = forward
      if (!action && part.includes("move")) action = { ...actions["forward"]! };

      if (action) {
        for (let r = 0; r < repeat; r++) cmds.push({ ...action });
      }
    }

    return cmds.length > 0 ? cmds : [{ action: "drive", value: 0.8, label: text }];
  }

  const executeQueue = useCallback(async (cmds: { cmd: string; status: "pending" | "running" | "done"; teleop?: RobotCmd }[]) => {
    if (runningQueue.current) return;
    runningQueue.current = true;
    for (let i = 0; i < cmds.length; i++) {
      cmds[i]!.status = "running";
      setVoiceQueue([...cmds]);
      const t = cmds[i]!.teleop;
      if (t) {
        const dir = t.action === "drive" ? (t.value > 0 ? "forward" : "back")
          : t.action === "turn" ? (t.value > 0 ? "right" : "left") : null;
        if (dir) setVoiceDir(dir);
        if (t.action === "stop") setVoiceDir("stop");

        await api(base, "/teleop", { method: "POST", json: { action: t.action, value: t.value } }).catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 1000));
      cmds[i]!.status = "done";
      setVoiceQueue([...cmds]);
      setVoiceDir(null);
    }
    runningQueue.current = false;
  }, [base]);

  const speech = useSpeech(useCallback((text: string) => {
    // Use fallback parser directly (Gemini quota exhausted)
    const parsed = fallbackParse(text);
    const cmds = parsed.map((p) => ({ cmd: p.label, status: "pending" as const, teleop: p }));
    setVoiceQueue(cmds);
    executeQueue(cmds);
  }, [executeQueue]));

  useEffect(() => {
    if (!voiceMode || !speech.supported || speech.listening) return undefined;
    const t = setTimeout(() => speech.start(), 300);
    return () => clearTimeout(t);
  }, [voiceMode, speech.listening, speech.supported, speech.start]);

  useEffect(() => {
    if (!cameraOn) return;
    let stream: MediaStream | null = null;
    let dead = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      } catch (e) { setCameraError((e as Error).message); setCameraOn(false); }
    })();
    return () => { dead = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [cameraOn]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const r = c.getBoundingClientRect(); c.width = r.width; c.height = r.height;
    if (landmarks?.length) drawHand(ctx, landmarks, c.width, c.height);
    else ctx.clearRect(0, 0, c.width, c.height);
  }, [landmarks]);

  useEffect(() => {
    const fn = () => { const c = canvasRef.current; if (c) { const r = c.getBoundingClientRect(); c.width = r.width; c.height = r.height; } };
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  const dead = gesture.type === "stop" && gesture.reason === "deadman";
  const speed = gesture.type === "drive" ? gesture.speed : 0;
  const grip = gesture.type === "gripper" ? gesture.openness : null;
  const dir = voiceMode ? voiceDir : (gesture.type === "drive" ? gesture.direction : null);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#0a0c10]">
      {/* Black screen transition — fades away on load */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-50 bg-black"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        aria-hidden
      />

      {/* TOP BAR */}
      <header className="z-40 flex items-center gap-3 border-b border-white/8 bg-[#0d0f14] px-4 py-2">
        <Link to="/" className="rounded bg-white/5 p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white">
          <ArrowLeftCircle className="size-4" />
        </Link>
        <EngramLogo animate />
        <div className="ml-auto flex items-center gap-2">
          {cameraOn && <span className="font-mono text-[11px] text-white/40">{fps} fps</span>}
          <button onClick={() => { stopMut.mutate(); setCameraOn(false); setVoiceMode(false); speech.stop(); }}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-bold text-white transition-all hover:bg-red-500 active:scale-95">
            <Octagon className="mr-1 inline size-3.5" />STOP
          </button>
        </div>
      </header>


      {/* MAIN */}
      <main className="flex flex-1 overflow-hidden">
        {/* CAMERA */}
        <div className="flex flex-1">
          {/* User camera */}
          <div className={cn("relative m-3 flex-1 overflow-hidden rounded-xl bg-black", dead && "ring-2 ring-red-500")}>
            <video ref={videoRef} playsInline muted
              className={cn("size-full object-cover [transform:scaleX(-1)]", locked && "brightness-[0.2]")} />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full [transform:scaleX(-1)]" />

            {/* Robot camera PiP — like FaceTime */}
            {cameraOn && (
              <div className="absolute left-3 top-3 z-10 overflow-hidden rounded-lg border border-white/15 shadow-lg" style={{ width: 400, height: 260 }}>
                <img key={robotCamKey} src={`${base}/camera/stream?k=${robotCamKey}`}
                  alt="Robot POV" className="size-full object-cover bg-black" />
                {!online && (
                  <div className="absolute inset-0 grid place-items-center bg-black/80">
                    <span className="text-[9px] text-white/30">Robot offline</span>
                  </div>
                )}
              </div>
            )}

            {/* HUD frame */}
            {cameraOn && <>
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-2 top-2 size-6 border-l border-t border-white/20" />
                <div className="absolute right-2 top-2 size-6 border-r border-t border-white/20" />
                <div className="absolute bottom-2 left-2 size-6 border-b border-l border-white/20" />
                <div className="absolute bottom-2 right-2 size-6 border-b border-r border-white/20" />
              </div>

              {/* Current action — below PiP */}
              <div className="absolute left-3 top-[275px] rounded bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                <div className="text-[9px] uppercase tracking-widest text-white/40">
                  {voiceMode ? "Voice" : "Now"}
                </div>
                <div className={cn("max-w-[200px] truncate text-sm font-bold",
                  voiceMode ? "text-[#e8782a]" : gesture.type === "stop" ? "text-red-400" : "text-[#e8782a]")}>
                  {voiceMode
                    ? (speech.interim || (voiceQueue.find(q => q.status === "running")?.cmd) || "Listening...")
                    : label(gesture.type !== "none" ? gesture : lastGesture)}
                </div>
              </div>

              {/* Speed bar — below action */}
              <div className="absolute left-3 top-[325px] flex items-center gap-2 rounded bg-black/50 px-3 py-1.5 backdrop-blur-sm">
                <span className="text-[9px] uppercase tracking-widest text-white/40">Spd</span>
                <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                  <motion.div className="absolute inset-y-0 left-0 rounded-full bg-[#e8782a]"
                    animate={{ width: `${speed * 100}%` }} transition={{ duration: 0.08 }} />
                </div>
                <span className="font-mono text-[10px] text-white/50">{Math.round(speed * 100)}%</span>
              </div>

              {/* D-PAD OVERLAY — top right of camera */}
              <div className="absolute right-4 top-4">
                <div className="grid grid-cols-3 grid-rows-3 gap-1" style={{ width: 120, height: 120 }}>
                  <div />
                  <DArrow active={dir === "forward"}><ArrowUp className="size-4" /></DArrow>
                  <div />
                  <DArrow active={dir === "left"}><ArrowLeft className="size-4" /></DArrow>
                  <div className="grid place-items-center rounded bg-black/40">
                    <Crosshair className={cn("size-4", gesture.type === "stop" ? "text-red-400" : "text-white/30")} />
                  </div>
                  <DArrow active={dir === "right"}><ArrowRight className="size-4" /></DArrow>
                  <div />
                  <DArrow active={dir === "back"}><ArrowDown className="size-4" /></DArrow>
                  <div />
                </div>
              </div>

            </>}

            {/* Overlays */}
            <AnimatePresence>
              {dead && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-x-0 bottom-0 bg-red-900/80 py-2 text-center font-mono text-sm font-bold text-red-300">
                  <Shield className="mr-2 inline size-4" />HAND LOST — STOPPED
                </motion.div>
              )}
            </AnimatePresence>

            {/* Voice caption — shows command queue or interim */}
            <AnimatePresence>
              {(speech.interim || voiceQueue.length > 0) && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                  className="absolute inset-x-0 bottom-6 z-20 flex justify-center">
                  <div className="rounded-lg bg-black/70 px-5 py-2 backdrop-blur-sm">
                    {speech.interim && voiceQueue.length === 0 && (
                      <div className="font-mono text-sm text-white/70">{speech.interim}</div>
                    )}
                    {voiceQueue.length > 0 && (
                      <div className="flex items-center gap-3">
                        {voiceQueue.map((q, i) => (
                          <div key={i} className={cn("font-mono text-xs px-2 py-0.5 rounded",
                            q.status === "done" ? "text-white/30 line-through" :
                            q.status === "running" ? "text-[#e8782a] bg-[#e8782a]/10 font-bold" :
                            "text-white/50")}>
                            {q.cmd}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Start */}
            {!cameraOn && (
              <div className="absolute inset-0 grid place-items-center bg-black/90">
                <div className="flex flex-col items-center gap-4">
                  <Hand className="size-14 text-[#e8782a]" />
                  <h2 className="text-xl font-bold text-white">Gesture Control</h2>
                  <button onClick={() => setCameraOn(true)}
                    className="rounded-lg bg-[#e8782a] px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#d06a22] active:scale-95">
                    <Camera className="mr-2 inline size-4" />Start Camera
                  </button>
                  {cameraError && <p className="text-xs text-red-400">{cameraError}</p>}
                </div>
              </div>
            )}
          </div>

        </div>

        {/* SIDE PANEL */}
        <div className="flex w-[320px] flex-shrink-0 flex-col gap-0 overflow-y-auto border-l border-white/8 bg-[#0d0f14] lg:w-[380px]">

          {/* Status */}
          <div className="border-b border-white/5 p-3">
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Robot" value={robot.data?.stopped ? "Stopped" : "Ready"} ok={!robot.data?.stopped} />
              <Stat label="Server" value={online ? "Online" : "Offline"} ok={!!online} />
              <Stat label="Gripper" value={robot.data?.gripper_open ? "Open" : "Closed"} ok />
              <Stat label="Control" value={locked ? "Locked" : "Active"} ok={!locked} />
            </div>
          </div>

          {/* Push to talk */}
          {speech.supported && (
            <div className="border-b border-white/5 p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Voice</div>
              <button
                onPointerDown={() => { setVoiceMode(true); speech.start(); }}
                onPointerUp={() => { speech.stop(); setTimeout(() => setVoiceMode(false), 3000); }}
                onPointerLeave={() => { if (voiceMode) { speech.stop(); setTimeout(() => setVoiceMode(false), 3000); } }}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg border py-3 text-xs font-semibold transition-all select-none",
                  voiceMode
                    ? "border-[#e8782a]/40 bg-[#e8782a]/15 text-[#e8782a]"
                    : "border-white/8 bg-white/5 text-white/50 hover:border-white/15 hover:text-white/70",
                )}
              >
                {voiceMode ? <><Mic className="size-4 animate-pulse" />Release to send</> : <><Mic className="size-4" />Hold to talk</>}
              </button>
            </div>
          )}

          {/* Gesture guide */}
          <div className="border-b border-white/5 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">Gesture Guide</div>
            <div className="space-y-1">
              <GuideRow icon={<ChevronUp className="size-3.5" />} gesture="2 fingers up" action="Forward" />
              <GuideRow icon={<ChevronDown className="size-3.5" />} gesture="2 fingers down" action="Reverse" />
              <GuideRow icon={<ArrowLeft className="size-3.5" />} gesture="2 fingers left" action="Turn left" />
              <GuideRow icon={<ArrowRight className="size-3.5" />} gesture="2 fingers right" action="Turn right" />
              <GuideRow icon={<RotateLeft className="size-3.5" />} gesture="Circle left" action="Spin left" />
              <GuideRow icon={<RotateCw className="size-3.5" />} gesture="Circle right" action="Spin right" />
              <GuideRow icon={<Hand className="size-3.5" />} gesture="Open palm" action="Open claw" />
              <GuideRow icon={<GripVertical className="size-3.5" />} gesture="Fist" action="Grab / close" />
              <GuideRow icon={<ArrowUp className="size-3.5" />} gesture="Thumb up" action="Arm up" />
              <GuideRow icon={<ArrowDown className="size-3.5" />} gesture="Thumb down" action="Arm down" />
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function DArrow({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid place-items-center rounded transition-all",
      active ? "bg-[#e8782a]/30 text-[#e8782a]" : "bg-black/40 text-white/20")}>
      {children}
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded border border-white/5 bg-white/3 px-2.5 py-1.5">
      <div className="text-[9px] uppercase text-white/30">{label}</div>
      <div className={cn("text-[11px] font-medium", ok ? "text-white/70" : "text-red-400")}>{value}</div>
    </div>
  );
}

function GuideRow({ icon, gesture, action }: { icon: React.ReactNode; gesture: string; action: string }) {
  return (
    <div className="flex items-center gap-2 rounded bg-white/3 px-2.5 py-1">
      <span className="text-[#e8782a]">{icon}</span>
      <span className="flex-1 text-[10px] text-white/40">{gesture}</span>
      <span className="text-[10px] font-medium text-white/60">{action}</span>
    </div>
  );
}
