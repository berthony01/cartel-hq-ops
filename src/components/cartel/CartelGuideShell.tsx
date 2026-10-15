import { useState, type FormEvent } from "react";
import { ArrowRight, Bot, Lock, Send } from "lucide-react";

import {
  GUIDE_DISABLED_MESSAGE,
  GUIDE_QUESTION_MAX_LENGTH,
  GUIDE_SAMPLE_QUESTION,
  submitGuideQuestion,
} from "@/lib/cartel-guide-contract";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/**
 * G2E HARD-OFF SWITCH. Must stay `false` until a separately authorized release.
 * While false, no code path in this file can reach the network: the backend
 * client is only dynamically imported inside `dispatchGuideRequest`, which
 * returns before that import whenever this flag is false.
 */
export const G2E_LIVE_ENABLED = false as boolean;

// Example prompts drawn from existing Help Center topics (welcome-message, connect-group, share-watchlist).
const EXAMPLES = [
  GUIDE_SAMPLE_QUESTION,
  "How do I connect my Telegram group to Cartel HQ?",
  "How do I share my launch watchlist link?",
] as const;

const MAX_TURNS = 5;
const MAX_ANSWER_LENGTH = 4000;
const MAX_SOURCES = 3;

type Source = { title: string; href: string };
type Turn = { question: string; answer: string; sources: Source[] };
type GuideOutcome = { ok: true; answer: string; sources: Source[] } | { ok: false; code: string };

/** Keeps at most 3 public Help Center links; drops anything else. */
function safeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const out: Source[] = [];
  for (const s of value) {
    if (out.length >= MAX_SOURCES) break;
    if (
      s && typeof s === "object" &&
      typeof (s as Source).title === "string" && (s as Source).title.length > 0 && (s as Source).title.length <= 160 &&
      typeof (s as Source).href === "string" && /^\/docs\?article=[a-z0-9-]{1,100}$/.test((s as Source).href)
    ) {
      out.push({ title: (s as Source).title, href: (s as Source).href });
    }
  }
  return out;
}

/** Fixed, safe labels only. Raw server text is never shown. */
function userMessage(code: string): string {
  if (code === "ENTITLEMENT_NOT_CONFIGURED" || code === "ENTITLEMENT_DENIED")
    return "Conversational AI Guide is a Pro feature. You can still use the free Setup Help and Help Center.";
  if (code === "CUSTOMER_BUDGET_LIMIT" || code === "GLOBAL_BUDGET_LIMIT")
    return "This AI Guide allowance or budget is currently exhausted. Regular Setup Help remains available.";
  if (code === "NO_VERIFIED_HELP_ARTICLE")
    return "I couldn't find enough verified Help Center information. Try the Setup Help tab.";
  if (code === "PAID_CALLS_DISABLED" || code === "GUIDE_NOT_ENABLED")
    return "Conversational AI is not available yet. Use the regular Setup Help.";
  if (code === "FORBIDDEN" || code === "MANAGED_SCOPE_NOT_VERIFIED")
    return "You don't have permission to ask the AI Guide about this project.";
  return "The AI Guide is temporarily unavailable. Please use the Setup Help tab.";
}

/**
 * Dormant request path. One call => at most one invoke, fresh requestId, no retry.
 * Payload is exactly { question, selectedWorkspaceId, requestId }.
 */
async function dispatchGuideRequest(question: string, selectedWorkspaceId: string): Promise<GuideOutcome> {
  if (!G2E_LIVE_ENABLED) return { ok: false, code: "GUIDE_NOT_ENABLED" };
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("cartel-guide", {
      body: { question, selectedWorkspaceId, requestId: crypto.randomUUID() },
    });
    if (error) {
      let code = "";
      const context = "context" in error ? (error as { context?: unknown }).context : null;
      if (context instanceof Response) {
        try {
          const json: unknown = await context.json();
          if (json && typeof json === "object" && "code" in json && typeof json.code === "string") code = json.code;
        } catch { /* generic message */ }
      }
      return { ok: false, code };
    }
    const p = data as { code?: unknown; answer?: unknown; sources?: unknown } | null;
    if (!p || p.code !== "OK" || typeof p.answer !== "string" || !p.answer.trim() || p.answer.length > MAX_ANSWER_LENGTH) {
      return { ok: false, code: "" };
    }
    return { ok: true, answer: p.answer, sources: safeSources(p.sources) };
  } catch {
    return { ok: false, code: "" };
  }
}

/** Owner-only preview. While G2E_LIVE_ENABLED is false it makes no network, backend or AI calls. */
export default function CartelGuideShell() {
  const { workspaceId, isManaged } = useWorkspace();
  const { session } = useSession();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!G2E_LIVE_ENABLED) {
      submitGuideQuestion(text);
      setNotice(true);
      return;
    }
    if (busy || !workspaceId || !session || isManaged) {
      setMessage(userMessage("FORBIDDEN"));
      return;
    }
    const q = text.trim();
    if (q.length < 2 || q.length > GUIDE_QUESTION_MAX_LENGTH) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await dispatchGuideRequest(q, workspaceId);
      if (!r.ok) {
        setMessage(userMessage(r.code));
        return;
      }
      setTurns((prev) => [...prev, { question: q, answer: r.answer, sources: r.sources }].slice(-MAX_TURNS));
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="AI Guide preview">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bot className="size-5 text-gold" aria-hidden="true" /> AI Guide
        </p>
        <span className="inline-flex items-center gap-1 border border-gold/50 bg-gold/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gold">
          <Lock className="size-3" aria-hidden="true" /> Preview · Off
        </span>
      </div>

      <div className="border border-border-subtle bg-card p-3">
        <p className="text-sm leading-relaxed text-foreground">
          Soon you'll be able to ask setup questions in plain words here. For now this is a layout preview only.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground" role="note">{GUIDE_DISABLED_MESSAGE}</p>
      </div>

      <div className="space-y-2">
        <p className="type-eyebrow text-muted-foreground">Try an example (fills the box only)</p>
        <ul className="space-y-2">
          {EXAMPLES.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => { setText(q); setNotice(false); }}
                className="min-h-11 w-full border border-border-subtle bg-background px-3 py-2 text-left text-sm text-foreground hover:border-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {G2E_LIVE_ENABLED && turns.length > 0 ? (
        <div role="log" aria-label="AI Guide questions and answers" aria-live="polite" className="max-h-80 space-y-3 overflow-y-auto border border-border-subtle bg-background p-2">
          {turns.map((turn, i) => (
            <div key={i} className="space-y-2 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0">
              <p className="break-words bg-card px-3 py-2 text-sm text-foreground">{turn.question}</p>
              <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm text-foreground">{turn.answer}</p>
              {turn.sources.map((s) => (
                <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-between gap-2 border border-border-subtle px-3 py-2 text-xs text-foreground hover:border-gold/40">
                  <span className="min-w-0 break-words">{s.title}</span>
                  <ArrowRight className="size-4 shrink-0 text-gold" aria-hidden="true" />
                </a>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <form className="space-y-2" onSubmit={onSubmit}>
        <label htmlFor="cartel-guide-question" className="type-eyebrow text-foreground">Your question</label>
        <Textarea
          id="cartel-guide-question"
          value={text}
          maxLength={GUIDE_QUESTION_MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a question to preview the layout"
          disabled={busy}
          className="min-h-24 border-gold/40 bg-background text-foreground placeholder:text-muted-foreground"
        />
        <Button
          type="submit"
          variant="outline"
          aria-describedby="cartel-guide-off"
          disabled={busy}
          className="min-h-11 w-full border-dashed text-muted-foreground"
        >
          <Lock className="size-4" aria-hidden="true" /> Sending is off in preview
          <Send className="size-4 opacity-40" aria-hidden="true" />
        </Button>
        <p id="cartel-guide-off" className="text-xs text-muted-foreground" aria-live="polite">
          {G2E_LIVE_ENABLED && message
            ? message
            : notice ? "Not sent. Nothing left this page — the AI Guide is not active yet." : "Nothing you type is sent anywhere."}
        </p>
      </form>
    </section>
  );
}
