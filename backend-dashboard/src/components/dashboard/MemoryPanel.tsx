import { motion } from "framer-motion";
import { Boxes, FileText } from "lucide-react";
import { useState } from "react";

import { PanelTitle } from "@/components/dashboard/AskPanel";
import { cn } from "@/lib/utils";
import { api, zoneLabel, type Evidence, type Fact, type ObjectRow } from "@/lib/engram";
import { useApiBase, useFacts, useObjects } from "@/hooks/use-engram";

const ZONES = ["home", "shelf_A", "shelf_B", "ppe_station", "bench"];
// Top-down layout of the table (percent positions of each zone's centre).
const ZONE_POS: Record<string, { x: number; y: number }> = {
  home: { x: 18, y: 78 },
  shelf_A: { x: 20, y: 24 },
  shelf_B: { x: 80, y: 24 },
  ppe_station: { x: 82, y: 78 },
  bench: { x: 50, y: 52 },
};

export function MemoryPanel() {
  const objectsQ = useObjects();
  const objects = objectsQ.data ?? [];
  return (
    <section className="card-stage flex flex-col gap-4 p-4">
      <PanelTitle icon={<Boxes className="size-4" />}>Memory</PanelTitle>
      <ZoneMap objects={objects} />
      <div className="space-y-2">
        {objects.map((o) => (
          <ObjectRowCard key={o.object_id} obj={o} />
        ))}
        {objects.length === 0 && (
          <p className="text-sm text-muted-foreground">No objects bound yet.</p>
        )}
      </div>
      <Facts objects={objects} />
    </section>
  );
}

function ZoneMap({ objects }: { objects: ObjectRow[] }) {
  const byZone: Record<string, ObjectRow[]> = {};
  for (const o of objects) {
    if (!o.last_zone) continue;
    (byZone[o.last_zone] ??= []).push(o);
  }
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border bg-black/30 bg-blueprint">
      {ZONES.map((z) => {
        const pos = ZONE_POS[z] ?? { x: 50, y: 50 };
        return (
          <div
            key={z}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border/70 px-2 py-1 text-center"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {zoneLabel(z)}
            </span>
            <div className="mt-1 flex flex-wrap justify-center gap-1">
              {(byZone[z] ?? []).map((o) => (
                <span
                  key={o.object_id}
                  title={o.statement}
                  className={cn(
                    "size-3 rounded-full ring-2 ring-background",
                    o.freshness <= 0 ? "bg-steel" : "bg-brand",
                  )}
                  style={{ opacity: o.freshness <= 0 ? 0.6 : 0.5 + o.freshness * 0.5 }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ObjectRowCard({ obj }: { obj: ObjectRow }) {
  const pct = Math.round(obj.freshness * 100);
  const stale = obj.freshness <= 0;
  return (
    <div className="rounded-lg border border-border bg-black/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{obj.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{zoneLabel(obj.last_zone)}</span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn("h-full rounded-full transition-all", stale ? "bg-steel" : "bg-emerald-400")}
          style={{ width: `${Math.max(pct, stale ? 100 : 6)}%`, opacity: stale ? 0.5 : 1 }}
        />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{obj.statement}</p>
    </div>
  );
}

function pretty(token: string, objects: ObjectRow[]): string {
  const match = objects.find((o) => o.object_id === token);
  if (match) return match.name;
  return token
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function Facts({ objects }: { objects: ObjectRow[] }) {
  const factsQ = useFacts();
  const [base] = useApiBase();
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(false);

  const facts = (factsQ.data ?? []).filter((f: Fact) => f.predicate === "requires_before");
  if (facts.length === 0) return null;

  async function openEvidence(chunkId: string | null) {
    if (!chunkId) return;
    setOpenChunk(chunkId);
    setLoading(true);
    try {
      const ev = await api<Evidence>(base, `/evidence/${chunkId}`);
      setEvidence(ev);
    } catch {
      setEvidence(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rules</h4>
      {facts.map((f) => (
        <button
          key={f.id}
          onClick={() => f.chunk_id && openEvidence(f.chunk_id)}
          disabled={!f.chunk_id}
          className="part-row w-full justify-between text-sm disabled:cursor-default"
        >
          <span className="text-foreground">
            <span className="font-medium">{pretty(f.subject, objects)}</span> needs{" "}
            <span className="font-medium">{pretty(f.object, objects)}</span> first
          </span>
          {f.chunk_id && <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
        </button>
      ))}

      {openChunk && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setOpenChunk(null)}>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-stage w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 text-sm text-brand">
              <FileText className="size-4" />
              {evidence ? `${evidence.title}${evidence.section ? ` · ${evidence.section}` : ""}` : "Source"}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {loading ? "Loading…" : evidence ? evidence.text : "Could not load the source text."}
            </p>
            <div className="mt-4 flex justify-end">
              <button className="btn btn-ghost !min-h-[40px]" onClick={() => setOpenChunk(null)}>
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
