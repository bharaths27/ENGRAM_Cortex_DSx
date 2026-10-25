import type { ReactNode } from "react";
import { Crosshair, Hand, Home, MapPin, Navigation } from "lucide-react";

import { PanelTitle } from "@/components/dashboard/AskPanel";
import { cn } from "@/lib/utils";
import { zoneLabel, type Proposal } from "@/lib/engram";
import { useProposeRest, useRobotState } from "@/hooks/use-engram";

const ZONES = ["home", "shelf_A", "shelf_B", "ppe_station", "bench"];

export function MovePanel({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const rest = useProposeRest();
  const robotQ = useRobotState();
  const robot = robotQ.data;

  function go(zone: string) {
    rest.mutate({ zone }, { onSuccess: (p) => onProposal(p) });
  }

  return (
    <section className="card-stage flex flex-col gap-3 p-4">
      <PanelTitle icon={<Navigation className="size-4" />}>Move</PanelTitle>

      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
        <Stat icon={<MapPin className="size-3.5" />} label="At" value={zoneLabel(robot?.at_zone)} />
        <Stat icon={<Hand className="size-3.5" />} label="Holding" value={robot?.holding ? robot.holding.replace(/_/g, " ") : "—"} />
        <Stat icon={<Crosshair className="size-3.5" />} label="Gripper" value={robot?.gripper_open === undefined ? "—" : robot.gripper_open ? "Open" : "Closed"} />
      </div>

      <p className="text-xs text-muted-foreground">
        Pick a destination — it becomes a plan you approve before the robot drives.
      </p>
      <div className="flex flex-wrap gap-2">
        {ZONES.map((z) => (
          <button
            key={z}
            onClick={() => go(z)}
            disabled={rest.isPending}
            className={cn("btn btn-ghost !min-h-[42px] text-sm", robot?.at_zone === z && "btn-active")}
          >
            {z === "home" && <Home className="size-4" />}
            {zoneLabel(z)}
          </button>
        ))}
      </div>
      {rest.isError && <p className="text-xs text-destructive-foreground">{(rest.error as Error).message}</p>}
      {robot?.adapter === "mock" && (
        <p className="text-[11px] text-muted-foreground">Fake robot (no MasterPi connected) — set ENGRAM_ROBOT_URL for the real one.</p>
      )}
    </section>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-black/20 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-medium capitalize text-foreground">{value}</div>
    </div>
  );
}
