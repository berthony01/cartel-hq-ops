import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  MOTION_MODE_CHOICES,
  MOTION_SAFETY_NOTE,
  MOTION_UNAVAILABLE_NOTE,
  currentMotionVersion,
  type StickerMotionState,
} from "@/lib/sticker-motion";

/**
 * Compact read-only Motion Studio surface for one Step 4 sticker card.
 *
 * Presentation only: it renders durable state loaded elsewhere and disabled
 * placeholders for the three future creation modes. It contains no mutation,
 * provider, Edge Function or Telegram code of any kind.
 */
export function MotionStudioPanel({
  state,
  loading,
  error,
}: {
  state: StickerMotionState | undefined;
  loading: boolean;
  error: boolean;
}) {
  const current = currentMotionVersion(state);
  /** Never infer counts or release state from a failed / pending read. */
  const known = !error && !loading && !!state;

  return (
    <div className="mt-3 rounded-md border border-border bg-background/40 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Motion Studio
        </p>
        {error ? (
          <StatusBadge tone="muted">Status unavailable</StatusBadge>
        ) : known ? (
          <StatusBadge tone={state.releaseVariant === "motion" ? "gold" : "muted"}>
            {state.releaseVariant === "motion" ? "Motion" : "Static"}
          </StatusBadge>
        ) : null}
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        Animate the approved static without replacing or damaging it. Motion keeps its own version
        history and only becomes the Telegram release after explicit approval.
      </p>

      <dl className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
        {error ? (
          <div className="text-signal">Motion status unavailable</div>
        ) : !known ? (
          <div>Loading motion status…</div>
        ) : (
          <>
            <div>
              <dt className="inline">Current release: </dt>
              <dd className="inline text-foreground">
                {state.releaseVariant === "motion" ? "Motion" : "Static"}
              </dd>
            </div>
            <div>
              <dt className="inline">Motion versions: </dt>
              <dd className="inline text-foreground">{state.versions.length}</dd>
            </div>
            <div>
              <dt className="inline">Current Motion: </dt>
              <dd className="inline text-foreground">
                {current ? `Version ${current.versionNumber}` : "None"}
              </dd>
            </div>
          </>
        )}
      </dl>

      <ul className="mt-2 grid gap-1.5 sm:grid-cols-3">
        {MOTION_MODE_CHOICES.map((choice) => (
          <li key={choice.mode}>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={MOTION_UNAVAILABLE_NOTE}
              className="w-full cursor-not-allowed rounded border border-border/70 bg-surface-raised/20 p-2 text-left opacity-70"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                {choice.title}
              </span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                {choice.description}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {MOTION_UNAVAILABLE_NOTE}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{MOTION_SAFETY_NOTE}</p>
    </div>
  );
}
