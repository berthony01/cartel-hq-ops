import { useState } from "react";
import { Bot, Lock, Send } from "lucide-react";

import {
  GUIDE_DISABLED_MESSAGE,
  GUIDE_QUESTION_MAX_LENGTH,
  GUIDE_SAMPLE_QUESTION,
  submitGuideQuestion,
} from "@/lib/cartel-guide-contract";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

// Example prompts drawn from existing Help Center topics (welcome-message, connect-group, share-watchlist).
const EXAMPLES = [
  GUIDE_SAMPLE_QUESTION,
  "How do I connect my Telegram group to Cartel HQ?",
  "How do I share my launch watchlist link?",
] as const;

/** Owner-only disabled preview. Makes no network, Supabase or AI calls. */
export default function CartelGuideShell() {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState(false);

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

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitGuideQuestion(text);
          setNotice(true);
        }}
      >
        <label htmlFor="cartel-guide-question" className="type-eyebrow text-foreground">Your question</label>
        <Textarea
          id="cartel-guide-question"
          value={text}
          maxLength={GUIDE_QUESTION_MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a question to preview the layout"
          className="min-h-24 border-gold/40 bg-background text-foreground placeholder:text-muted-foreground"
        />
        <Button
          type="submit"
          variant="outline"
          aria-describedby="cartel-guide-off"
          className="min-h-11 w-full border-dashed text-muted-foreground"
        >
          <Lock className="size-4" aria-hidden="true" /> Sending is off in preview
          <Send className="size-4 opacity-40" aria-hidden="true" />
        </Button>
        <p id="cartel-guide-off" className="text-xs text-muted-foreground" aria-live="polite">
          {notice ? "Not sent. Nothing left this page — the AI Guide is not active yet." : "Nothing you type is sent anywhere."}
        </p>
      </form>
    </section>
  );
}
