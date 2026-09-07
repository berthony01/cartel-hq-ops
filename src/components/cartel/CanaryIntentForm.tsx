import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CANARY_REQUIRED_LAUNCH_CHAIN } from "@/lib/chain-mainnet-canary-intent";

/**
 * P3C-F1 — presentation only for the canary's exact production intent.
 *
 * This component holds no authority, calls nothing and decides nothing: the
 * owner-only server wrappers and the authoritative RPCs remain the boundary.
 */

export type CanaryLaunchOption = {
  id: string;
  token_name: string | null;
  ticker: string | null;
  status: string | null;
  chain: string | null;
};

export type CanaryIntentFormProps = {
  launches: CanaryLaunchOption[];
  launchId: string;
  onSelectLaunch: (launchId: string) => void;
  deployer: string;
  onDeployer: (value: string) => void;
  recipient: string;
  onRecipient: (value: string) => void;
  name: string;
  onName: (value: string) => void;
  symbol: string;
  onSymbol: (value: string) => void;
  supplyWhole: string;
  onSupplyWhole: (value: string) => void;
  selectedChain: string | null;
  chainEligible: boolean;
};

export function CanaryIntentForm(props: CanaryIntentFormProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="canary-launch">Launch</Label>
          <select
            id="canary-launch"
            className="h-9 w-full rounded-md border border-border bg-surface-raised px-2 text-sm"
            value={props.launchId}
            onChange={(event) => props.onSelectLaunch(event.target.value)}
          >
            <option value="">Select a launch…</option>
            {props.launches.map((row) => (
              <option key={row.id} value={row.id}>
                {row.token_name} · {row.ticker} · {row.status}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="canary-deployer">Deployer wallet</Label>
          <Input
            id="canary-deployer"
            value={props.deployer}
            onChange={(event) => props.onDeployer(event.target.value)}
            placeholder="0x…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canary-recipient">Initial recipient</Label>
          <Input
            id="canary-recipient"
            value={props.recipient}
            onChange={(event) => props.onRecipient(event.target.value)}
            placeholder="0x…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canary-name">Token name</Label>
          <Input
            id="canary-name"
            value={props.name}
            onChange={(event) => props.onName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canary-symbol">Onchain symbol</Label>
          <Input
            id="canary-symbol"
            value={props.symbol}
            onChange={(event) => props.onSymbol(event.target.value)}
            placeholder="PCART"
          />
          <p className="text-[11px] text-muted-foreground">
            2–11 uppercase letters or digits. The launch display ticker is never changed by this
            console.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canary-supply">Total supply (whole tokens)</Label>
          <Input
            id="canary-supply"
            value={props.supplyWhole}
            onChange={(event) => props.onSupplyWhole(event.target.value)}
            placeholder="1000000"
          />
          <p className="text-[11px] text-muted-foreground">
            Whole tokens. The exact base-unit value (×10¹⁸) is what reaches the production record.
          </p>
        </div>
      </div>

      {props.launchId && !props.chainEligible ? (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Blocked: this launch records its chain as{" "}
            <strong>{props.selectedChain?.trim() || "—"}</strong>, not{" "}
            <strong>{CANARY_REQUIRED_LAUNCH_CHAIN}</strong>. Reconcile the launch metadata in Launch
            Control before any production attempt. This console will not change the launch record.
          </span>
        </div>
      ) : null}
    </div>
  );
}
