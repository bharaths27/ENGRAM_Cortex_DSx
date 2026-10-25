import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Mic, MicOff, Send, Sparkles } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { CommandResult, Proposal } from "@/lib/engram";
import { useSendCommand, useTeach } from "@/hooks/use-engram";
import { useSpeech } from "@/hooks/use-speech";

export function AskPanel({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [teachOpen, setTeachOpen] = useState(false);
  const send = useSendCommand();

  const speech = useSpeech((heard) => {
    setText((prev) => (prev ? prev + " " : "") + heard);
  });

  function handleResult(r: CommandResult) {
    if (r.kind === "proposal") {
      onProposal(r as Proposal);
      setNotice(null);
    } else if (r.kind === "taught") {
      const n = r.rules?.length ?? 0;
      setNotice(`Learned it${n ? ` — found ${n} rule${n > 1 ? "s" : ""}` : ""}.`);
    } else if (r.kind === "scheduled") {
      setNotice(
        r.created
          ? `Saved for later: when ${r.trigger}, ${r.request}`
          : "Already saved for later.",
      );
    }
  }

  function submit() {
    const t = text.trim();
    if (!t) return;
    if (speech.listening) speech.stop();
    send.mutate(
      { text: t },
      {
        onSuccess: (r) => {
          handleResult(r);
          setText("");
        },
      },
    );
  }

  return (
    <section className="card-stage flex flex-col gap-3 p-4">
      <PanelTitle icon={<Sparkles className="size-4" />}>Ask</PanelTitle>

      <div className="flex items-end gap-2">
        <textarea
          value={speech.listening && speech.interim ? `${text} ${speech.interim}`.trim() : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={'Try "Bring Sample B to the bench" or "remember goggles live at the PPE station"'}
          className="min-h-[56px] flex-1 resize-none rounded-xl border border-input bg-black/25 px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
        />
        {speech.supported && (
          <button
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            className={cn("btn btn-icon shrink-0", speech.listening ? "btn-active animate-pulse" : "btn-ghost")}
            aria-label={speech.listening ? "Stop listening" : "Speak"}
            title={speech.listening ? "Listening… tap to stop" : "Tap and speak"}
          >
            {speech.listening ? <Mic className="size-5" /> : <MicOff className="size-5" />}
          </button>
        )}
        <button
          onClick={submit}
          disabled={send.isPending || !text.trim()}
          className="btn btn-primary btn-icon shrink-0"
          aria-label="Send"
        >
          <Send className="size-5" />
        </button>
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setTeachOpen(true)} className="btn btn-ghost !min-h-[40px] gap-2 text-sm">
          <BookOpen className="size-4" /> Teach a document
        </button>
        {send.isPending && <span className="text-xs text-muted-foreground">Thinking…</span>}
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      {send.isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {(send.error as Error).message}
        </div>
      )}

      <TeachDialog open={teachOpen} onClose={() => setTeachOpen(false)} />
    </section>
  );
}

function TeachDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const teach = useTeach();

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card-stage w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">Teach a document</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a procedure or note. ENGRAM stores it and pulls out rules, with a link back to the source.
        </p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. SOP 004)"
          className="mt-4 w-full rounded-lg border border-input bg-black/25 px-3 py-2 text-sm outline-none focus:border-ring"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="The text of the procedure…"
          className="mt-2 w-full resize-none rounded-lg border border-input bg-black/25 px-3 py-2 text-sm outline-none focus:border-ring"
        />
        {teach.isSuccess && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Saved. Found {teach.data.rules.length} rule(s).
          </div>
        )}
        {teach.isError && (
          <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
            {(teach.error as Error).message}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost !min-h-[44px]" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn-primary !min-h-[44px]"
            disabled={teach.isPending || !title.trim() || !body.trim()}
            onClick={() => teach.mutate({ title: title.trim(), text: body.trim() })}
          >
            {teach.isPending ? "Saving…" : "Teach it"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function PanelTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
      {icon && <span className="text-brand">{icon}</span>}
      {children}
    </div>
  );
}
