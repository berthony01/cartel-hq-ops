import {
  formatTimestamp,
  scheduleSnapshotPair,
  type LaunchScheduleCommunication,
} from "@/lib/launch-control";

/**
 * C6 — shared, read-only rendering of one detected schedule change.
 *
 * Used by both Launch Control (warning) and Community Command → Broadcasts
 * (decision card) so the Previous/New facts can never drift between the two
 * surfaces. Purely presentational: every value comes from the RLS-visible
 * `launch_schedule_communications` row, and each snapshot is rendered in its
 * own stored timezone.
 */
export function ScheduleChangeSummary({
  row,
  showDetected = true,
}: {
  row: LaunchScheduleCommunication;
  showDetected?: boolean;
}) {
  const { previous, current } = scheduleSnapshotPair(row);

  return (
    <dl className="grid gap-2 text-xs sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Previous schedule
        </dt>
        <dd className="mt-1 text-sm text-muted-foreground line-through [overflow-wrap:anywhere]">
          {previous}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          New schedule
        </dt>
        <dd className="mt-1 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
          {current}
        </dd>
      </div>
      {showDetected ? (
        <>
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Changes since last decision
            </dt>
            <dd className="mt-1 font-mono text-sm text-foreground">{row.change_count}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Detected
            </dt>
            <dd className="mt-1 text-sm text-foreground">{formatTimestamp(row.detected_at)}</dd>
          </div>
        </>
      ) : null}
    </dl>
  );
}
