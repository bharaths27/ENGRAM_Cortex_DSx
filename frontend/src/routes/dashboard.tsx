import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard · ENGRAM Rover" },
      { name: "description", content: "Live dashboard for the ENGRAM rover's onboard computer." },
      { property: "og:title", content: "ENGRAM Rover Dashboard" },
      {
        property: "og:description",
        content: "Live dashboard for the ENGRAM rover's onboard computer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

// Where the ENGRAM console (FastAPI: plans, hold-to-approve, STOP, camera, voice) runs.
// Order: ?console=<url> in the address bar, then the last one used, then VITE_CONSOLE_URL, then localhost.
const DEFAULT_CONSOLE =
  (import.meta.env["VITE_CONSOLE_URL"] as string | undefined) ?? "http://localhost:8000";

function pickConsoleUrl(): string {
  if (typeof window === "undefined") return DEFAULT_CONSOLE;
  const fromQuery = new URLSearchParams(window.location.search).get("console");
  try {
    if (fromQuery) {
      localStorage.setItem("engram.consoleUrl", fromQuery);
      return fromQuery;
    }
    return localStorage.getItem("engram.consoleUrl") || DEFAULT_CONSOLE;
  } catch {
    return fromQuery || DEFAULT_CONSOLE;
  }
}

type Status = "connecting" | "online" | "offline";

function Dashboard() {
  const [url, setUrl] = useState(DEFAULT_CONSOLE);
  const [status, setStatus] = useState<Status>("connecting");
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    const u = pickConsoleUrl();
    setUrl(u);
  }, []);

  // Liveness check against the console's /health. no-cors: any answer means the server is up.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 3000);
        await fetch(url.replace(/\/$/, "") + "/health", { mode: "no-cors", signal: ctl.signal });
        clearTimeout(t);
        if (alive) setStatus("online");
      } catch {
        if (alive) setStatus("offline");
      }
    };
    setStatus("connecting");
    check();
    const id = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [url, frameKey]);

  return (
    <div className="relative flex h-screen flex-col bg-background">
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <section id="dashboard-slot" className="relative min-h-0 flex-1">
          <iframe
            key={frameKey}
            src={url}
            title="ENGRAM Cortex console: plans, approvals, STOP"
            className="absolute inset-0 h-full w-full border-0"
            allow="microphone; camera; autoplay; fullscreen"
          />
          {status === "offline" && (
            <div className="absolute inset-0 grid place-items-center bg-background/90 p-8 text-center">
              <div className="max-w-md">
                <h2 className="text-lg font-semibold">Console not reachable</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Start it with <code className="font-mono">./scripts/run.sh</code> in the
                  engram-console folder, then reload this page. Current address:{" "}
                  <code className="font-mono">{url}</code>
                </p>
              </div>
            </div>
          )}
        </section>
      </motion.main>

      {/* Continues the black screen from the rover's zoom-in, then fades away. */}
      <motion.div
        className="pointer-events-none fixed inset-0 z-50 bg-void"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        aria-hidden
      />
    </div>
  );
}
