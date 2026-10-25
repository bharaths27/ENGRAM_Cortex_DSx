import { BrainCircuit, Sparkles } from "lucide-react";

import { PanelTitle } from "@/components/dashboard/AskPanel";
import { cn } from "@/lib/utils";
import type { Skill } from "@/lib/engram";
import { useDream, useSkillAction, useSkills } from "@/hooks/use-engram";

const CHIP: Record<Skill["status"], string> = {
  CANDIDATE: "bg-muted text-muted-foreground",
  TESTED: "bg-sky-500/20 text-sky-300",
  APPROVED: "bg-emerald-500/20 text-emerald-300",
  REVOKED: "bg-destructive/20 text-destructive-foreground",
};

export function SkillsPanel() {
  const skillsQ = useSkills();
  const act = useSkillAction();
  const dream = useDream();
  const skills = skillsQ.data ?? [];

  return (
    <section className="card-stage flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <PanelTitle icon={<BrainCircuit className="size-4" />}>Skills</PanelTitle>
        <button
          onClick={() => dream.mutate()}
          disabled={dream.isPending}
          className="btn btn-ghost !min-h-[38px] gap-1.5 text-sm"
          title="Turn successful runs into candidate skills"
        >
          <Sparkles className="size-4" />
          {dream.isPending ? "Dreaming…" : "Dream"}
        </button>
      </div>

      {dream.isSuccess && (
        <p className="text-xs text-muted-foreground">
          Made {dream.data.candidates.length} candidate skill{dream.data.candidates.length === 1 ? "" : "s"}.
        </p>
      )}

      {skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No skills yet. Run a task, then press Dream.</p>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border bg-black/20 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                <div className="font-mono text-[11px] text-muted-foreground">v{s.version}</div>
              </div>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CHIP[s.status])}>
                {s.status}
              </span>
              {s.status === "CANDIDATE" && (
                <button className="btn btn-ghost !min-h-[34px] text-xs" onClick={() => act.mutate({ id: s.id, action: "test" })}>
                  Test
                </button>
              )}
              {s.status === "TESTED" && (
                <button
                  className="btn btn-primary !min-h-[34px] text-xs"
                  onClick={() => act.mutate({ id: s.id, action: "approve", digest: s.digest })}
                >
                  Approve
                </button>
              )}
              {s.status === "APPROVED" && (
                <button className="btn btn-ghost !min-h-[34px] text-xs" onClick={() => act.mutate({ id: s.id, action: "revoke" })}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {act.isError && (
        <p className="text-xs text-destructive-foreground">{(act.error as Error).message}</p>
      )}
    </section>
  );
}
