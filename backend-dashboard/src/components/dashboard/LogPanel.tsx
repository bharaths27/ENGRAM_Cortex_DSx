import { Activity, ClipboardList, ShieldCheck } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PanelTitle } from "@/components/dashboard/AskPanel";
import { cn } from "@/lib/utils";
import { useEvents, useMetrics, useProspective } from "@/hooks/use-engram";

const STATUS_COLOR: Record<string, string> = {
  done: "text-emerald-300",
  failed: "text-destructive-foreground",
  unknown: "text-amber-300",
  rejected: "text-muted-foreground",
  pending: "text-sky-300",
};

function clock(at: number): string {
  const d = new Date(at * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LogPanel() {
  const metricsQ = useMetrics();
  const eventsQ = useEvents(30);
  const prospectiveQ = useProspective();

  const runs = (metricsQ.data?.runs ?? []).map((r, i) => ({
    name: String(i + 1),
    planner_calls: r.planner_calls,
    skill: !!r.skill_id,
  }));
  const events = eventsQ.data ?? [];
  const tasks = prospectiveQ.data ?? [];

  return (
    <section className="card-stage flex flex-col gap-4 p-4">
      <PanelTitle icon={<Activity className="size-4" />}>Proof &amp; Log</PanelTitle>

      <div className="rounded-lg border border-border bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Planner calls per run
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
              metricsQ.data?.model_unchanged
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-destructive/20 text-destructive-foreground",
            )}
          >
            <ShieldCheck className="size-3" />
            Model files {metricsQ.data?.model_unchanged ? "unchanged" : "changed"}
          </span>
        </div>
        {runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="h-28 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={runs} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  cursor={{ fill: "oklch(1 0 0 / 0.04)" }}
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="planner_calls" radius={[4, 4, 0, 0]} maxBarSize={28}>
                  {runs.map((r, i) => (
                    <Cell key={i} fill={r.skill ? "oklch(0.72 0.17 150)" : "var(--brand)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Orange = planned now · green = ran a learned skill (0 calls).
        </p>
      </div>

      {tasks.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Future tasks</h4>
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border bg-black/20 px-3 py-1.5 text-sm">
              <span className="flex-1 truncate text-foreground">
                when <span className="text-muted-foreground">{t.trigger}</span> → {t.request}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px]",
                  t.status === "waiting" ? "bg-sky-500/20 text-sky-300" : "bg-emerald-500/20 text-emerald-300",
                )}
              >
                {t.status}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ClipboardList className="size-3.5" /> Journal
        </h4>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-black/20">
          {events.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {events.map((e) => (
                  <tr key={e.seq} className="border-b border-border/50 last:border-0">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-muted-foreground">{clock(e.at)}</td>
                    <td className="px-2 py-1.5 font-mono text-foreground">{e.op}</td>
                    <td className={cn("px-3 py-1.5 text-right font-medium", STATUS_COLOR[e.status] ?? "text-muted-foreground")}>
                      {e.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
