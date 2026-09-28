import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { POLICY_DRAFTS } from "@/lib/legal-policies";
import { fetchPendingAcceptances, policyKeys, recordAcceptances } from "@/lib/policy-acceptance";
import { useSession } from "@/hooks/useSession";
import { Button } from "@/components/ui/button";

/**
 * Prompts existing users only when a NEW effective version requires
 * acceptance. With the staged policy RPCs absent, the pending list is
 * empty and nothing renders.
 */
export function PolicyAcceptancePrompt() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pending = useQuery({
    queryKey: policyKeys.pending(userId),
    enabled: !!userId,
    queryFn: fetchPendingAcceptances,
    staleTime: 5 * 60_000,
  });
  const items = pending.data ?? [];
  if (items.length === 0) return null;

  return (
    <div role="region" aria-label="Updated policies" className="mb-6 rounded-lg border border-gold/40 bg-gold/5 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileText className="size-4 text-gold" aria-hidden="true" /> Updated policies require your acceptance
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 text-xs">
        {items.map((p) => (
          <li key={p.document_type}>
            <Link to={POLICY_DRAFTS[p.document_type].path} target="_blank" className="inline-flex min-h-11 items-center text-gold underline-offset-4 hover:underline">
              {POLICY_DRAFTS[p.document_type].title} v{p.version}
            </Link>
          </li>
        ))}
      </ul>
      <label className="mt-1 flex min-h-11 items-center gap-3 text-xs text-muted-foreground">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="size-5 accent-[var(--gold)]" />
        I have read and accept the updated versions listed above.
      </label>
      {err && <p role="alert" className="text-xs text-signal">{err}</p>}
      <Button
        className="mt-2 min-h-11"
        disabled={!checked || busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await recordAcceptances(items, "prompt");
            await qc.invalidateQueries({ queryKey: policyKeys.pending(userId) });
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Could not record acceptance.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Accept
      </Button>
    </div>
  );
}
