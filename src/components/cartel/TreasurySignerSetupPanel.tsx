import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  displaySigner,
  getLaunchTreasurySigners,
  saveLaunchTreasurySigners,
  treasurySignerConfigQueryKey,
  validateSigners,
  type TreasurySignerConfig,
} from "@/lib/treasury-signers";

/**
 * PEPECARTEL Treasury Setup — records the three INTENDED public signer wallet
 * addresses only. It does not create a Safe, does not sign anything, does not
 * move funds and does not authorize any launch. No private key or seed phrase
 * is ever requested or stored. Threshold is fixed at 2 of 3 and is not
 * editable here. This panel does not gate production request submission.
 */

export type TreasurySignerSetupPanelProps = {
  launchId: string;
  isWorkspaceOwner: boolean;
  disabled?: boolean | undefined;
  /** Canonical PCART guided flow: show a compact summary once signers are saved. */
  compact?: boolean | undefined;
};

const EMPTY_FIELDS: [string, string, string] = ["", "", ""];

export function TreasurySignerSetupPanel({
  launchId,
  isWorkspaceOwner,
  disabled,
  compact,
}: TreasurySignerSetupPanelProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<[string, string, string]>(EMPTY_FIELDS);
  const [showErrors, setShowErrors] = useState(false);

  const configQuery = useQuery({
    queryKey: treasurySignerConfigQueryKey(launchId),
    queryFn: () => getLaunchTreasurySigners(launchId),
  });

  const config: TreasurySignerConfig | null = configQuery.data ?? null;

  useEffect(() => {
    setEditing(false);
    setShowErrors(false);
    setFields(EMPTY_FIELDS);
  }, [launchId]);

  const saveMutation = useMutation({
    mutationFn: (signers: string[]) => saveLaunchTreasurySigners({ launchId, signers }),
    onSuccess: (saved) => {
      queryClient.setQueryData(treasurySignerConfigQueryKey(launchId), saved);
      void queryClient.invalidateQueries({
        queryKey: treasurySignerConfigQueryKey(launchId),
      });
      setEditing(false);
      setShowErrors(false);
    },
  });

  const validation = useMemo(() => validateSigners(fields), [fields]);
  const errorFor = (index: number) =>
    showErrors && !validation.ok
      ? (validation.errors.find((e) => e.index === index)?.message ?? null)
      : null;

  const busy = saveMutation.isPending;
  const formOpen = editing || (!config && isWorkspaceOwner);
  const saveError =
    saveMutation.error instanceof Error ? saveMutation.error.message : null;

  if (compact && config && !formOpen) {
    return (
      <div className="min-w-0 space-y-2 rounded-lg border border-pepe/35 bg-pepe/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2 className="size-4" aria-hidden="true" />3 signer wallets saved
          </p>
          <StatusBadge tone="green">
            <span>Signers ready</span>
          </StatusBadge>
        </div>
        <p className="text-xs text-muted-foreground">2 of 3 approvals required</p>
        <details className="min-w-0 text-xs text-muted-foreground">
          <summary className="cursor-pointer">View signer wallets</summary>
          <ul className="mt-2 min-w-0 space-y-0.5 font-mono text-foreground [overflow-wrap:anywhere]">
            {config.signers.map((signer) => (
              <li key={signer}>{displaySigner(signer)}</li>
            ))}
          </ul>
        </details>
        {isWorkspaceOwner ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-11"
            disabled={disabled}
            onClick={() => {
              setFields([config.signers[0], config.signers[1], config.signers[2]]);
              setShowErrors(false);
              setEditing(true);
            }}
          >
            Edit
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-border-subtle bg-surface-raised/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Step 1 · Before deployment
          </p>
          <p className="flex items-center gap-2 text-sm font-semibold leading-snug text-foreground">
            <KeyRound className="size-4" aria-hidden="true" />
            Treasury signer setup
          </p>
        </div>
        {configQuery.isLoading ? (
          <StatusBadge tone="gold">
            <span>Loading</span>
          </StatusBadge>
        ) : config ? (
          <StatusBadge tone="green">
            <span>Signers ready</span>
          </StatusBadge>
        ) : (
          <StatusBadge tone="gold">
            <span>Not set</span>
          </StatusBadge>
        )}
      </div>

      <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
        <li>These are three keys to one treasury, not three wallets that receive the token.</li>
        <li>
          The treasury will use 2-of-3 approval, so any two signer wallets can approve a treasury
          action.
        </li>
        <li>Enter public 0x wallet addresses only. Never enter a seed phrase or private key.</li>
        <li>
          You can change these addresses before the Safe is created. Creating/changing the Safe
          later is a separate step.
        </li>
        <li>
          Saving here only records your intended signers. It does not create a Safe, sign anything,
          move funds, or authorize launch.
        </li>
      </ul>

      {configQuery.error instanceof Error ? (
        <p className="text-xs leading-relaxed text-signal">{configQuery.error.message}</p>
      ) : null}

      {config && !formOpen ? (
        <div className="min-w-0 space-y-2 rounded-md border border-pepe/35 bg-pepe/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Signers ready
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The Safe has not been created yet. These are the wallets you intend to use as its
            signers.
          </p>
          <ul className="min-w-0 space-y-0.5 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
            {config.signers.map((signer) => (
              <li key={signer}>{displaySigner(signer)}</li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Signatures required: 2 of 3 (fixed)
          </p>
          {isWorkspaceOwner ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-h-11"
              disabled={disabled}
              onClick={() => {
                setFields([config.signers[0], config.signers[1], config.signers[2]]);
                setShowErrors(false);
                setEditing(true);
              }}
            >
              Edit
            </Button>
          ) : null}
        </div>
      ) : null}

      {!config && !isWorkspaceOwner ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Not set. Only the workspace owner can record the signer wallets.
        </p>
      ) : null}

      {formOpen ? (
        <div className="min-w-0 space-y-3">
          {[0, 1, 2].map((index) => {
            const fieldError = errorFor(index);
            return (
              <div key={index} className="min-w-0 space-y-1.5">
                <Label htmlFor={`treasury-signer-${index + 1}`}>
                  Signer wallet {index + 1}
                </Label>
                <Input
                  id={`treasury-signer-${index + 1}`}
                  className="min-h-11 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={42}
                  placeholder="0x…"
                  disabled={disabled || busy}
                  value={fields[index] ?? ""}
                  onChange={(e) => {
                    const next: [string, string, string] = [...fields];
                    next[index] = e.target.value;
                    setFields(next);
                  }}
                />
                {fieldError ? (
                  <p className="text-xs leading-relaxed text-signal">{fieldError}</p>
                ) : null}
              </div>
            );
          })}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Signatures required: 2 of 3 (fixed)
          </p>

          {saveError ? (
            <p className="text-xs leading-relaxed text-signal">{saveError}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              disabled={disabled || busy}
              onClick={() => {
                setShowErrors(true);
                if (!validation.ok) return;
                saveMutation.mutate([...validation.signers]);
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save signer wallets
            </Button>
            {config ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setShowErrors(false);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
