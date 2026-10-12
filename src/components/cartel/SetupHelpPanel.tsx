import { useMemo, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";

import { useWorkspace } from "@/lib/workspace-context";
import { useSession } from "@/hooks/useSession";
import { useWorkspaceGoal } from "@/lib/workspace-goal";
import { useOnboardingProgress } from "@/lib/onboarding";
import { articleById, docs, docsHref, searchDocs } from "@/lib/docs-content";
import { deriveSetupHelp, resolveArticleIds, TOPIC_ARTICLES, type HelpTopic } from "@/lib/setup-help";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TOPIC_LABEL: Record<HelpTopic, string> = {
  general: "This page",
  identity: "Project identity",
  community: "Connect your community",
  launch: "Launch basics",
  review: "Review",
};

const exists = (id: string) => Boolean(articleById[id]);

function ArticleLinks({ ids }: { ids: readonly string[] }) {
  const resolved = resolveArticleIds(ids, exists);
  if (!resolved.length) return null;
  return (
    <ul className="space-y-1">
      {resolved.map((id) => (
        <li key={id}>
          <a
            href={docsHref(id)}
            target="_blank"
            rel="noopener"
            className="flex min-h-11 items-center justify-between gap-2 border border-border-subtle px-3 py-2 text-sm text-foreground hover:border-gold/40"
          >
            <span className="min-w-0 truncate">{articleById[id]!.title}</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function SetupHelpPanel({
  topic,
  onNavigate,
}: {
  topic: HelpTopic | null;
  onNavigate: () => void;
}) {
  const { workspace, workspaceId } = useWorkspace();
  const { user } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const goalQuery = useWorkspaceGoal(workspaceId);
  const goal = goalQuery.data ?? null;
  // Progress only runs once the goal is known, so the step set is never guessed.
  const progress = useOnboardingProgress(goalQuery.isSuccess ? workspaceId : null, goal);
  const isOwner =
    !!workspace && workspace.access !== "managed" && !!user && workspace.owner_id === user.id;

  const view = deriveSetupHelp({
    workspaceId,
    goalStatus: goalQuery.isError ? "error" : goalQuery.isSuccess ? "success" : "pending",
    goal,
    progress: goalQuery.isSuccess ? progress : null,
    requestedTopic: topic,
    pathname,
    isOwner,
  });

  const [query, setQuery] = useState("");
  const results = useMemo(() => searchDocs(query).slice(0, 6), [query]);
  const effectiveTopic: HelpTopic =
    view.kind === "ready" || view.kind === "unavailable" ? view.topic : (topic ?? "general");

  return (
    <div className="mt-5 space-y-6 text-sm">
      {view.kind === "no-workspace" ? (
        <section className="space-y-2">
          <p className="text-muted-foreground">No project is selected. Create or select a project to start setup.</p>
          <Link to="/dashboard" onClick={onNavigate} className="inline-flex min-h-11 items-center gap-2 text-gold underline-offset-4 hover:underline">
            Go to dashboard <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </section>
      ) : view.kind === "loading" ? (
        <p className="text-muted-foreground" role="status">Checking your setup progress…</p>
      ) : view.kind === "unavailable" ? (
        <p className="border border-border-subtle px-3 py-2 text-muted-foreground" role="status">
          Setup information unavailable right now. You can still browse the Help Center below.
        </p>
      ) : (
        <section className="space-y-3" aria-label="Your setup">
          <p className="text-xs leading-relaxed text-muted-foreground">{view.note}</p>
          <ul className="space-y-1">
            {view.steps.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2">
                <span className="text-foreground">{s.title}</span>
                <span className={cn("flex items-center gap-1 text-xs", s.status === "done" ? "text-pepe" : "text-muted-foreground")}>
                  {s.status === "done" ? <Check className="size-3" aria-hidden="true" /> : null}
                  {s.status === "done" ? "Done" : "To do"}
                </span>
              </li>
            ))}
          </ul>
          {view.nextStep ? (
            <Link
              to={view.nextStep.to}
              onClick={onNavigate}
              className="flex min-h-11 items-center justify-between gap-2 border border-gold/40 bg-gold/5 px-3 py-2 text-foreground"
            >
              <span>
                Next: <span className="font-semibold">{view.nextStep.title}</span> — {view.nextStep.ctaLabel}
              </span>
              <ArrowRight className="size-4 shrink-0 text-gold" aria-hidden="true" />
            </Link>
          ) : view.allComplete ? (
            <p className="text-xs text-muted-foreground">The setup steps for your goal are done. The dashboard keeps guiding what comes next.</p>
          ) : null}
          <Link to="/onboarding" onClick={onNavigate} className="inline-flex min-h-11 items-center text-xs text-gold underline-offset-4 hover:underline">
            Open Guided setup
          </Link>
        </section>
      )}

      {view.kind !== "no-workspace" ? (
        <section className="space-y-2" aria-label="Help articles">
          <h3 className="type-eyebrow text-muted-foreground">Help for: {TOPIC_LABEL[effectiveTopic]}</h3>
          {view.kind === "ready" && !view.topicInGuide ? (
            <p className="text-xs text-muted-foreground">Optional for your goal — not a required setup step.</p>
          ) : null}
          <ArticleLinks ids={TOPIC_ARTICLES[effectiveTopic]} />
        </section>
      ) : null}

      <section className="space-y-2" aria-label="Search the Help Center">
        <label htmlFor="setup-help-search" className="type-eyebrow text-muted-foreground">Search the Help Center</label>
        <Input id="setup-help-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. welcome message" className="min-h-11" />
        <p className="sr-only" aria-live="polite">{query ? `${results.length} results` : ""}</p>
        {query ? (results.length ? <ArticleLinks ids={results.map((a) => a.id)} /> : <p className="text-xs text-muted-foreground">No matching articles.</p>) : null}
      </section>

      <p className="border-t border-border-subtle pt-3 text-xs leading-relaxed text-muted-foreground">
        Help Center articles were last fully reviewed on {docs.verifiedAt}; some screens may have changed since.{" "}
        <a href="/docs" target="_blank" rel="noopener" className="text-gold underline-offset-4 hover:underline">Open the Help Center</a>
      </p>
    </div>
  );
}
