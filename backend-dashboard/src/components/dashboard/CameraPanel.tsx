import type { ReactNode } from "react";
import { Camera, CameraOff, MonitorSmartphone, RefreshCw, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PanelTitle } from "@/components/dashboard/AskPanel";
import { cn } from "@/lib/utils";
import { useApiBase, useCameraStatus } from "@/hooks/use-engram";

type Source = "overhead" | "device";

export function CameraPanel() {
  const [base] = useApiBase();
  const [source, setSource] = useState<Source>("overhead");
  const [streamKey, setStreamKey] = useState(0); // bump to reconnect the MJPEG <img>
  const status = useCameraStatus();

  return (
    <section className="card-stage flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <PanelTitle icon={<Video className="size-4" />}>Camera</PanelTitle>
        <div className="flex rounded-full border border-border bg-black/20 p-0.5 text-xs">
          <SegBtn active={source === "overhead"} onClick={() => setSource("overhead")}>
            <Camera className="size-3.5" /> Overhead
          </SegBtn>
          <SegBtn active={source === "device"} onClick={() => setSource("device")}>
            <MonitorSmartphone className="size-3.5" /> This device
          </SegBtn>
        </div>
      </div>

      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
        {source === "overhead" ? (
          <OverheadView base={base} online={!!status.data?.online} streamKey={streamKey} />
        ) : (
          <DeviceView />
        )}
      </div>

      {source === "overhead" && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {status.data?.online
              ? `Live · ${status.data.age_s?.toFixed(1)}s ago`
              : "No overhead feed. Run scripts/overhead_camera.py on the Mac."}
          </span>
          <button className="btn btn-ghost !min-h-[32px] gap-1 text-xs" onClick={() => setStreamKey((k) => k + 1)}>
            <RefreshCw className="size-3.5" /> Reconnect
          </button>
        </div>
      )}
    </section>
  );
}

function OverheadView({ base, online, streamKey }: { base: string; online: boolean; streamKey: number }) {
  return (
    <>
      <img
        key={streamKey}
        src={`${base}/camera/stream?k=${streamKey}`}
        alt="Overhead camera"
        className="size-full object-contain"
      />
      {!online && (
        <div className="absolute inset-0 grid place-items-center bg-black/70 text-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <CameraOff className="size-7" />
            <span className="text-sm">Waiting for the overhead camera…</span>
          </div>
        </div>
      )}
    </>
  );
}

function DeviceView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setError((e as Error).message || "Camera unavailable");
        setOn(false);
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);

  return (
    <>
      <video ref={videoRef} playsInline muted className="size-full object-cover" />
      {!on && (
        <div className="absolute inset-0 grid place-items-center bg-black/70">
          <button className="btn btn-primary !min-h-[44px] gap-2" onClick={() => setOn(true)}>
            <Camera className="size-4" /> Use this camera
          </button>
        </div>
      )}
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-destructive/80 px-3 py-1.5 text-center text-xs text-white">
          {error}
        </div>
      )}
    </>
  );
}

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors",
        active ? "bg-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
