import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, CircleSlash, Play, Quote, X, XCircle } from "lucide-react";
import { Fragment } from "react";

import { PanelTitle } from "@/components/dashboard/AskPanel";
import { cn } from "@/lib/utils";
import { stepText, type Proposal } from "@/lib/engram";
import { useApprove, useObjects } from "@/hooks/use-engram";

const STOP = new Set([
  "the", "a", "an", "to", "of", "and", "or", "for", "me", "my", "is", "it", "in",
  "on", "do", "get", "need", "bring", "please", "before", "with", "that", "this", "at", "from",
]);

function highlight(text: string, goal: string) {
  const words = new Set(
    goal.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [],
  );
  if (words.size === 0) return text;
  const parts = text.split(/(\b)/);
  return parts.map((p, i) =>
    words.has(p.toLowerCase()) ? (
      <mark key={i} className="rounded bg-brand/25 px-0.5 text-foreground">
        {p}
      </mark>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

export function PlanCard({ proposal, onClear }: { proposal: Proposal | null; onClear: () => void }) {
  const approve = useApprove();
  const objectsQ = useObjects();
  const objects = objectsQ.data ?? [];

  if (!proposal) {
    return (
      <section className="card-stage flex min-h-[140px] flex-col gap-3 p-4">
        <PanelTitle icon={<Play className="size-4" />}>Plan</PanelTitle>
        <div className="grid flex-1 place-items-center text-center text-sm text-muted-foreground">
          Ask for a task or pick a move. The plan appears here for you to approve before anything moves.
        </div>
      </section>
    );
  }

  const run = approve.data;
  const used = approve.isSuccess || approve.isPending;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-stage flex flex-col gap-3 p-4"
    >
      <div className="flex items-center justify-between">
        <PanelTitle icon={<Play className="size-4" />}>Plan</PanelTitle>
        <button onClick={onClear} className="btn btn-ghost btn-icon !min-h-[32px] !w-8" aria-label="Dismiss plan">
          <X className="size-4" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">{proposal.plan?.goal ?? "Request"}</span>
      </p>

      {proposal.status === "refused" && (
        <Box tone="amber" icon={<CircleSlash className="size-4" />}>
          {proposal.reason || "This request was refused."}
        </Box>
      )}

      {proposal.status === "rejected" && (
        <Box tone="red" icon={<XCircle className="size-4" />}>
          <ul className="list-disc space-y-1 pl-4">
            {(proposal.check?.errors ?? ["The safety checker rejected this plan."]).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Box>
      )}

      {proposal.status === "proposed" && proposal.plan && (
        <>
          <ol className="space-y-1.5">
            {proposal.plan.steps.map((s, i) => {
              const stepRun = run?.steps?.[i];
              return (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-border bg-black/20 px-3 py-2 text-sm"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand/15 font-mono text-xs text-brand">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-foreground">{stepText(s, objects)}</span>
                  {stepRun && <StepBadge status={stepRun.status} />}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                proposal.source === "skill"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-brand/15 text-accent-foreground",
              )}
            >
              {proposal.source === "skill"
                ? "Using a learned skill · 0 planner calls"
                : `Planned now · ${proposal.planner_calls ?? 0} planner call${proposal.planner_calls === 1 ? "" : "s"}`}
            </span>
          </div>

          {proposal.memory?.evidence && proposal.memory.evidence.length > 0 && (
            <details className="group rounded-lg border border-border bg-black/15 px-3 py-2" open>
              <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Why
              </summary>
              <div className="mt-2 space-y-2">
                {proposal.memory.evidence.map((ev) => (
                  <div key={ev.chunk_id} className="rounded-md border border-border/60 bg-black/20 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs text-brand">
                      <Quote className="size-3" />
                      {ev.title}
                      {ev.section ? ` · ${ev.section}` : ""}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {highlight(ev.text, proposal.plan!.goal)}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}

          {proposal.check?.warnings && proposal.check.warnings.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-300/90">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{proposal.check.warnings.join("; ")}</span>
            </div>
          )}

          {run ? (
            <RunOutcome outcome={run.outcome} failure={run.failure ?? null} onClear={onClear} />
          ) : (
            <button
              className="btn btn-primary !min-h-[52px] w-full gap-2 text-base"
              disabled={used || !proposal.digest}
              onClick={() =>
                approve.mutate({ operationId: proposal.operation_id, digest: proposal.digest! })
              }
            >
              <CheckCircle2 className="size-5" />
              {approve.isPending ? "Running…" : "Approve and run"}
            </button>
          )}

          {approve.isError && (
            <Box tone="red" icon={<XCircle className="size-4" />}>
              {(approve.error as Error).message}
            </Box>
          )}
        </>
      )}
    </motion.section>
  );
}

function RunOutcome({
  outcome,
  failure,
  onClear,
}: {
  outcome: string;
  failure?: string | null;
  onClear: () => void;
}) {
  const ok = outcome === "success";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        ok
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : "border-destructive/50 bg-destructive/10 text-destructive-foreground",
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        {ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {ok ? "Done" : outcome === "aborted" ? "Stopped" : "Failed"}
      </div>
      {failure && <p className="mt-1 leading-relaxed">{failure}</p>}
      <button className="btn btn-ghost !min-h-[38px] mt-2 text-sm" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

function StepBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: "bg-emerald-500/20 text-emerald-300",
    failed: "bg-destructive/20 text-destructive-foreground",
    unknown: "bg-amber-500/20 text-amber-300",
    rejected: "bg-muted text-muted-foreground",
    pending: "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", map[status] ?? "bg-muted")}>
      {status}
    </span>
  );
}

function Box({
  tone,
  icon,
  children,
}: {
  tone: "amber" | "red";
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        tone === "amber"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
          : "border-destructive/50 bg-destructive/10 text-destructive-foreground",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
