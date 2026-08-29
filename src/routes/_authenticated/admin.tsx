import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  BadgeCheck,
  Bot,
  Cpu,
  Loader2,
  Lock,
  Send,
  ShieldHalf,
  Sticker,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { InlineRow } from "@/components/cartel/InlineRow";
import { EmptyState } from "@/components/cartel/EmptyState";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { formatCost, formatCount, formatTimestamp } from "@/lib/platform";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Owner Console — CARTEL HQ" },
      {
        name: "description",
        content:
          "Private platform owner console with read-only operational metrics for CARTEL HQ.",
      },
      { property: "og:title", content: "Owner Console — CARTEL HQ" },
      {
        property: "og:description",
        content: "Server-verified platform owner overview for the PEPECARTEL operating layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminPage,
});

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground [overflow-wrap:anywhere]">
        {label}
      </p>
      <p className="mt-1 font-display text-xl leading-none text-gold [overflow-wrap:anywhere]">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{hint}</p>
      ) : null}
    </div>
  );
}

const GRID = "grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3";

function AdminPage() {
  // Always re-checked against the server; never derived from email or storage.
  const { loading, error, isPlatformOwner, hasUnrestrictedAccess, role, capabilities, metrics } =
    usePlatformAccess();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
          Checking access…
        </span>
      </div>
    );
  }

  if (!isPlatformOwner) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <PageHeader
          eyebrow="System"
          title="Unavailable"
          description="This area is restricted."
          status="Restricted"
        />
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description={
            error
              ? "We couldn't verify access for this account right now. Try again in a moment."
              : "This section isn't available for your account."
          }
        />
      </div>
    );
  }

  const m = metrics ?? {};
  const schedulerActive = m.scheduler_job_active === true;

  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Platform Owner"
        title="Owner Console"
        description="Read-only platform overview. Owner identity is verified server-side on every load."
        status="Owner Access"
      />

      <Section
        variant="primary"
        leading={<ShieldHalf className="size-4" aria-hidden="true" />}
        title="Unrestricted Platform Access"
        description="Server-verified platform owner. This account is not limited by workspace-level roles."
        actions={
          <>
            <StatusBadge tone="green">
              <BadgeCheck className="size-3 shrink-0" aria-hidden="true" />
              <span>Unrestricted</span>
            </StatusBadge>
            <StatusBadge tone="gold">
              <span>{role ? `Role: ${role}` : "Role: owner"}</span>
            </StatusBadge>
          </>
        }
      >
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere] sm:text-sm">
            {hasUnrestrictedAccess
              ? "Unrestricted access is granted by the platform service, not by this interface."
              : "The platform service did not report unrestricted access for this session."}{" "}
            Future billing work should check platform owner access before evaluating any
            subscription entitlement. This panel is informational only — it is not a billing
            control.
          </p>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            Pricing and plans are not configured yet.
          </p>
          {capabilities.length > 0 ? (
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {capabilities.map((cap) => (
                <StatusBadge key={cap} tone="muted">
                  <span>{cap}</span>
                </StatusBadge>
              ))}
            </div>
          ) : null}
        </div>
      </Section>

      <Section
        leading={<Users className="size-4" aria-hidden="true" />}
        title="Platform overview"
        description="Accounts and workspaces across the whole platform."
      >
        <div className={GRID}>
          <Metric label="Users" value={formatCount(m.users_total)} />
          <Metric label="Workspaces" value={formatCount(m.workspaces_total)} />
          <Metric label="Members" value={formatCount(m.workspace_members_total)} />
        </div>
      </Section>

      <Section
        leading={<Sticker className="size-4" aria-hidden="true" />}
        title="Sticker operations"
        description="Pack production and Telegram publication volume."
      >
        <div className={GRID}>
          <Metric label="Packs" value={formatCount(m.sticker_packs_total)} />
          <Metric label="Packs published" value={formatCount(m.sticker_packs_published)} />
          <Metric label="Stickers" value={formatCount(m.stickers_total)} />
          <Metric
            label="Telegram stickers published"
            value={formatCount(m.telegram_stickers_published)}
          />
        </div>
      </Section>

      <Section
        leading={<Bot className="size-4" aria-hidden="true" />}
        title="Telegram"
        description="Connected accounts and communities."
      >
        <div className={GRID}>
          <Metric label="Linked accounts" value={formatCount(m.telegram_accounts_linked)} />
          <Metric label="Connected groups" value={formatCount(m.telegram_groups_connected)} />
        </div>
      </Section>

      <Section
        leading={<Cpu className="size-4" aria-hidden="true" />}
        title="AI generation"
        description="Job outcomes and recorded ledger usage. Cost values are raw ledger numbers, not a currency amount."
      >
        <div className={GRID}>
          <Metric label="Jobs" value={formatCount(m.ai_jobs_total)} />
          <Metric label="Succeeded" value={formatCount(m.ai_jobs_succeeded)} />
          <Metric label="Failed" value={formatCount(m.ai_jobs_failed)} />
          <Metric label="Usage units" value={formatCount(m.usage_units_total)} />
          <Metric label="Provider cost" value={formatCost(m.provider_cost_total)} />
          <Metric label="Internal cost" value={formatCost(m.internal_cost_total)} />
        </div>
      </Section>

      <Section
        leading={<Send className="size-4" aria-hidden="true" />}
        title="Distribution"
        description="Sticker drop schedules and delivery outcomes."
      >
        <div className={GRID}>
          <Metric label="Schedules" value={formatCount(m.drop_schedules_total)} />
          <Metric label="Enabled" value={formatCount(m.drop_schedules_enabled)} />
          <Metric label="Events sent" value={formatCount(m.drop_events_sent)} />
          <Metric label="Events failed" value={formatCount(m.drop_events_failed)} />
        </div>
        <div className="mt-3 flex min-w-0 flex-col gap-2">
          <InlineRow
            leading={<Activity className="size-4" aria-hidden="true" />}
            title="Scheduler job"
            subtitle={
              m.scheduler_last_run_status
                ? `Last run: ${m.scheduler_last_run_status}`
                : "No run status reported"
            }
            trailing={
              <>
                <StatusBadge tone={schedulerActive ? "green" : "muted"}>
                  <span>{schedulerActive ? "Active" : "Inactive"}</span>
                </StatusBadge>
                <StatusBadge tone="muted">
                  <span>{formatTimestamp(m.scheduler_last_run_at)}</span>
                </StatusBadge>
              </>
            }
          />
        </div>
      </Section>

      <Section
        leading={<Users className="size-4" aria-hidden="true" />}
        title="Acquisition"
        description="Private beta contacts captured by the Telegram bot."
      >
        <div className={GRID}>
          <Metric label="Beta contacts" value={formatCount(m.beta_contacts_total)} />
          <Metric label="Opted in" value={formatCount(m.beta_contacts_opted_in)} />
        </div>
      </Section>
    </div>
  );
}
