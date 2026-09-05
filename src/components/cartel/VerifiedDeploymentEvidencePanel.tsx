import { CheckCircle2, Loader2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import {
  VERIFIED_DEPLOYMENT_DISCLAIMER,
  type DeploymentEvidenceResult,
  type EvidenceCheck,
  type LaunchEvidenceEvaluation,
} from "@/lib/launch-verified-eligibility";

/**
 * C8.7A — READ ONLY evidence panel.
 *
 * This component renders a pure evaluation object. It has no mutation, no RPC
 * call, no wallet interaction, no lifecycle control and no registration or
 * notification action of any kind.
 */

function CheckLine({ item }: { item: EvidenceCheck }) {
  const Icon = item.state === "PASS" ? CheckCircle2 : item.state === "FAIL" ? XCircle : ShieldAlert;
  const tone =
    item.state === "PASS"
      ? "text-emerald-500"
      : item.state === "FAIL"
        ? "text-destructive"
        : "text-[color:var(--cartel-gold,#D4A82A)]";
  return (
    <li className="flex items-start gap-2">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="min-w-0 text-xs leading-relaxed">
        <span className="text-foreground">{item.label}</span>
        <span className="text-muted-foreground"> — {item.detail}</span>
      </span>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </dt>
      <dd className="break-all font-mono text-xs text-foreground">
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </dd>
    </div>
  );
}

function DeploymentCard({ item }: { item: DeploymentEvidenceResult }) {
  return (
    <li className="rounded-md border border-border/70 bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
          Attempt #{item.attemptNumber}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] ${
              item.evidenceVerified
                ? "border-emerald-500/40 text-emerald-500"
                : "border-border text-muted-foreground"
            }`}
          >
            {item.evidenceVerified
              ? item.environment === "TESTNET"
                ? "Verified test deployment"
                : "Verified deployment"
              : "Evidence incomplete"}
          </span>
          {item.officialRegistrationEligible ? (
            <span className="rounded-sm border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-emerald-500">
              Eligible for official registration
            </span>
          ) : (
            <span className="rounded-sm border border-destructive/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-destructive">
              Official registration blocked
            </span>
          )}
          {item.ambiguous ? (
            <span className="rounded-sm border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              Ambiguous
            </span>
          ) : null}
        </div>
      </div>


      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
        <Field label="Deployment id" value={item.deploymentId} />
        <Field label="Kind" value={item.deploymentKind} />
        <Field label="Environment" value={item.environment} />
        <Field label="Chain id" value={item.chainId} />
        <Field label="Network" value={item.networkLabel} />
        <Field label="Confirmations" value={item.confirmations} />
        <Field label="Contract" value={item.contractAddress} />
        <Field label="Transaction" value={item.txHash} />
        <Field label="Artifact" value={item.artifactId} />
        <Field label="Verified at" value={item.verifiedAt} />
        <Field label="Submitted at" value={item.submittedAt} />
        <Field label="Block" value={item.blockNumber} />
        <Field label="Token name" value={item.verifiedTokenName} />
        <Field label="Token symbol" value={item.verifiedTokenSymbol} />
        <Field label="Decimals" value={item.verifiedTokenDecimals} />
        <Field label="Total supply" value={item.verifiedTotalSupplyText} />
        <Field label="Recipient balance" value={item.verifiedRecipientBalanceText} />
      </dl>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Chain evidence
          </p>
          <ul className="mt-1.5 space-y-1">
            {item.evidenceChecks.map((c) => (
              <CheckLine key={c.id} item={c} />
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Official registration eligibility
          </p>
          <ul className="mt-1.5 space-y-1">
            {item.registrationChecks.map((c) => (
              <CheckLine key={c.id} item={c} />
            ))}
          </ul>
        </div>
      </div>
    </li>
  );
}

export function VerifiedDeploymentEvidencePanel({
  evaluation,
  loading,
  error,
}: {
  evaluation: LaunchEvidenceEvaluation | null;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <Section
      variant="surface"
      title="Cartel Verified Launch — deployment evidence"
      description="Chain-derived deployment evidence for this launch, and why it can or cannot be considered for official contract registration."
      leading={
        <ShieldCheck
          className="size-4 text-[color:var(--cartel-gold,#D4A82A)]"
          aria-hidden="true"
        />
      }
      actions={
        <span className="rounded-sm border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          Evidence only — registration is confirmed separately
        </span>
      }

    >
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Loading deployment evidence…
        </p>
      ) : error ? (
        <p className="text-xs leading-relaxed text-destructive">{error}</p>
      ) : !evaluation ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Deployment evidence is not available for this launch.
        </p>
      ) : (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
            <Field label="Declared chain" value={evaluation.declaredChain} />
            <Field label="Lifecycle status" value={evaluation.launchStatus} />
            <Field label="Recorded deployments" value={evaluation.totalDeployments} />
            <Field label="Verified deployments" value={evaluation.verifiedCount} />
          </dl>

          <div
            className={`rounded-md border px-3 py-2 ${
              evaluation.eligibleForOfficialRegistration > 0
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-destructive/40 bg-destructive/5"
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-[0.12em] ${
                evaluation.eligibleForOfficialRegistration > 0
                  ? "text-emerald-500"
                  : "text-destructive"
              }`}
            >
              {evaluation.eligibleForOfficialRegistration} eligible for official registration
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {evaluation.summaryLabel}
              {evaluation.testnetVerifiedCount > 0
                ? ` ${evaluation.testnetVerifiedCount} of them are test network deployments, which can never become this project's official contract.`
                : ""}
            </p>
            {evaluation.ambiguous ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Multiple confirmed deployments are present. No candidate is selected automatically,
                and older confirmed records are still shown below.
              </p>
            ) : null}
          </div>


          {evaluation.deployments.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              No deployment records exist for this launch yet.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {evaluation.deployments.map((item) => (
                <DeploymentCard key={item.deploymentId} item={item} />
              ))}
            </ul>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            {VERIFIED_DEPLOYMENT_DISCLAIMER}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This panel only reads and explains recorded evidence. It cannot register a contract,
            change the launch lifecycle, or notify anyone.
          </p>
        </div>
      )}
    </Section>
  );
}
