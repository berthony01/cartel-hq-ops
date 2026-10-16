import { useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, RotateCcw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
import type { HelpTopic } from "@/lib/setup-help";

/**
 * G2E — Existing Cartel HQ Setup Help's conversational Guide.
 * REVIEW ONLY. Parent SetupHelpPanel gate remains hard OFF in all builds.
 * Never enables the provider by itself; server enforces Auth, Pro and budgets.
 * No model key, service-role credential, private project context or writes here.
 */
type Source = { title: string; href: string; verifiedAt: string };
type Turn = { question: string; answer: string; sources: Source[] };
type GuideReply = { code?: string; answer?: unknown; sources?: unknown };

const MAX_QUESTION_LENGTH = 500;
const MAX_TURNS = 5;
const QUESTION_SUGGESTIONS: Record<HelpTopic, string> = {
  general: "How do I create my project?",
  identity: "How do I set my project identity?",
  community: "How do I connect my Telegram group?",
  launch: "How do I set my launch schedule?",
  review: "How do I create my project?",
};
function safeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).filter((s): s is Source =>
    !!s && typeof s.title === "string" && s.title.length <= 160 &&
    typeof s.href === "string" && /^\/docs\?article=[a-z0-9-]{1,100}$/.test(s.href) &&
    typeof s.verifiedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.verifiedAt));
}
function userMessage(code: string): string {
  if (code === "ENTITLEMENT_NOT_CONFIGURED" || code === "ENTITLEMENT_DENIED")
    return "Conversational AI Guide is a Pro feature. You can still use the free Setup Help and Help Center.";
  if (code === "CUSTOMER_BUDGET_LIMIT" || code === "GLOBAL_BUDGET_LIMIT")
    return "This AI Guide allowance or budget is currently exhausted. Regular Setup Help remains available.";
  if (code === "NO_VERIFIED_HELP_ARTICLE")
    return "I couldn't find enough verified Help Center information. Try searching the Help Center below.";
  if (code === "PAID_CALLS_DISABLED" || code === "GUIDE_NOT_ENABLED")
    return "Conversational AI is not available yet. Use the regular Setup Help below.";
  if (code === "FORBIDDEN" || code === "MANAGED_SCOPE_NOT_VERIFIED")
    return "You don't have permission to ask the AI Guide about this project.";
  return "The AI Guide is temporarily unavailable. Please use the Help Center below.";
}

export default function GuideConversationPreview({ topic }: { topic: HelpTopic }) {
  const { workspaceId, isManaged } = useWorkspace();
  const { session } = useSession();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !workspaceId || !session || isManaged) return;
    const normalized = question.trim();
    if (normalized.length < 2 || normalized.length > MAX_QUESTION_LENGTH) return;
    setBusy(true);
    setMessage("");
    try {
      // One deliberate submission => one fresh requestId, no automatic retries.
      const { data, error } = await supabase.functions.invoke("cartel-guide", {
        body: {
          question: normalized,
          selectedWorkspaceId: workspaceId,
          requestId: crypto.randomUUID(),
        },
      });
      if (error) {
        // Never render raw server/SDK error text, which may contain details.
        let code = "";
        const context = "context" in error ? error.context : null;
        if (context instanceof Response) {
          try {
            const json: unknown = await context.json();
            if (json && typeof json === "object" && "code" in json &&
                typeof json.code === "string") code = json.code;
          } catch { /* failed response parse: show safe generic message */ }
        }
        setMessage(userMessage(code));
        return;
      }
      const payload = data as GuideReply | null;
      if (!payload || payload.code !== "OK" ||
          typeof payload.answer !== "string" || !payload.answer.trim() ||
          payload.answer.length > 4000) {
        setMessage(userMessage(""));
        return;
      }
      setTurns((prev) => [...prev, {
        question: normalized,
        answer: payload.answer as string,
        sources: safeSources(payload.sources),
      }].slice(-MAX_TURNS));
      setQuestion("");
    } catch {
      setMessage(userMessage(""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-gold/30 bg-gold/5 p-3"
      aria-label="Cartel HQ AI Guide">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpen className="size-4 shrink-0 text-gold" aria-hidden="true" />
            Ask Cartel HQ AI — Pro
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ask about setting up Cartel HQ. Answers are grounded in the public Help Center,
            which may not reflect the newest screens. This Guide cannot take actions.
          </p>
          <p className="text-[11px] text-muted-foreground">
            AI questions can use your workspace's shared monthly Pro allowance.
            Do not include passwords, wallet secrets or private community information.
          </p>
        </div>
        {turns.length > 0 && (
          <Button type="button" size="icon" variant="ghost"
            className="size-11 shrink-0" onClick={() => { setTurns([]); setMessage(""); }}
            aria-label="Clear Guide conversation" title="Clear conversation"
            disabled={busy}>
            <RotateCcw className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {!!turns.length && (
        <div role="log" aria-label="AI Guide questions and answers"
          aria-live="polite" aria-relevant="additions"
          className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-border-subtle bg-background/70 p-2">
          {turns.map((turn, index) => (
            <div key={index} className="space-y-2 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0">
              <p className="break-words rounded-md bg-muted/50 px-3 py-2 text-sm">{turn.question}</p>
              <p className="whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm text-foreground">
                {turn.answer}
              </p>
              {turn.sources.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Public Help Center references</p>
                  {turn.sources.map((source) => (
                    <a key={source.href} href={source.href} target="_blank" rel="noopener noreferrer"
                      className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border-subtle bg-background px-3 py-2 text-xs hover:border-gold/40">
                      <span className="min-w-0 break-words">{source.title}</span>
                      <ArrowRight className="size-4 shrink-0 text-gold" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="cartel-guide-preview-question" className="block text-xs font-medium text-foreground">
          Ask a setup question
        </label>
        <Textarea id="cartel-guide-preview-question" value={question}
          onChange={(e) => setQuestion(e.target.value)} maxLength={MAX_QUESTION_LENGTH}
          rows={2} placeholder={QUESTION_SUGGESTIONS[topic]}
          className="min-h-20 resize-y bg-background text-sm" disabled={busy} />
        {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{question.length}/{MAX_QUESTION_LENGTH}</span>
          <Button type="submit" size="sm" className="min-h-11"
            disabled={busy || !session || !workspaceId || isManaged || question.trim().length < 2}>
            <Send className="size-4" aria-hidden="true" />
            {busy ? "Checking…" : "Ask AI Guide"}
          </Button>
        </div>
      </form>
      <p className="text-[11px] text-muted-foreground">
        Only public Help Center text is provided as grounding. Your question is sent to Kie.ai
        only after you submit and the server authorizes a paid request.
      </p>
    </section>
  );
}
