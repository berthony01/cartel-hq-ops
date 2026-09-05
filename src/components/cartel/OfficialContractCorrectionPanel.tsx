import { useState } from "react";
import { History, Loader2, Megaphone, Send, ShieldAlert } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTRACT_CORRECTION_REASON_MAX,
  CONTRACT_MAX,
  type LaunchContractRegistrationEvent,
  type OfficialContractCorrectionNotifyResult,
  type OfficialContractCorrectionResult,
} from "@/lib/launch-control";
import type { OfficialContractCorrectionBroadcastResult } from "@/lib/telegram-group";
import type {
  DeploymentEvidenceResult,
  LaunchEvidenceEvaluation,
} from "@/lib/launch-verified-eligibility";


/**
 * C8.7E E3 — official contract correction + immutable registration history.
 *
 * This component owns no data access: it imports no Supabase client, runs no
 * query and calls no RPC. Candidate deployments come from the existing
 * evidence evaluator output already produced by the route, and the correction
 * itself is handed upward through `onCorrect`. The database re-derives the
 * replacement address from the selected verified deployment evidence, enforces
 * owner-only authority and keeps the ledger append-only, so everything here is
 * presentation only.
 *
 * A correction changes which verified deployment record the project's official
 * contract reference is bound to. It is not a safety check, an audit, an
 * endorsement, or any statement about legitimacy or value — and it sends
 * nothing: subscriber and community communications are separate explicit
 * actions.
 */

/** Lifecycle stages where a registered contract may be corrected. */
const CORRECTABLE_STATUSES = ["OFFICIAL_CONTRACT_REGISTERED", "LIVE", "COMPLETED"];

/**
 * Registration gates that only reflect "already registered / past Contract
 * Pending". Every other gate is a genuine evidence requirement and still has
 * to pass for a deployment to be a correction candidate. The evaluator remains
 * the single source of those rules — nothing is re-implemented here.
 */
const REGISTRATION_STATE_CHECK_IDS = ["lifecycle", "not_registered"];

/**
 * Safe connected-community option already produced by the route for the
 * C8.7D broadcast panel. Presentation only — no data access here.
 */
export type CorrectionGroupOption = { id: string; title: string; ready: boolean };

export type OfficialContractCorrectionPanelProps = {
  launchId: string | null;
  launchStatus: string;
  /** True only when address, bound deployment and registration timestamp are all present. */
  registrationComplete: boolean;
  officialContractAddress: string | null;
  officialContractDeploymentId: string | null;
  /** Presentation hint only. The database enforces owner-only correction. */
  isWorkspaceOwner: boolean;
  /** Existing evaluator output already loaded by the route. */
  evaluation: LaunchEvidenceEvaluation | null;
  events: LaunchContractRegistrationEvent[];
  eventsLoading?: boolean;
  eventsError?: string | null;
  disabled?: boolean;
  pending?: boolean;
  result: OfficialContractCorrectionResult | null;
  error: string | null;
  onCorrect: (input: { deploymentId: string; expectedAddress: string; reason: string }) => void;

  // C8.7E E4B — two independent, explicit post-correction communications.
  /** Reuses the already-loaded connected-community list. No second query. */
  groups?: CorrectionGroupOption[];
  groupsLoading?: boolean;
  correctionNotifyPending?: boolean;
  correctionNotifyResult?: OfficialContractCorrectionNotifyResult | null;
  correctionNotifyError?: string | null;
  correctionBroadcastPending?: boolean;
  correctionBroadcastResult?: OfficialContractCorrectionBroadcastResult | null;
  correctionBroadcastError?: string | null;
  onNotifyCorrection?: (registrationEventId: string) => void;
  onBroadcastCorrection?: (groupConnectionId: string, registrationEventId: string) => void;
};


function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function abbreviate(value: string | null) {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 18) return v;
  return `${v.slice(0, 10)}…${v.slice(-6)}`;
}

function CandidateSummary({ item }: { item: DeploymentEvidenceResult }) {
  const tx = abbreviate(item.txHash);
  const facts = [
    item.networkLabel,
    item.confirmations != null ? `${item.confirmations} confirmations` : null,
    item.blockNumber != null ? `block ${item.blockNumber}` : null,
  ].filter(Boolean);
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--cartel-gold,#D4A82A)]">
        Deployment evidence — attempt #{item.attemptNumber}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-foreground">{item.contractAddress}</p>
      {facts.length > 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{facts.join(" · ")}</p>
      ) : null}
      {tx ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">tx {tx}</p> : null}
    </div>
  );
}

function HistoryList({
  events,
  loading,
  error,
}: {
  events: LaunchContractRegistrationEvent[];
  loading: boolean | undefined;
  error: string | null;
}) {
  if (error) {
    return (
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2">
        <Note>{error}</Note>
      </div>
    );
  }
  if (loading) return <Note>Loading registration history…</Note>;
  if (events.length === 0) {
    return <Note>No registration decisions are recorded for this launch yet.</Note>;
  }
  return (
    <ol className="space-y-2">
      {events.map((event) => {
        const corrected = event.action === "CORRECTED";
        return (
          <li
            key={event.id}
            className="min-w-0 rounded-md border border-border bg-background/40 px-3 py-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {corrected ? "Correction" : "Original registration"}
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">
              {event.contract_address}
            </p>
            <dl className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  Bound deployment
                </dt>
                <dd className="break-all font-mono text-[11px] text-foreground">
                  {event.deployment_id}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                  Recorded at
                </dt>
                <dd className="break-all font-mono text-[11px] text-foreground">
                  {event.created_at}
                </dd>
              </div>
            </dl>
            {corrected && event.correction_reason ? (
              <p className="mt-1 text-xs leading-relaxed text-foreground">
                Reason: {event.correction_reason}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function OfficialContractCorrectionPanel({
  launchId,
  launchStatus,
  registrationComplete,
  officialContractAddress,
  officialContractDeploymentId,
  isWorkspaceOwner,
  evaluation,
  events,
  eventsLoading,
  eventsError,
  disabled,
  pending,
  result,
  error,
  onCorrect,
  groups,
  groupsLoading,
  correctionNotifyPending,
  correctionNotifyResult,
  correctionNotifyError,
  correctionBroadcastPending,
  correctionBroadcastResult,
  correctionBroadcastError,
  onNotifyCorrection,
  onBroadcastCorrection,
}: OfficialContractCorrectionPanelProps) {
  // Candidates reuse the existing evaluator verdicts. A deployment qualifies
  // when every registration gate passes except the two that only describe the
  // launch already being registered and past Contract Pending, and when the
  // evaluator has also marked the chain as production (not testnet). That
  // boolean mirrors the `!compatibility.isTestnet` predicate inside
  // `officialRegistrationEligible`, so the UI offer stays fail-closed even
  // though the database will reject an ineligible deployment as well.
  const candidates = (evaluation?.deployments ?? []).filter(
    (d) =>
      d.contractAddress != null &&
      d.contractAddress.trim() !== "" &&
      d.deploymentId !== officialContractDeploymentId &&
      !d.chainCompatibility.isTestnet &&
      d.registrationChecks.every(
        (c) => c.state === "PASS" || REGISTRATION_STATE_CHECK_IDS.includes(c.id),
      ),
  );

  const atCorrectableStage = CORRECTABLE_STATUSES.includes(launchStatus);
  const canCorrect = registrationComplete && atCorrectableStage && isWorkspaceOwner;

  // Form state is derived during render and re-armed whenever the launch, the
  // candidate set or the last recorded correction changes, so a stale typed
  // confirmation can never carry over into a different decision.
  const formKey = `${launchId ?? ""}::${candidates.map((d) => d.deploymentId).join("|")}::${
    result?.status === "corrected" ? result.registration_event_id : ""
  }`;
  const [form, setForm] = useState<{
    key: string;
    selectedId: string | null;
    confirmAddress: string;
    reason: string;
    reviewing: boolean;
  }>({ key: formKey, selectedId: null, confirmAddress: "", reason: "", reviewing: false });
  const state =
    form.key === formKey
      ? form
      : { key: formKey, selectedId: null, confirmAddress: "", reason: "", reviewing: false };
  const patch = (next: Partial<typeof state>) => setForm({ ...state, ...next, key: formKey });

  // C8.7E E4B — the CURRENT communicable correction is derived from the
  // immutable, chronological ledger passed in by the route, never from this
  // browser session's last mutation result. A correction recorded on an
  // earlier day therefore stays communicable after a reload, and a superseded
  // one stops being communicable immediately. The server revalidates all of
  // this independently; everything below is presentation only.
  const latestEvent = events.length > 0 ? events[events.length - 1]! : null;
  const latestSupersededEvent =
    latestEvent?.superseded_event_id
      ? (events.find((e) => e.id === latestEvent.superseded_event_id) ?? null)
      : null;

  const currentCorrection =
    registrationComplete &&
    atCorrectableStage &&
    !eventsLoading &&
    !eventsError &&
    latestEvent != null &&
    latestEvent.action === "CORRECTED" &&
    (latestEvent.id ?? "").trim() !== "" &&
    latestEvent.deployment_id === officialContractDeploymentId &&
    officialContractAddress != null &&
    (latestEvent.contract_address ?? "").trim().toLowerCase() ===
      officialContractAddress.trim().toLowerCase() &&
    (latestEvent.superseded_event_id ?? "").trim() !== "" &&
    (latestEvent.correction_reason ?? "").trim() !== "" &&
    latestSupersededEvent != null &&
    latestSupersededEvent.contract_address != null &&
    latestSupersededEvent.contract_address.trim() !== "" &&
    latestSupersededEvent.contract_address.trim().toLowerCase() !==
      (latestEvent.contract_address ?? "").trim().toLowerCase()
      ? latestEvent
      : null;
  const supersededEvent = currentCorrection ? latestSupersededEvent : null;

  // Armed confirmations and the selected community are keyed to the current
  // correction, so they re-arm automatically whenever the launch changes or a
  // newer correction supersedes this one. Durable outcomes come from props and
  // are never cleared by cancelling an armed confirmation.
  const commKey = `${launchId ?? ""}::${currentCorrection?.id ?? ""}`;
  const [comm, setComm] = useState<{
    key: string;
    notifyArmed: boolean;
    groupId: string | null;
    groupArmed: boolean;
  }>({ key: commKey, notifyArmed: false, groupId: null, groupArmed: false });
  const commState =
    comm.key === commKey
      ? comm
      : { key: commKey, notifyArmed: false, groupId: null, groupArmed: false };
  const patchComm = (next: Partial<typeof commState>) =>
    setComm({ ...commState, ...next, key: commKey });

  const readyGroups = (groups ?? []).filter((g) => g.ready);
  const selectedReadyGroup = readyGroups.find((g) => g.id === commState.groupId) ?? null;



  const selected = candidates.find((d) => d.deploymentId === state.selectedId) ?? null;
  const replacementAddress = selected?.contractAddress ?? null;
  const confirmMatches =
    replacementAddress != null &&
    state.confirmAddress.trim().toLowerCase() === replacementAddress.trim().toLowerCase();
  const reason = state.reason;
  const reasonOk = reason.trim().length > 0 && reason.length <= CONTRACT_CORRECTION_REASON_MAX;
  const remaining = CONTRACT_CORRECTION_REASON_MAX - reason.length;
  const readyToReview = Boolean(selected) && confirmMatches && reasonOk;

  let action: React.ReactNode = null;

  if (!registrationComplete) {
    action = (
      <Note>
        This launch has no complete evidence-bound official contract registration, so there is
        nothing to correct.
      </Note>
    );
  } else if (!atCorrectableStage) {
    action = (
      <Note>
        Correcting the registered official contract is only available from Official Contract
        Registered onwards. This launch is {launchStatus}.
      </Note>
    );
  } else if (!isWorkspaceOwner) {
    action = (
      <Note>
        Only the project owner can correct the registered official contract. Admin access is not
        sufficient. Registration history above stays visible to the project team.
      </Note>
    );
  } else if (candidates.length === 0) {
    action = (
      <Note>
        No other eligible production deployment evidence is available for this launch, so there is
        nothing to correct to. The replacement address is never typed in freehand — it is always
        derived from a verified deployment record.
      </Note>
    );
  } else if (state.reviewing && selected) {
    action = (
      <div className="space-y-3 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
          Review correction
        </p>
        <dl className="space-y-2">
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Current address
            </dt>
            <dd className="break-all font-mono text-xs text-foreground">
              {officialContractAddress}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Replacement address
            </dt>
            <dd className="break-all font-mono text-xs text-foreground">{replacementAddress}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Reason</dt>
            <dd className="whitespace-pre-wrap break-words text-xs text-foreground">
              {reason.trim()}
            </dd>
          </div>
        </dl>
        <Note>
          This changes the project&apos;s registered official contract reference. It does not
          retract or edit any message that was already sent.
        </Note>
        <Note>
          After a correction, subscriber and community communications are separate explicit actions.
        </Note>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            className="min-h-11"
            disabled={disabled || pending || !readyToReview}
            onClick={() =>
              onCorrect({
                deploymentId: selected.deploymentId,
                expectedAddress: replacementAddress ?? "",
                reason: reason.trim(),
              })
            }
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldAlert className="size-4" aria-hidden="true" />
            )}
            Confirm official contract correction
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={disabled || pending}
            onClick={() => patch({ reviewing: false })}
          >
            Back
          </Button>
        </div>
      </div>
    );
  } else {
    action = (
      <div className="space-y-3">
        <Note>
          Choose the verified deployment record this launch&apos;s official contract should be bound
          to instead. Only the deployment selection is authority — the address you type is a
          confirmation, and the database derives the real address from the evidence again.
        </Note>
        <ul className="space-y-2">
          {candidates.map((item) => {
            const active = item.deploymentId === state.selectedId;
            return (
              <li key={item.deploymentId}>
                <button
                  type="button"
                  onClick={() =>
                    patch({ selectedId: item.deploymentId, confirmAddress: "", reviewing: false })
                  }
                  aria-pressed={active}
                  className={`w-full rounded-md border px-3 py-2 text-left ${
                    active
                      ? "border-[color:var(--cartel-gold,#D4A82A)] bg-[color:var(--cartel-gold,#D4A82A)]/10"
                      : "border-border bg-background/40"
                  }`}
                >
                  <CandidateSummary item={item} />
                </button>
              </li>
            );
          })}
        </ul>

        {selected ? (
          <>
            <div className="min-w-0">
              <Label htmlFor="contract-correction-confirm">
                Type the replacement contract address to confirm
              </Label>
              <Input
                id="contract-correction-confirm"
                maxLength={CONTRACT_MAX}
                disabled={disabled || pending}
                value={state.confirmAddress}
                onChange={(e) => patch({ confirmAddress: e.target.value })}
                placeholder="Re-type the address shown above"
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor="contract-correction-reason">Reason for this correction</Label>
              <Textarea
                id="contract-correction-reason"
                rows={3}
                maxLength={CONTRACT_CORRECTION_REASON_MAX}
                disabled={disabled || pending}
                value={reason}
                onChange={(e) => patch({ reason: e.target.value })}
                placeholder="Explain why the registered official contract is being corrected."
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {remaining} characters remaining. A reason is required and is stored permanently in
                the registration history.
              </p>
            </div>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={disabled || pending || !readyToReview}
              onClick={() => patch({ reviewing: true })}
            >
              Review correction
            </Button>
          </>
        ) : (
          <Note>Select a replacement deployment to continue.</Note>
        )}
      </div>
    );
  }

  return (
    <Section
      variant="surface"
      title="Official contract correction"
      description="Rebind the registered official contract to a different verified deployment record. Every registration decision stays in an append-only history."
      leading={
        <History className="size-4 text-[color:var(--cartel-gold,#D4A82A)]" aria-hidden="true" />
      }
    >
      <div className="space-y-4">
        {registrationComplete ? (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Current official contract
            </p>
            <p className="break-all rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs text-foreground">
              {officialContractAddress}
            </p>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                Current evidence deployment
              </p>
              <p className="break-all font-mono text-[11px] text-foreground">
                {officialContractDeploymentId}
              </p>
            </div>
            <Note>
              This address is bound to a specific verified deployment record. Binding it is not a
              safety check, an audit, an endorsement, or an investment guarantee.
            </Note>
          </div>
        ) : null}

        {action}

        {canCorrect && result ? (
          <div
            role="status"
            className={`rounded-md border px-3 py-2 ${
              result.status === "corrected"
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-border bg-background/40"
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-[0.12em] ${
                result.status === "corrected" ? "text-emerald-500" : "text-muted-foreground"
              }`}
            >
              {result.status === "corrected" ? "Correction recorded" : "No change recorded"}
            </p>
            {result.status === "corrected" ? (
              <div className="mt-1 space-y-1">
                <p className="break-all font-mono text-[11px] text-muted-foreground">
                  Previous: {result.previous_contract_address ?? "—"}
                </p>
                <p className="break-all font-mono text-[11px] text-foreground">
                  New: {result.contract_address}
                </p>
              </div>
            ) : (
              <Note>
                This launch was already bound to that deployment evidence. Nothing new was recorded.
              </Note>
            )}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
              Not corrected
            </p>
            <Note>{error}</Note>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Registration history
          </p>
          <HistoryList events={events} loading={eventsLoading} error={eventsError ?? null} />
          <Note>
            This history is append-only. Corrections never overwrite or remove earlier entries, so
            previously registered addresses remain visible in the audit trail.
          </Note>
          <Note>
            After a correction, subscriber and community communications are separate explicit
            actions.
          </Note>
        </div>

        {currentCorrection ? (
          <div className="space-y-4 rounded-md border border-border bg-background/40 px-3 py-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--cartel-gold,#D4A82A)]">
                Communicate this correction
              </p>
              <Note>
                Recording the correction notified nobody. These are two separate manual actions, and
                each one has to be confirmed on its own.
              </Note>
              <Note>
                Messages that were already sent cannot be retracted. A correction notice supersedes
                the project&apos;s previous official contract reference.
              </Note>
              <Note>
                &quot;Verified&quot; here refers only to the specific recorded deployment evidence
                this address is derived from. It is not a statement about token or project safety,
                an audit, a guarantee, an endorsement, or investment quality.
              </Note>
              <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    Previously registered
                  </dt>
                  <dd className="break-all font-mono text-[11px] text-foreground">
                    {supersededEvent?.contract_address ?? "—"}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    Corrected official contract
                  </dt>
                  <dd className="break-all font-mono text-[11px] text-foreground">
                    {currentCorrection.contract_address}
                  </dd>
                </div>
              </dl>
              <Note>
                This preview is read only, taken from the registration history. The server composes
                and derives everything it actually sends.
              </Note>
            </div>

            {!isWorkspaceOwner ? (
              <Note>
                Only the project owner can communicate a correction. Admin access is not sufficient.
              </Note>
            ) : (
              <>
                {/* A — Launch Watch subscribers */}
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Notify Launch Watch subscribers
                  </p>
                  {!onNotifyCorrection ? (
                    <Note>Subscriber correction notification is not available in this context.</Note>
                  ) : (
                    <Note>
                      This correction notice reaches active watchers even if they muted countdowns
                      or ordinary project updates. People who stopped watching are excluded by the
                      server.
                    </Note>
                  )}
                  {onNotifyCorrection && commState.notifyArmed ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="min-h-11"
                        disabled={disabled || correctionNotifyPending}
                        onClick={() => {
                          if (!onNotifyCorrection) return;
                          onNotifyCorrection(currentCorrection.id);
                        }}
                      >
                        {correctionNotifyPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="size-4" aria-hidden="true" />
                        )}
                        Confirm — notify Launch Watch subscribers
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={disabled || correctionNotifyPending}
                        onClick={() => patchComm({ notifyArmed: false })}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : onNotifyCorrection ? (
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={disabled || correctionNotifyPending}
                      onClick={() => patchComm({ notifyArmed: true })}
                    >
                      <Send className="size-4" aria-hidden="true" />
                      Notify subscribers about this correction
                    </Button>
                  ) : null}
                  {correctionNotifyResult ? (
                    <div
                      role="status"
                      className="rounded-md border border-border bg-background/40 px-3 py-2"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                        {correctionNotifyResult.status === "queued"
                          ? "Queued for delivery"
                          : "Already notified"}
                      </p>
                      {correctionNotifyResult.status === "queued" ? (
                        <Note>
                          {correctionNotifyResult.delivery_count} deliveries were queued. Queued is
                          not the same as delivered — Telegram delivery is reported separately.
                        </Note>
                      ) : (
                        <Note>
                          This correction was already announced to subscribers. Nothing was queued or
                          sent again.
                        </Note>
                      )}
                    </div>
                  ) : null}
                  {correctionNotifyError ? (
                    <div
                      role="alert"
                      className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
                        Not queued
                      </p>
                      <Note>{correctionNotifyError}</Note>
                    </div>
                  ) : null}
                </div>

                {/* B — one connected Telegram community */}
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Post this correction to one community
                  </p>
                  {groupsLoading ? (
                    <Note>Loading connected communities…</Note>
                  ) : (groups ?? []).length === 0 ? (
                    <Note>No connected Telegram community is available for this project.</Note>
                  ) : (
                    <ul className="space-y-2">
                      {(groups ?? []).map((group) => {
                        const active = group.id === commState.groupId;
                        return (
                          <li key={group.id}>
                            <button
                              type="button"
                              disabled={disabled || !group.ready || correctionBroadcastPending}
                              aria-pressed={active}
                              onClick={() => patchComm({ groupId: group.id, groupArmed: false })}
                              className={`min-h-11 w-full rounded-md border px-3 py-2 text-left disabled:opacity-60 ${
                                active
                                  ? "border-[color:var(--cartel-gold,#D4A82A)] bg-[color:var(--cartel-gold,#D4A82A)]/10"
                                  : "border-border bg-background/40"
                              }`}
                            >
                              <span className="block truncate text-xs text-foreground">
                                {group.title}
                              </span>
                              {!group.ready ? (
                                <span className="mt-1 block text-[11px] text-muted-foreground">
                                  The bot is not an administrator in this community yet.
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {commState.groupId ? (
                    commState.groupArmed ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          className="min-h-11"
                          disabled={disabled || correctionBroadcastPending}
                          onClick={() =>
                            onBroadcastCorrection?.(commState.groupId!, currentCorrection.id)
                          }
                        >
                          {correctionBroadcastPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Megaphone className="size-4" aria-hidden="true" />
                          )}
                          Confirm — post this correction
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11"
                          disabled={disabled || correctionBroadcastPending}
                          onClick={() => patchComm({ groupArmed: false })}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={disabled || correctionBroadcastPending}
                        onClick={() => patchComm({ groupArmed: true })}
                      >
                        <Megaphone className="size-4" aria-hidden="true" />
                        Review community post
                      </Button>
                    )
                  ) : (
                    <Note>Select one community to continue.</Note>
                  )}
                  {correctionBroadcastResult ? (
                    <div
                      role="status"
                      className="rounded-md border border-border bg-background/40 px-3 py-2"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                        {correctionBroadcastResult.status === "SENT"
                          ? correctionBroadcastResult.duplicate
                            ? "Already posted"
                            : "Posted"
                          : correctionBroadcastResult.status === "FAILED"
                            ? "Not posted"
                            : "Outcome unconfirmed"}
                      </p>
                      <Note>
                        {correctionBroadcastResult.status === "SENT"
                          ? correctionBroadcastResult.duplicate
                            ? "This exact request was already recorded. Nothing was posted again."
                            : "The correction was posted to the selected community."
                          : correctionBroadcastResult.status === "FAILED"
                            ? (correctionBroadcastResult.message ??
                              "The community post did not go out.")
                            : "This post was not confirmed either way. Nothing is retried automatically — check the community before deciding to act again."}
                      </Note>
                    </div>
                  ) : null}
                  {correctionBroadcastError ? (
                    <div
                      role="alert"
                      className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
                        Not posted
                      </p>
                      <Note>{correctionBroadcastError}</Note>
                      <Note>Nothing is retried automatically.</Note>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
