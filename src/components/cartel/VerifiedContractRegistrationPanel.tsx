import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTRACT_MAX } from "@/lib/launch-control";
import {
  REGISTRATION_LIFECYCLE_STATUS,
  type DeploymentEvidenceResult,
  type LaunchEvidenceEvaluation,
} from "@/lib/launch-verified-eligibility";

/**
 * C8.7B closeout — the ONLY official contract registration surface.
 *
 * This component owns no data access. It consumes an already-computed
 * `LaunchEvidenceEvaluation`, imports no Supabase client, runs no query and
 * calls no RPC. Registration is handed upward through `onRegister`, and the
 * database re-derives every predicate independently and remains authoritative.
 *
 * Registering an official contract states only that the authenticated project
 * bound a specific verified deployment record. It is not a safety check, an
 * audit, an endorsement, or any statement about legitimacy or value.
 */

export type VerifiedContractRegistrationPanelProps = {
  evaluation: LaunchEvidenceEvaluation | null;
  launchId: string | null;
  launchStatus: string;
  officialContractAddress: string | null;
  officialContractDeploymentId: string | null;
  contractRegisteredAt: string | null;
  /** Presentation hint only. The database enforces owner-only registration. */
  isWorkspaceOwner: boolean;
  disabled?: boolean;
  pending?: boolean;
  onRegister: (deploymentId: string, expectedAddress: string) => void;
};

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function CandidateSummary({ item }: { item: DeploymentEvidenceResult }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-500">
        Eligible deployment — attempt #{item.attemptNumber}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-foreground">{item.contractAddress}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {item.networkLabel} · {item.verifiedTokenName} ({item.verifiedTokenSymbol}) ·{" "}
        {item.confirmations} confirmations
      </p>
    </div>
  );
}

export function VerifiedContractRegistrationPanel({
  evaluation,
  launchId,
  launchStatus,
  officialContractAddress,
  officialContractDeploymentId,
  contractRegisteredAt,
  isWorkspaceOwner,
  disabled,
  pending,
  onRegister,
}: VerifiedContractRegistrationPanelProps) {
  const eligible = (evaluation?.deployments ?? []).filter((d) => d.officialRegistrationEligible);
  const soleEligibleId = eligible.length === 1 ? (eligible[0] as DeploymentEvidenceResult).deploymentId : null;

  const [selectedId, setSelectedId] = useState<string | null>(soleEligibleId);
  const [confirmInput, setConfirmInput] = useState("");

  // Selection resets whenever the launch changes, and whenever the set of
  // eligible candidates changes shape. Exactly one candidate may be selected
  // automatically; two or more must always start with nothing preselected.
  const eligibleKey = eligible.map((d) => d.deploymentId).join("|");
  useEffect(() => {
    setSelectedId(eligible.length === 1 ? (eligible[0] as DeploymentEvidenceResult).deploymentId : null);
    setConfirmInput("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchId, eligibleKey]);

  // Retyped confirmation is always re-armed when the chosen candidate changes.
  useEffect(() => {
    setConfirmInput("");
  }, [selectedId]);

  const selected = eligible.find((d) => d.deploymentId === selectedId) ?? null;
  const expectedAddress = selected?.contractAddress ?? null;
  const confirmMatches =
    expectedAddress != null &&
    confirmInput.trim().toLowerCase() === expectedAddress.trim().toLowerCase();

  const registrationFieldsPresent = [
    officialContractAddress,
    officialContractDeploymentId,
    contractRegisteredAt,
  ].filter((v) => v != null && String(v).trim() !== "").length;
  const fullyRegistered = registrationFieldsPresent === 3;
  const partiallyRegistered = registrationFieldsPresent > 0 && registrationFieldsPresent < 3;

  const atRegistrationStage = launchStatus === REGISTRATION_LIFECYCLE_STATUS;

  let body: React.ReactNode;

  if (partiallyRegistered) {
    body = (
      <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
          Registration record is incomplete
        </p>
        <Note>
          This launch carries some but not all of the registration fields. No registration action is
          offered while the record is inconsistent.
        </Note>
      </div>
    );
  } else if (fullyRegistered) {
    body = (
      <div className="space-y-2">
        <p className="break-all rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs text-foreground">
          {officialContractAddress}
        </p>
        <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Bound deployment
            </dt>
            <dd className="break-all font-mono text-xs text-foreground">
              {officialContractDeploymentId}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Registered at
            </dt>
            <dd className="break-all font-mono text-xs text-foreground">{contractRegisteredAt}</dd>
          </div>
        </dl>
        <Note>
          Official contract registered by the authenticated project and bound to a specific verified
          deployment record. It is not a safety check, an audit, or an investment guarantee.
        </Note>
        <Note>A registered contract cannot be replaced or cleared.</Note>
      </div>
    );
  } else if (!atRegistrationStage) {
    body = (
      <Note>
        Registration is only available at Contract Pending. This launch is {launchStatus}. The
        address is never typed in freehand — it is always derived from a verified deployment record
        for this launch.
      </Note>
    );
  } else if (eligible.length === 0) {
    body = (
      <div className="space-y-2">
        <Note>
          No deployment currently qualifies for official registration, so there is nothing to
          register. The address cannot be typed in freehand.
        </Note>
        <Note>
          The deployment evidence panel below explains exactly which check is blocking each recorded
          deployment.
        </Note>
      </div>
    );
  } else if (!isWorkspaceOwner) {
    body = (
      <div className="space-y-2">
        <Note>
          {eligible.length === 1
            ? "One deployment qualifies for official registration."
            : `${eligible.length} deployments qualify for official registration.`}
        </Note>
        <Note>
          Only the project owner can register the official contract. Admin access is not sufficient.
        </Note>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {eligible.length > 1 ? (
          <div className="space-y-2">
            <Note>
              {eligible.length} deployments qualify. No candidate is selected automatically — choose
              exactly which verified deployment should become this project&apos;s official contract.
            </Note>
            <ul className="space-y-2">
              {eligible.map((item) => {
                const active = item.deploymentId === selectedId;
                return (
                  <li key={item.deploymentId}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.deploymentId)}
                      aria-pressed={active}
                      className={`w-full rounded-md border px-3 py-2 text-left ${
                        active
                          ? "border-emerald-500/70 bg-emerald-500/10"
                          : "border-border bg-background/40"
                      }`}
                    >
                      <CandidateSummary item={item} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : selected ? (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2">
            <CandidateSummary item={selected} />
          </div>
        ) : null}

        {selected ? (
          <>
            <div className="min-w-0">
              <Label htmlFor="verified-contract-confirm">
                Type the contract address to confirm
              </Label>
              <Input
                id="verified-contract-confirm"
                maxLength={CONTRACT_MAX}
                disabled={disabled || pending}
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Re-type the address shown above"
              />
            </div>
            <Note>
              Registration is permanent, owner-only and cannot be replaced afterwards. It does not
              advance the launch status and sends no watcher or Telegram message on its own.
            </Note>
            <Button
              className="min-h-11"
              disabled={disabled || pending || !confirmMatches}
              onClick={() => onRegister(selected.deploymentId, selected.contractAddress ?? "")}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              Register official contract
            </Button>
          </>
        ) : (
          <Note>Select a candidate deployment to continue.</Note>
        )}
      </div>
    );
  }

  return (
    <Section
      variant="surface"
      title="Official contract"
      description="Bind this launch to one verified deployment record. The address is always derived from that evidence, never typed in freehand."
      leading={
        partiallyRegistered ? (
          <ShieldAlert className="size-4 text-destructive" aria-hidden="true" />
        ) : (
          <ShieldCheck
            className="size-4 text-[color:var(--cartel-gold,#D4A82A)]"
            aria-hidden="true"
          />
        )
      }
    >
      {body}
    </Section>
  );
}
