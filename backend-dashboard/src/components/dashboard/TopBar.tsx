import { motion } from "framer-motion";
import { Octagon, Pencil, Check, X } from "lucide-react";
import { useState } from "react";

import { EngramLogo } from "@/components/brand/EngramLogo";
import { cn } from "@/lib/utils";
import { useApiBase, useClearStop, useHealth, useRobotState, useStop } from "@/hooks/use-engram";

export function TopBar() {
  const [base, setBase] = useApiBase();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(base);
  const health = useHealth();
  const robot = useRobotState();
  const stop = useStop();

  const online = health.isSuccess && health.data?.ok;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2.5 md:px-6">
        <div className="flex min-h-[48px] items-center gap-3">
          <EngramLogo />
          <span className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground sm:inline">
            Control
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                autoFocus
                className="w-56 rounded-md border border-input bg-black/30 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring"
                placeholder="http://192.168.1.20:8000"
              />
              <button
                className="btn btn-ghost btn-icon !min-h-[36px] !w-9"
                aria-label="Save API URL"
                onClick={() => {
                  setBase(draft);
                  setEditing(false);
                }}
              >
                <Check className="size-4" />
              </button>
              <button
                className="btn btn-ghost btn-icon !min-h-[36px] !w-9"
                aria-label="Cancel"
                onClick={() => {
                  setDraft(base);
                  setEditing(false);
                }}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraft(base);
                setEditing(true);
              }}
              className="group hidden items-center gap-2 rounded-full border border-border bg-black/20 px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground sm:flex"
              title="Change the server address"
            >
              <StatusDot online={!!online} pending={health.isPending} />
              <span className="max-w-[220px] truncate">{base.replace(/^https?:\/\//, "")}</span>
              <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />
            </button>
          )}

          <div className="flex items-center gap-2 sm:hidden">
            <StatusDot online={!!online} pending={health.isPending} />
          </div>

          <button
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            className={cn(
              "btn !min-h-[48px] gap-2 font-semibold text-white",
              "bg-destructive shadow-[0_0_0_1px_oklch(0.65_0.2_25_/_0.6),0_10px_30px_-8px_oklch(0.65_0.2_25_/_0.6)]",
              "hover:brightness-110",
            )}
          >
            <Octagon className="size-4" aria-hidden />
            STOP
          </button>
        </div>
      </div>
      <StopBanner stopped={!!robot.data?.stopped} />
    </header>
  );
}

function StatusDot({ online, pending }: { online: boolean; pending: boolean }) {
  return (
    <span className="relative flex size-2.5">
      {online && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2.5 rounded-full",
          online ? "bg-emerald-400" : pending ? "bg-amber-400" : "bg-destructive",
        )}
      />
    </span>
  );
}

function StopBanner({ stopped }: { stopped: boolean }) {
  const clear = useClearStop();
  if (!stopped) return null;
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      className="overflow-hidden border-t border-destructive/40 bg-destructive/15"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-2 md:px-6">
        <Octagon className="size-4 text-destructive" />
        <span className="text-sm font-medium text-foreground">Robot stopped.</span>
        <button
          className="btn btn-ghost !min-h-[36px] ml-auto text-sm"
          disabled={clear.isPending}
          onClick={() => {
            if (window.confirm("Clear the stop and allow the robot to move again?")) clear.mutate();
          }}
        >
          Clear stop
        </button>
      </div>
    </motion.div>
  );
}
