import { useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, RotateCcw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { HelpTopic } from "@/lib/setup-help";
import {
  findGuidePublicEvidence,
  GUIDE_PUBLIC_DOCS_VERIFIED_AT,
} from "../../../supabase/functions/_shared/cartel-guide-public-knowledge";

/**
 * G2B.1 — strictly local, read-only interaction prototype.
 * NOT an AI chatbot; no HTTP client, no Supabase request, no provider call.
 * UI is gated OFF in cartel-guide-ui-gate.ts. Keep production help unchanged.
 * The future provider-backed flow needs a separate approved integration.
 */
type Source = {
  articleId: string;
  title: string;
  summary: string;
  href: string;
  verifiedAt: string;
};
type Turn = { question: string; sources: Source[] };

const MAX_QUESTION_LENGTH = 500;
const MAX_TURNS = 5;
const QUESTION_SUGGESTIONS: Record<HelpTopic, string> = {
  general: "How do I create my project?",
  identity: "How do I set my project identity?",
  community: "How do I connect my Telegram group?",
  // No launch-specific article is in the audited eight-article pack yet.
  launch: "How do I set my project identity?",
  review: "How do I create my project?",
};

export default function GuideConversationPreview({ topic }: { topic: HelpTopic }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (normalized.length < 2 || normalized.length > MAX_QUESTION_LENGTH) return;

    const sources = findGuidePublicEvidence(normalized, 3).map(
      ({ articleId, title, summary, href, verifiedAt }) => ({
        articleId, title, summary, href, verifiedAt,
      }),
    );

    // Questions and citations live only in component memory, never stored,
    // reported as analytics, sent to a provider, or kept across panel unmounts.
    setTurns((prev) => [...prev, { question: normalized, sources }].slice(-MAX_TURNS));
    setQuestion("");
  }

  return (
    <section
      className="space-y-3 rounded-md border border-gold/30 bg-gold/5 p-3"
      aria-label="Cartel HQ Guide question preview"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpen className="size-4 shrink-0 text-gold" aria-hidden="true" />
            Ask Cartel HQ — preview
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This preview finds public Help Center articles. It does not generate
            AI answers or inspect your project, private messages, or account.
          </p>
        </div>
        {turns.length > 0 ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 shrink-0"
            onClick={() => setTurns([])}
            aria-label="Clear preview questions"
            title="Clear preview questions"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {turns.length ? (
        <div
          role="log"
          aria-label="Preview questions and Help Center references"
          aria-live="polite"
          aria-relevant="additions"
          className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border-subtle bg-background/70 p-2"
        >
          {turns.map((turn, index) => (
            <div key={index} className="space-y-2 border-b border-border-subtle pb-3 last:border-b-0 last:pb-0">
              <p className="break-words rounded-md bg-muted/50 px-3 py-2 text-sm text-foreground">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your question</span>
                {turn.question}
              </p>
              {turn.sources.length ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Related public documentation (not an AI answer):</p>
                  {turn.sources.map((source) => (
                    <a
                      key={source.articleId}
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 items-start justify-between gap-2 rounded-md border border-border-subtle bg-background px-3 py-2 hover:border-gold/40"
                    >
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-medium text-foreground">{source.title}</span>
                        <span className="block break-words text-xs text-muted-foreground">{source.summary}</span>
                      </span>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-gold" aria-hidden="true" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No matching articles in this limited preview. Try the full Help Center search below.
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="cartel-guide-preview-question" className="block text-xs font-medium text-foreground">
          Explore a setup question
        </label>
        <Textarea
          id="cartel-guide-preview-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={MAX_QUESTION_LENGTH}
          rows={2}
          placeholder={QUESTION_SUGGESTIONS[topic]}
          className="min-h-20 resize-y bg-background text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {question.length}/{MAX_QUESTION_LENGTH}
          </span>
          <Button
            type="submit"
            size="sm"
            className="min-h-11"
            disabled={question.trim().length < 2}
          >
            <Send className="size-4" aria-hidden="true" />
            Find guidance
          </Button>
        </div>
      </form>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Sources last reviewed {GUIDE_PUBLIC_DOCS_VERIFIED_AT}; screens may have changed.
        This is not a live AI feature and cannot take actions.
      </p>
    </section>
  );
}
