import { useState } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { Button } from "@/components/ui/button";
import type { OfficialContractNotifyResult } from "@/lib/launch-control";

/**
 * C8.7C — the ONLY surface that asks Launch Watch subscribers to be notified
 * about a registered official contract.
 *
 * This component owns no data access: it imports no Supabase client, runs no
 * query and calls no RPC. The database independently re-derives the registered
 * address from its bound deployment evidence, enforces owner-only workspace
 * authority, and stays idempotent, so everything here is presentation only.
 *
 * Registering an official contract notifies nobody. Sending the packet states
 * only that the authenticated project published its evidence-bound official
 * contract to people who chose to watch this launch. It is not a safety check,
 * an audit, an endorsement, or any statement about legitimacy or value.
 */

export type OfficialContractNotifyPanelProps = {
  launchStatus: string;
  /** True only when address, bound deployment and registration timestamp are all present. */
  registrationComplete: boolean;
  /** Presentation hint only. The database enforces owner-only notification. */
  isWorkspaceOwner: boolean;
  disabled?: boolean;
  pending?: boolean;
  result: OfficialContractNotifyResult | null;
  error: string | null;
  onNotify: () => void;
};

const REGISTERED_STATUS = "OFFICIAL_CONTRACT_REGISTERED";

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function OfficialContractNotifyPanel({
  launchStatus,
  registrationComplete,
  isWorkspaceOwner,
  disabled,
  pending,
  result,
  error,
  onNotify,
}: OfficialContractNotifyPanelProps) {
  const [armed, setArmed] = useState(false);

  const atNotifyStage = launchStatus === REGISTERED_STATUS;
  const canNotify = atNotifyStage && registrationComplete && isWorkspaceOwner;

  let body: React.ReactNode;

  if (!registrationComplete) {
    body = (
      <Note>
        There is no complete evidence-bound official contract registration on this launch yet, so
        there is nothing to send. Registering a contract never notifies anyone by itself.
      </Note>
    );
  } else if (!atNotifyStage) {
    body = (
      <Note>
        Notifying watchers becomes available once this launch reaches Official Contract Registered.
        It is {launchStatus}. Moving the launch into that stage does not send anything on its own.
      </Note>
    );
  } else if (!isWorkspaceOwner) {
    body = (
      <Note>
        Only the project owner can send the official contract to Launch Watch subscribers. Admin
        access is not sufficient.
      </Note>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Note>
          This sends this project&apos;s evidence-bound official contract to eligible Launch Watch
          subscribers, as a direct message from the project&apos;s own bot. Watchers who muted
          countdowns or stopped watching are excluded by the existing delivery rules.
        </Note>
        <Note>
          It states only that the authenticated project registered this contract from a verified
          deployment record. It is not a safety check, an audit, an endorsement, or an investment
          guarantee.
        </Note>
        <Note>
          Sending is idempotent: if this launch has already been queued, running it again reports
          the existing send instead of messaging anyone a second time.
        </Note>
        {armed ? (
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={disabled || pending} onClick={onNotify}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Megaphone className="size-4" aria-hidden="true" />
              )}
              Confirm — send to Launch Watch subscribers
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={disabled || pending}
              onClick={() => setArmed(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={disabled || pending}
            onClick={() => setArmed(true)}
          >
            <Megaphone className="size-4" aria-hidden="true" />
            Notify Launch Watch subscribers
          </Button>
        )}
      </div>
    );
  }

  return (
    <Section
      variant="surface"
      title="Notify watchers"
      description="Registration and the notification are separate steps. Registering an official contract sends nothing — this action does."
      leading={
        <Megaphone
          className="size-4 text-[color:var(--cartel-gold,#D4A82A)]"
          aria-hidden="true"
        />
      }
    >
      <div className="space-y-3">
        {body}

        {canNotify && result ? (
          <div
            role="status"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-500">
              {result.status === "queued" ? "Queued for delivery" : "Already notified"}
            </p>
            <Note>
              {result.status === "queued"
                ? `Queued for ${result.delivery_count} eligible subscriber${
                    result.delivery_count === 1 ? "" : "s"
                  }. Delivery is handled by the existing Launch Watch worker.`
                : `This launch was already sent to Launch Watch subscribers (${result.delivery_count} delivery record${
                    result.delivery_count === 1 ? "" : "s"
                  }). Nothing was sent again.`}
            </Note>
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
              Not sent
            </p>
            <Note>{error}</Note>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
