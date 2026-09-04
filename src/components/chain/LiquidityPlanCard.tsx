import { AlertTriangle, CheckCircle2, Lock, XCircle } from "lucide-react";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { explorerAddressUrl } from "@/lib/chain-registry";
import {
  LIQUIDITY_NATIVE_DECIMALS,
  LIQUIDITY_PLAN_TTL_MS,
  LIQUIDITY_QUOTE_ASSET_LABEL,
  formatBaseUnits,
  isLiquidityPlanFresh,
  liquidityPlanAgeMs,
  type LiquidityCheck,
  type LiquidityPlan,
} from "@/lib/liquidity-plan";

/**
 * C8.6A — read-only liquidity plan review (TESTNET, PLAN ONLY).
 *
 * Renders a derived plan. It holds no state, sends no request, and exposes no
 * approval, signing, pool-creation or liquidity action of any kind.
 */

function CheckRow({ item }: { item: LiquidityCheck }) {
  const icon =
    item.status === "PASS" ? (
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
    ) : item.status === "FAIL" ? (
      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
    ) : (
      <Lock className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
    );
  return (
    <li className="flex items-start gap-2">
      {icon}
      <span className="min-w-0">
        <span className="text-foreground">{item.label}</span>
        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {item.status}
        </span>
        <span className="block break-all text-muted-foreground">{item.detail}</span>
      </span>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="break-all text-foreground">{value}</p>
    </div>
  );
}

export function LiquidityPlanCard({ plan, nowMs }: { plan: LiquidityPlan; nowMs: number }) {
  const fresh = isLiquidityPlanFresh(plan, nowMs);
  const secondsLeft = Math.max(
    0,
    Math.ceil((LIQUIDITY_PLAN_TTL_MS - liquidityPlanAgeMs(plan, nowMs)) / 1000),
  );
  const { intent } = plan;

  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-surface-raised/60 p-3 text-xs leading-relaxed">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={!fresh ? "muted" : plan.planValid ? "green" : "red"}>
          {!fresh ? "Plan expired" : plan.planValid ? "Plan valid" : "Plan invalid"}
        </StatusBadge>
        <StatusBadge tone="red">Execution blocked</StatusBadge>
        <span className="text-muted-foreground">
          {fresh ? `Expires in ${secondsLeft}s` : "Build the plan again."}
        </span>
      </div>

      <p className="mt-2 font-semibold uppercase tracking-wide text-gold">
        Plan only — no approval or liquidity transaction will be sent.
      </p>
      <p className="text-muted-foreground">
        Robinhood Chain Testnet liquidity infrastructure is not yet verified, so execution remains
        blocked. Testnet only. This is not an endorsement, an audit or a safety guarantee, and it is
        not the official PEPECARTEL token.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field
          label="Token"
          value={`${intent.tokenName || "—"} (${intent.tokenSymbol || "—"}) · ${intent.tokenDecimals} decimals`}
        />
        <Field label="Network" value={`${intent.environment} ${intent.chainId}`} />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Token contract
          </p>
          <a
            className="break-all text-gold underline"
            href={explorerAddressUrl(intent.tokenContract)}
            target="_blank"
            rel="noreferrer"
          >
            {intent.tokenContract}
          </a>
        </div>
        <Field label="Operator wallet" value={intent.operator} />
        <Field
          label="Token amount"
          value={`${formatBaseUnits(BigInt(intent.tokenAmountBaseUnits), intent.tokenDecimals)} ${intent.tokenSymbol || "tokens"} · ${intent.tokenAmountBaseUnits} base units`}
        />
        <Field
          label="Pair amount"
          value={`${formatBaseUnits(BigInt(intent.ethAmountWei), LIQUIDITY_NATIVE_DECIMALS)} ETH · ${intent.ethAmountWei} wei`}
        />
        <Field label="Pair asset" value={`${intent.quoteAsset} — ${LIQUIDITY_QUOTE_ASSET_LABEL}`} />
        <Field
          label="Planning bounds"
          value={`${intent.slippageBps} bps slippage · ${intent.deadlineMinutes} min deadline`}
        />
        <Field
          label="Implied price (informational)"
          value={`${intent.impliedEthPerToken ?? "—"} ETH per ${intent.tokenSymbol || "token"}`}
        />
        <Field
          label="Implied price, inverted (informational)"
          value={`${intent.impliedTokensPerEth ?? "—"} ${intent.tokenSymbol || "tokens"} per ETH`}
        />
        <Field label="Source attempt" value={intent.sourceDeploymentId} />
        <Field label="Artifact" value={intent.artifactId} />
      </div>

      <p className="mt-2 break-all text-muted-foreground">
        Plan fingerprint <span className="text-foreground">{intent.fingerprint}</span>
      </p>
      <p className="break-all text-muted-foreground">
        Infrastructure state <span className="text-foreground">{intent.infrastructureState}</span>
      </p>

      <ul className="mt-3 space-y-1.5">
        {plan.checks.map((item) => (
          <CheckRow key={item.key} item={item} />
        ))}
      </ul>

      <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-2.5">
        <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Execution ready: no
        </p>
        {plan.blockers.map((b) => (
          <p key={b} className="mt-1 text-muted-foreground">
            {b}
          </p>
        ))}
      </div>
    </div>
  );
}
