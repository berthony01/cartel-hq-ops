import { useState } from "react";
import { Bot, Lock } from "lucide-react";

import {
  GUIDE_DISABLED_MESSAGE,
  GUIDE_QUESTION_MAX_LENGTH,
  GUIDE_SAMPLE_QUESTION,
  submitGuideQuestion,
} from "@/lib/cartel-guide-contract";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/** Owner-only disabled preview. Makes no network, Supabase or AI calls. */
export default function CartelGuideShell() {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState(false);

  return (
    <section className="space-y-3" aria-label="AI Guide preview">
      <p className="flex items-start gap-2 border border-gold/40 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-foreground" role="note">
        <Lock className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
        <span>{GUIDE_DISABLED_MESSAGE}</span>
      </p>
      <div className="space-y-2 border border-border-subtle p-3">
        <p className="type-eyebrow text-muted-foreground">Example question</p>
        <p className="text-sm text-foreground">{GUIDE_SAMPLE_QUESTION}</p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Bot className="size-4" aria-hidden="true" /> No answer — the Guide is switched off in this preview.
        </p>
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitGuideQuestion(text);
          setNotice(true);
        }}
      >
        <label htmlFor="cartel-guide-question" className="type-eyebrow text-muted-foreground">Ask the Guide (disabled)</label>
        <Textarea
          id="cartel-guide-question"
          value={text}
          maxLength={GUIDE_QUESTION_MAX_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a question to preview the layout"
          className="min-h-20"
        />
        <Button type="submit" variant="outline" className="min-h-11 w-full">Send (disabled)</Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {notice ? "Not sent. The AI Guide is not active yet." : ""}
        </p>
      </form>
    </section>
  );
}
