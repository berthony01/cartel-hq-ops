import { ArrowRight } from "lucide-react";
import { JOURNEY_STAGES, STEP_GUIDES, V2_CAPABILITIES } from "@/lib/sticker-lab";

/**
 * Presentation-only journey surfaces for Sticker Lab. These components render
 * copy derived from static maps — they never read or mutate pack data.
 */

/** Home-page explanation of the four-stage journey. */
export function JourneyOverview() {
  return (
    <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
      {JOURNEY_STAGES.map((stage, i) => (
        <li
          key={stage.key}
          className="min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 p-4"
        >
          <p className="text-[11px] font-semibold tracking-[0.16em] text-gold">
            {String(i + 1).padStart(2, "0")}
          </p>
          <h3 className="mt-1 text-sm font-semibold leading-snug text-foreground">{stage.name}</h3>
          {stage.substeps ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {stage.substeps.join(" · ")}
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{stage.does}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-pepe">{stage.benefit}</p>
        </li>
      ))}
    </ol>
  );
}

/** Post-release continuation cue. */
export function JourneyAfterRelease() {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md border border-border/70 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
      <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-gold" aria-hidden="true" />
      <span>
        <strong className="text-foreground">After release — Sticker Drops.</strong> Post approved
        native stickers into your connected communities on a controlled schedule.
      </span>
    </p>
  );
}

/** Truthful capability strip. Current capability only. */
export function CapabilityStrip() {
  return (
    <>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        {V2_CAPABILITIES.map((cap) => (
          <li
            key={cap.name}
            className="min-w-0 rounded-md border border-border/70 bg-background/40 px-3 py-2"
          >
            <p className="text-xs font-semibold text-foreground">{cap.name}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{cap.blurb}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">
        <span className="mr-2 rounded border border-border/70 px-1.5 py-0.5 uppercase tracking-[0.14em]">
          Planned
        </span>
        Animated stickers and A/B variation generation are not available yet.
      </p>
    </>
  );
}

/** Compact contextual guide shown above the active builder step. */
export function StepGuide({ step }: { step: number }) {
  const guide = STEP_GUIDES[step];
  if (!guide) return null;
  return (
    <section
      aria-label={`Guidance for ${guide.stage}`}
      className="min-w-0 rounded-lg border border-border/70 bg-surface-raised/40 px-4 py-3"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
        {guide.stage}
      </p>
      <dl className="mt-2 grid gap-2 md:grid-cols-3 [&>*]:min-w-0">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            What you&apos;re doing
          </dt>
          <dd className="mt-0.5 text-xs leading-relaxed text-foreground">{guide.doing}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Why it matters
          </dt>
          <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{guide.why}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Next
          </dt>
          <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{guide.next}</dd>
        </div>
      </dl>
    </section>
  );
}
