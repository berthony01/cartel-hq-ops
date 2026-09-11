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
          className="surface-elevated hover-lift relative min-w-0 overflow-hidden rounded-lg p-4"
        >
          <span className="absolute inset-y-0 left-0 w-px bg-gold/70" aria-hidden="true" />
          <p className="font-display text-2xl leading-none text-gold/70">
            {String(i + 1).padStart(2, "0")}
          </p>
          <h3 className="mt-2 font-display text-base uppercase leading-snug text-foreground">{stage.name}</h3>
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
    <p className="surface-quiet mt-3 flex items-start gap-2 rounded-md p-3 text-xs leading-relaxed text-muted-foreground">
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
            className="surface-quiet min-w-0 rounded-md px-3 py-2.5"
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
      className="surface-command min-w-0 rounded-lg px-4 py-3.5"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
        {guide.stage}
      </p>
      <dl className="mt-2 grid gap-2 md:grid-cols-3 [&>*]:min-w-0">
          <div className="surface-quiet rounded-md p-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            What you&apos;re doing
          </dt>
          <dd className="mt-0.5 text-xs leading-relaxed text-foreground">{guide.doing}</dd>
        </div>
          <div className="surface-quiet rounded-md p-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Why it matters
          </dt>
          <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{guide.why}</dd>
        </div>
          <div className="surface-quiet rounded-md p-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Next
          </dt>
          <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{guide.next}</dd>
        </div>
      </dl>
    </section>
  );
}
