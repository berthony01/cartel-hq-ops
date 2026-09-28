import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { findPlaceholders, policyContent, POLICY_DRAFTS, type PolicyType } from "@/lib/legal-policies";
import { fetchActivePolicies, policyKeys } from "@/lib/policy-acceptance";
import { LegalFooter } from "@/components/cartel/LegalFooter";

/** Renders a placeholder token visibly highlighted. */
function withPlaceholders(text: string) {
  const parts = text.split(/(\[[A-Z0-9][A-Z0-9 /&.,'-]*\])/g);
  return parts.map((p, i) =>
    /^\[[A-Z0-9]/.test(p) ? (
      <mark key={i} className="rounded-sm bg-signal/15 px-1 font-semibold text-signal">{p}</mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function LegalDocumentPage({ type }: { type: PolicyType }) {
  const draft = POLICY_DRAFTS[type];
  const active = useQuery({ queryKey: policyKeys.active(), queryFn: fetchActivePolicies, staleTime: 60_000 });
  const placeholders = findPlaceholders(policyContent(draft));
  // Fail closed: the in-app text is always the draft. Even if a version is
  // active server-side, this copy is labelled draft while placeholders remain.
  const effective = active.data?.find((p) => p.document_type === type);
  const isDraft = !effective || placeholders.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="app-gutter border-b border-border-subtle py-4">
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 font-display text-xl uppercase tracking-widest text-gold">
          <ShieldCheck className="size-5" aria-hidden="true" /> CARTEL HQ
        </Link>
      </header>
      <main className="app-gutter mx-auto w-full max-w-3xl py-10">
        {isDraft && (
          <div role="note" className="mb-8 flex items-start gap-3 rounded-lg border-2 border-signal/60 bg-signal/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden="true" />
            <div>
              <p className="font-display text-xl uppercase tracking-widest text-signal">Draft — not effective</p>
              <p className="mt-1 text-sm text-foreground">
                This document is a draft pending legal review. It is not in effect and does not bind anyone.
                Bracketed fields are unresolved placeholders ({placeholders.length}).
              </p>
            </div>
          </div>
        )}
        <p className="type-eyebrow text-muted-foreground">Legal · Draft v{draft.draftVersion}</p>
        <h1 className="mt-2 font-display text-4xl uppercase tracking-wider text-foreground sm:text-5xl">{draft.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{draft.summary}</p>
        <div className="mt-8 space-y-8">
          {draft.sections.map((s) => (
            <section key={s.heading} aria-labelledby={`h-${s.heading}`}>
              <h2 id={`h-${s.heading}`} className="font-display text-2xl uppercase tracking-wider text-gold">{s.heading}</h2>
              {s.body.map((para, i) => (
                <p key={i} className="mt-3 text-sm leading-relaxed text-foreground/90">{withPlaceholders(para)}</p>
              ))}
            </section>
          ))}
        </div>
      </main>
      <footer className="app-gutter border-t border-border-subtle py-6">
        <LegalFooter />
      </footer>
    </div>
  );
}
