import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  approvePcartReadiness,
  canOfferApproval,
  fetchPcartReadiness,
  pcartReadinessQueryKey,
} from "@/lib/pcart-production-readiness";

/**
 * Canonical PCART production checkpoint. Reads authoritative readiness state.
 * The only action is the owner's database approval record — it never connects
 * a wallet, signs, switches networks or sends anything. Mainnet execution stays
 * locked; the dedicated protected production path is a later phase.
 */
export const PCART_PRODUCTION_ARTIFACT_ID = "pepecartel-token-v1" as const;

function short(v?: string | null) {
  return v ? `${v.slice(0, 6)}…${v.slice(-4)}` : "—";
}

export function PcartProductionBlockedCheckpoint({ launchId }: { launchId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: pcartReadinessQueryKey(launchId),
    queryFn: () => fetchPcartReadiness(launchId),
    retry: false,
  });
  const approve = useMutation({
    mutationFn: () => approvePcartReadiness(launchId),
    onSuccess: async () => {
      toast.success("Production readiness approved. Mainnet stays locked.");
      await qc.invalidateQueries({ queryKey: pcartReadinessQueryKey(launchId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const s = q.data;
  const approved = !!s?.approval;
  const rows: { label: string; done: boolean; note?: string }[] = [
    { label: "Exact PCART rehearsal", done: !!s?.rehearsal_complete },
    { label: "2-of-3 Treasury Safe", done: !!s?.safe_configured },
    { label: "Safe verification", done: !!s?.safe_verified },
    { label: "Final production readiness approval", done: approved, note: approved ? "Approved" : "Pending" },
    { label: "Production artifact allowlist", done: true, note: "Ready after migration" },
  ];

  return (
    <section
      aria-label="PCART production readiness"
      className="min-w-0 rounded-lg border border-gold/40 bg-gold/10 p-4 text-xs leading-relaxed"
    >
      <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-gold">
        {approved ? <ShieldCheck className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
        {approved ? "Production readiness approved" : "PEPECARTEL launch is locked for safety"}
      </p>

      {q.isLoading ? (
        <p className="mt-2 text-muted-foreground">Checking readiness…</p>
      ) : q.isError || !s?.canonical ? (
        <p className="mt-2 text-muted-foreground">Readiness could not be confirmed. The launch stays locked.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-foreground">
              {r.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-gold" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">{r.label}</span>
              <span className="text-muted-foreground">{r.note ?? (r.done ? "Complete" : "Pending")}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 flex items-center gap-2 font-semibold uppercase tracking-wide text-foreground">
        <Lock className="size-3.5" aria-hidden="true" /> Mainnet execution locked
      </p>
      <p className="mt-1 text-muted-foreground">
        {approved
          ? "Next phase: the dedicated protected production deployment path. Nothing here can send a transaction, record an official contract or add liquidity."
          : "Nothing on this page can start the real launch, record an official contract or add liquidity."}
      </p>

      {canOfferApproval(s) ? (
        <>
          <Button className="mt-3 w-full sm:w-auto" onClick={() => setOpen(true)} disabled={approve.isPending}>
            Approve production readiness
          </Button>
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Approve production readiness?</AlertDialogTitle>
                <AlertDialogDescription>
                  This saves a permanent approval record only. It does not use a wallet and sends nothing.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Artifact</dt>
                <dd className="break-all">{PCART_PRODUCTION_ARTIFACT_ID}</dd>
                <dt className="text-muted-foreground">Rehearsal</dt>
                <dd className="break-all">#{s?.rehearsal_attempt_number ?? "—"} · {short(s?.rehearsal_tx_hash)}</dd>
                <dt className="text-muted-foreground">Verified Safe</dt>
                <dd className="break-all">{s?.safe_address}</dd>
                <dt className="text-muted-foreground">Mainnet</dt>
                <dd>Still locked</dd>
                <dt className="text-muted-foreground">Official contract</dt>
                <dd>None exists</dd>
              </dl>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => approve.mutate()}>Confirm approval</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </section>
  );
}
