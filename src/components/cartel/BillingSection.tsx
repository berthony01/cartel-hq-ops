import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CreditCard, Crown, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";

/**
 * Billing section. Display only: the plan shown here comes from
 * get_workspace_billing_status. This component never grants a plan;
 * Pro activates only from the Stripe webhook confirmation.
 */

type Counter = { used: number; limit: number | null; period: string };
type BillingStatus = {
  ok: boolean;
  reason?: string;
  unrestricted?: boolean;
  plan?: { code: string; version: number; name: string; virtual?: boolean } | null;
  enforcement_mode?: string | null;
  subscription?: {
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
    payment_issue: boolean;
    environment: string;
  } | null;
  usage?: Record<string, Counter> | null;
  can_upgrade?: boolean;
  can_manage_billing?: boolean;
};

const USAGE_LABELS: Record<string, string> = {
  static_ai_generations: "Static AI stickers this month",
  motion_ai_generations: "Motion AI stickers this month",
  x_missions: "X Missions this month",
  telegram_groups: "Connected Telegram groups",
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function BillingSection() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? null;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"upgrade" | "manage" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<"success" | "cancelled" | null>(null);

  const statusQuery = useQuery({
    queryKey: ["workspace-billing-status", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_workspace_billing_status", { _workspace_id: workspaceId! });
      if (error) throw error;
      return data as unknown as BillingStatus;
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (billing === "success" || billing === "cancelled") setNotice(billing);
  }, []);

  // After checkout, refetch a few times while Stripe's confirmation arrives. Never grants locally.
  useEffect(() => {
    if (notice !== "success" || !workspaceId) return;
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      void queryClient.invalidateQueries({ queryKey: ["workspace-billing-status", workspaceId] });
      if (n >= 6) window.clearInterval(id);
    }, 5000);
    return () => window.clearInterval(id);
  }, [notice, workspaceId, queryClient]);

  async function invoke(fn: "billing-checkout" | "billing-portal") {
    if (!workspaceId) return;
    setActionError(null);
    setBusy(fn === "billing-checkout" ? "upgrade" : "manage");
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { workspaceId } });
      const url = (data as { url?: string } | null)?.url;
      if (error || !url) {
        let message = "Billing is not available right now.";
        const ctx = (error as { context?: Response } | null)?.context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.json();
            if (body?.message) message = body.message;
          } catch {
            /* keep default */
          }
        }
        setActionError(message);
        return;
      }
      window.location.assign(url);
    } finally {
      setBusy(null);
    }
  }

  const s = statusQuery.data;
  const isPro = s?.plan?.code === "cartel_49";
  const sub = s?.subscription ?? null;

  return (
    <div id="billing" className="scroll-mt-24">
      <Section
        variant="primary"
        className="rise-in"
        title="Billing"
        description="Your Cartel HQ plan for this workspace."
        leading={<CreditCard className="size-4 text-gold" aria-hidden="true" />}
      >
        <div className="space-y-4">
          {notice === "success" && (
            <p className="rounded-md border border-pepe/30 bg-pepe/5 px-3 py-2 text-sm text-foreground">
              Payment received. Pro activates as soon as Stripe confirms it — this can take a moment.
            </p>
          )}
          {notice === "cancelled" && (
            <p className="rounded-md border border-border/70 bg-surface-raised/50 px-3 py-2 text-sm text-muted-foreground">
              Checkout was cancelled. Nothing changed.
            </p>
          )}

          {statusQuery.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading plan…
            </p>
          )}
          {statusQuery.isError && <p className="text-sm text-destructive">Could not load billing status.</p>}
          {s && !s.ok && <p className="text-sm text-muted-foreground">Billing is visible to workspace owners and admins.</p>}

          {s?.ok && s.unrestricted && (
            <div className="flex items-center gap-2">
              <Crown className="size-4 text-gold" aria-hidden="true" />
              <span className="text-sm font-semibold text-foreground">Platform Owner — Unrestricted</span>
            </div>
          )}

          {s?.ok && !s.unrestricted && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-xl uppercase text-foreground">
                  {isPro ? "Cartel HQ Pro" : "Cartel HQ Free"}
                </span>
                <StatusBadge tone={isPro ? "success" : "muted"}>{isPro ? "$49/month" : "$0"}</StatusBadge>
              </div>
              <p className="text-sm text-muted-foreground">
                {isPro
                  ? "Everything in Free plus AI stickers, motion, concepts, X reads and Missions, Sticker Drops, auto-posting, official broadcasts, Project Inbox and Launch Watch. Includes 100 static AI stickers, 10 motion AI stickers and 100 X Missions per month."
                  : "Project Identity and profile, 1 Telegram group, and welcome setup, testing and delivery."}
              </p>

              {sub?.payment_issue && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                  <span>There is a problem with your payment. Update your payment method in Manage Billing to keep Pro.</span>
                </div>
              )}
              {sub?.cancel_at_period_end && sub.current_period_end && (
                <p className="text-sm text-muted-foreground">
                  Pro is cancelled and stays active through {formatDate(sub.current_period_end)}.
                </p>
              )}

              {s.usage && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(USAGE_LABELS)
                    .filter(([k]) => s.usage?.[k])
                    .map(([k, label]) => {
                      const c = s.usage![k];
                      return (
                        <li key={k} className="rounded-md border border-border/70 bg-surface-raised/40 px-3 py-2 text-sm">
                          <span className="block text-muted-foreground">{label}</span>
                          <span className="font-semibold text-foreground">
                            {c.used} / {c.limit === null ? "Unlimited" : c.limit}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}

              {actionError && <p className="text-sm text-destructive">{actionError}</p>}
              <div className="flex flex-wrap gap-2">
                {s.can_upgrade && (
                  <Button onClick={() => invoke("billing-checkout")} disabled={busy !== null}>
                    {busy === "upgrade" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    Upgrade to Pro — $49/month
                  </Button>
                )}
                {s.can_manage_billing && (
                  <Button variant="outline" onClick={() => invoke("billing-portal")} disabled={busy !== null}>
                    {busy === "manage" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    Manage Billing
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}
