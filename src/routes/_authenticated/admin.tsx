import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bot,
  CalendarClock,
  CheckCircle2,
  Cpu,
  CreditCard,
  Layers,
  Loader2,
  Lock,
  Send,
  Settings,
  ShieldHalf,
  Sticker,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { PlatformMessageEditor } from "@/components/cartel/PlatformMessageEditor";

import { StatusBadge } from "@/components/cartel/StatusBadge";
import { InlineRow } from "@/components/cartel/InlineRow";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import {
  TelegramConnectionCard,
  useTelegramSetup,
} from "@/components/cartel/TelegramConnectionCard";

import {
  formatCost,
  formatCount,
  formatTimestamp,
  type PlatformDropScheduleDetail,
} from "@/lib/platform";

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

const GRID = "grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3";
const WRAP = "[overflow-wrap:anywhere]";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 px-3 py-2.5">
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}
      >
        {label}
      </p>
      <p className={`mt-1 font-display text-xl leading-none text-gold ${WRAP}`}>{value}</p>
      {hint ? <p className={`mt-1 text-[11px] text-muted-foreground ${WRAP}`}>{hint}</p> : null}
    </div>
  );
}

function QuickAction({ to, icon: Icon, label, hint }: {
  to: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border/70 bg-surface-raised/60 px-3 py-2.5 transition-colors hover:border-gold/40 hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/40 text-gold">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-medium text-foreground ${WRAP}`}>{label}</span>
        <span className={`block text-[11px] text-muted-foreground ${WRAP}`}>{hint}</span>
      </span>
    </Link>
  );
}

function text(value: unknown, fallback = "—"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cadence(minutes: number | null | undefined): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
  if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
  return `Every ${minutes}m`;
}

function scheduleTone(s: PlatformDropScheduleDetail): {
  tone: "green" | "gold" | "red" | "muted";
  label: string;
} {
  if (s.enabled === true) return { tone: "green", label: "Enabled" };
  const reason = text(s.paused_reason, "");
  if (reason.toLowerCase().startsWith("automatically paused")) {
    return { tone: "red", label: "Auto-paused" };
  }
  return { tone: "muted", label: "Paused" };
}

function AdminPage() {
  // Always re-checked against the server; never derived from email or storage.
  const {
    loading,
    error,
    isPlatformOwner,
    hasUnrestrictedAccess,
    role,
    capabilities,
    metrics,
    details,
  } = usePlatformAccess({ fresh: true });

  // Owner-only: bot service status + the owner's own Telegram identity link.
  const telegramSetup = useTelegramSetup(isPlatformOwner === true);



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
  const d = details;
  const schedules = d?.stickerDropSchedules ?? [];
  const enabledSchedules = schedules.filter((s) => s.enabled === true).length;
  const autoPaused = schedules.filter(
    (s) => s.enabled !== true && text(s.paused_reason, "").toLowerCase().startsWith("automatically paused"),
  ).length;
  const dropEvents = d?.recentDropEvents ?? [];
  const aiJobs = d?.recentAiJobs ?? [];
  const failedJobs = aiJobs.filter(
    (j) => text(j.status).toLowerCase() === "failed" || !!text(j.error_message, ""),
  );
  const workspaceNames = new Map<string, string>();
  for (const w of d?.workspaces ?? []) {
    const id = text(w.id, "");
    const name = text(w.name, "");
    if (id && name) workspaceNames.set(id, name);
  }
  const workspaceName = (id: string | null | undefined, fallback = "Workspace") =>
    (id ? workspaceNames.get(id) : undefined) ?? fallback;
  const num = (...values: Array<number | null | undefined>) =>
    values.find((v) => typeof v === "number" && Number.isFinite(v)) ?? null;

  const schedulerActive = m.scheduler_job_active === true;
  const schedulerFailing = text(m.scheduler_last_run_status, "").toLowerCase() === "failed";
  const healthIssue = !schedulerActive || schedulerFailing || autoPaused > 0;

  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Platform Owner"
        title="Owner Console"
        description="Platform command center. Operational data is read-only; platform Telegram system messages can be edited here. Owner identity is verified server-side on every load."
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
          <p className={`text-xs leading-relaxed text-muted-foreground sm:text-sm ${WRAP}`}>
            {hasUnrestrictedAccess
              ? "Unrestricted access is granted by the platform service, not by this interface."
              : "The platform service did not report unrestricted access for this session."}{" "}
            This console is read-only: it never edits users, roles, plans or Sticker Drop
            schedules.
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
        leading={<Zap className="size-4" aria-hidden="true" />}
        title="Operational Controls"
        description="Jump to the surfaces where changes are actually made."
      >
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <QuickAction
            to="/distribution"
            icon={CalendarClock}
            label="Sticker Automation"
            hint="Configure & pause Sticker Drops"
          />
          <QuickAction to="/sticker-lab" icon={Sticker} label="Sticker Lab" hint="Packs & generation" />
          <QuickAction
            to="/telegram"
            icon={Bot}
            label="Telegram Communities"
            hint="Customer group connections"
          />
          <QuickAction to="/settings" icon={Settings} label="Settings" hint="Workspace & account" />
        </div>
      </Section>

      <Section
        leading={<Bot className="size-4" aria-hidden="true" />}
        title="Telegram Bot Integration"
        description="Platform bot service status. The bot token and webhook stay server-side and are never exposed here."
        actions={
          <StatusBadge tone={telegramSetup.botConfigured ? "green" : "red"}>
            {telegramSetup.botConfigured ? "Bot service live" : "Bot not configured"}
          </StatusBadge>
        }
        contentClassName="space-y-3"
      >
        <InlineRow
          leading={<Bot className="size-4" aria-hidden="true" />}
          title={
            telegramSetup.botUsername ? `@${telegramSetup.botUsername}` : "Bot username unavailable"
          }
          subtitle="Official CARTEL HQ bot used for all publishing, group verification and Sticker Drops."
        />
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Owner Telegram Identity
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Telegram requires a real user identity to own and manage published sticker sets. This is
            your owner identity used for platform testing — it is not the bot service and it is not
            a customer community connection.
          </p>
          <TelegramConnectionCard setup={telegramSetup} />
        </div>
      </Section>

      <PlatformMessageEditor />


      <Section
        variant="primary"
        leading={<CalendarClock className="size-4" aria-hidden="true" />}
        title="Sticker Automation"
        description="Automated Sticker Drops posted to Telegram groups by the server scheduler."
        actions={
          <StatusBadge tone={schedulerActive ? "green" : "red"}>
            <span>{schedulerActive ? "Engine live" : "Engine inactive"}</span>
          </StatusBadge>
        }
      >
        <div className={GRID}>
          <Metric label="Schedules" value={formatCount(schedules.length || m.drop_schedules_total)} />
          <Metric
            label="Enabled"
            value={formatCount(schedules.length ? enabledSchedules : m.drop_schedules_enabled)}
          />
          <Metric label="Auto-paused" value={formatCount(autoPaused)} />
          <Metric label="Automated posts sent" value={formatCount(m.drop_events_sent)} />
          <Metric label="Failed posts" value={formatCount(m.drop_events_failed)} />
          <Metric
            label="Last scheduler run"
            value={formatTimestamp(m.scheduler_last_run_at)}
            hint={text(m.scheduler_last_run_status, "No status reported")}
          />
        </div>

        <div className="mt-3 flex min-w-0 flex-col gap-2">
          {schedules.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Automation engine is live — no group schedule configured yet"
              description="Nothing has been scheduled. Create the first Sticker Drop schedule for a connected Telegram group to start automated posting."
              action={
                <Button asChild size="sm" className="mt-1">
                  <Link to="/distribution">Configure First Automation</Link>
                </Button>
              }
            />
          ) : (
            schedules.map((s, i) => {
              const state = scheduleTone(s);
              return (
                <InlineRow
                  key={text(s.id, `schedule-${i}`)}
                  leading={<CalendarClock className="size-4" aria-hidden="true" />}
                  title={`${text(s.group_title, "Telegram group")} · ${text(s.pack_title, text(s.pack_name, "Pack"))}`}
                  subtitle={`${text(s.workspace_name, "Workspace")} · ${cadence(s.interval_minutes)} · Cap ${formatCount(s.daily_cap)} · ${text(s.active_start, "—")}–${text(s.active_end, "—")} ${text(s.timezone, "")}`.trim()}
                  meta={
                    s.enabled === true
                      ? `Next ${formatTimestamp(s.next_run_at)}`
                      : `Last sent ${formatTimestamp(s.last_sent_at)}`
                  }
                  trailing={
                    <>
                      <StatusBadge tone={state.tone}>
                        <span>{state.label}</span>
                      </StatusBadge>
                      {typeof s.consecutive_failures === "number" && s.consecutive_failures > 0 ? (
                        <StatusBadge tone="red">
                          <span>{`${s.consecutive_failures} fail`}</span>
                        </StatusBadge>
                      ) : null}
                    </>
                  }
                />
              );
            })
          )}
        </div>

        {schedules.length > 0 ? (
          <p className={`mt-3 text-[11px] text-muted-foreground ${WRAP}`}>
            Schedules are configured and paused in{" "}
            <Link to="/distribution" className="text-gold underline-offset-2 hover:underline">
              Distribution
            </Link>
            . This console does not modify them.
          </p>
        ) : null}
      </Section>

      <Section
        leading={<Send className="size-4" aria-hidden="true" />}
        title="Recent Sticker Drop Activity"
        description="Automated posts delivered by the Sticker Drop scheduler."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/distribution">Distribution</Link>
          </Button>
        }
      >
        <div className="flex min-w-0 flex-col gap-2">
          {dropEvents.length === 0 ? (
            <EmptyState
              compact
              icon={Send}
              title="No automated posts sent yet"
              description="Once a Sticker Drop schedule is enabled, every automated post appears here."
            />
          ) : (
            dropEvents.map((e, i) => {
              const status = text(e.status, "unknown").toLowerCase();
              const ok = status === "sent" || status === "success";
              return (
                <InlineRow
                  key={text(e.id, `event-${i}`)}
                  leading={<Send className="size-4" aria-hidden="true" />}
                  title={`${text(e.group_title, "Telegram group")} · ${text(e.pack_title, text(e.pack_name, "Pack"))}`}
                  subtitle={
                    text(e.error_message, "") || text(e.workspace_name, "Workspace")
                  }
                  meta={formatTimestamp(e.created_at)}
                  trailing={
                    <StatusBadge tone={ok ? "green" : "red"}>
                      <span>{text(e.status, "unknown")}</span>
                    </StatusBadge>
                  }
                />
              );
            })
          )}
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
        leading={<Layers className="size-4" aria-hidden="true" />}
        title="Workspaces"
        description="Per-workspace footprint across groups, packs and automation."
      >
        <div className="flex min-w-0 flex-col gap-2">
          {(d?.workspaces ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={Layers}
              title="No workspaces reported"
              description="The platform service returned no workspace rows."
            />
          ) : (
            (d?.workspaces ?? []).map((w, i) => (
              <InlineRow
                key={text(w.id, `workspace-${i}`)}
                leading={<Layers className="size-4" aria-hidden="true" />}
                title={text(w.name, "Untitled workspace")}
                subtitle={`Members ${formatCount(num(w.members, w.members_count))} · Groups ${formatCount(num(w.groups, w.groups_count))} · Packs ${formatCount(num(w.packs, w.packs_count))} (${formatCount(num(w.published_packs, w.published_packs_count))} published)`}
                trailing={
                  <StatusBadge
                    tone={(num(w.enabled_schedules, w.enabled_schedules_count) ?? 0) > 0 ? "green" : "muted"}
                  >
                    <span>{`${formatCount(num(w.enabled_schedules, w.enabled_schedules_count))}/${formatCount(num(w.schedules, w.schedules_count))} auto`}</span>
                  </StatusBadge>
                }
              />
            ))
          )}
        </div>
      </Section>

      <Section
        leading={<Users className="size-4" aria-hidden="true" />}
        title="Users"
        description="Recent platform accounts. Read-only — no editing from this console."
      >
        <div className="flex min-w-0 flex-col gap-2">
          {(d?.users ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={Users}
              title="No user rows reported"
              description="The platform service returned no recent accounts."
            />
          ) : (
            (d?.users ?? []).map((u, i) => {
              const confirmed = u.confirmed === true || !!text(u.email_confirmed_at, "");
              return (
                <InlineRow
                  key={text(u.id, `user-${i}`)}
                  leading={<Users className="size-4" aria-hidden="true" />}
                  title={text(u.email, "Account")}
                  subtitle={`Joined ${formatTimestamp(u.created_at)} · Last sign-in ${formatTimestamp(u.last_sign_in_at)}`}
                  trailing={
                    <StatusBadge tone={confirmed ? "green" : "muted"}>
                      <span>{confirmed ? "Confirmed" : "Unconfirmed"}</span>
                    </StatusBadge>
                  }
                />
              );
            })
          )}
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
        title="Telegram Operations"
        description="Linked accounts and connected communities."
      >
        <div className={GRID}>
          <Metric label="Linked accounts" value={formatCount(m.telegram_accounts_linked)} />
          <Metric label="Connected groups" value={formatCount(m.telegram_groups_connected)} />
        </div>
        <div className="mt-3 flex min-w-0 flex-col gap-2">
          {(d?.telegramGroups ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={Bot}
              title="No connected groups"
              description="No Telegram group connections have been reported yet."
            />
          ) : (
            (d?.telegramGroups ?? []).map((g, i) => (
              <InlineRow
                key={text(g.id, `group-${i}`)}
                leading={<Bot className="size-4" aria-hidden="true" />}
                title={text(g.title, "Telegram group")}
                subtitle={`${workspaceName(g.workspace_id)}${g.username ? ` · @${g.username}` : ""} · ${text(g.chat_type, "group")}`}
                meta={formatTimestamp(g.verified_at ?? g.connected_at)}
                trailing={
                  <StatusBadge tone={g.bot_is_admin === true ? "green" : "muted"}>
                    <span>{g.bot_is_admin === true ? "Bot admin" : "Not verified"}</span>
                  </StatusBadge>
                }
              />
            ))
          )}
        </div>
      </Section>

      <Section
        leading={<Cpu className="size-4" aria-hidden="true" />}
        title="AI Operations"
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
        <div className="mt-3 flex min-w-0 flex-col gap-2">
          {failedJobs.length === 0 ? (
            <EmptyState
              compact
              icon={CheckCircle2}
              title="No recent AI failures"
              description="Recent generation jobs are healthy."
            />
          ) : (
            failedJobs.map((j, i) => (
              <InlineRow
                key={text(j.id, `job-${i}`)}
                leading={<AlertTriangle className="size-4" aria-hidden="true" />}
                title={`${text(j.job_type, "AI job")} · ${text(j.provider, "provider")}${j.provider_model ? ` / ${j.provider_model}` : ""}`}
                subtitle={`${text(j.workspace_name, "Workspace")} — ${text(j.error_message, text(j.error_code, "Failed"))}`}
                meta={formatTimestamp(j.completed_at ?? j.created_at)}
                trailing={
                  <StatusBadge tone="red">
                    <span>Failed</span>
                  </StatusBadge>
                }
              />
            ))
          )}
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
        <div className="mt-3 flex min-w-0 flex-col gap-2">
          {(d?.betaContacts ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={Users}
              title="No beta contacts yet"
              description="Contacts captured by the bot will appear here."
            />
          ) : (
            (d?.betaContacts ?? []).map((c, i) => {
              const name =
                text(
                  [c.first_name, c.last_name].filter(Boolean).join(" "),
                  "",
                ) ||
                (c.telegram_username ? `@${c.telegram_username}` : "") ||
                text(c.chat_title, "Contact");
              return (
                <InlineRow
                  key={text(c.id, `contact-${i}`)}
                  leading={<Users className="size-4" aria-hidden="true" />}
                  title={name}
                  subtitle={`${text(c.subject_type, "contact")} · ${text(c.source, "source unknown")}${c.source_chat_title ? ` · ${c.source_chat_title}` : ""}`}
                  meta={formatTimestamp(c.last_seen_at)}
                  trailing={
                    <StatusBadge tone={c.opted_in === true ? "green" : "muted"}>
                      <span>{c.opted_in === true ? "Opted in" : "Not opted in"}</span>
                    </StatusBadge>
                  }
                />
              );
            })
          )}
        </div>
      </Section>

      <Section
        leading={<CreditCard className="size-4" aria-hidden="true" />}
        title="Billing Readiness"
        description="No pricing is live. This panel is informational only."
      >
        <div className="flex min-w-0 flex-col gap-2">
          <InlineRow
            leading={<CreditCard className="size-4" aria-hidden="true" />}
            title="Pricing"
            subtitle="Plans and prices are not configured yet."
            trailing={
              <StatusBadge tone="muted">
                <span>Not configured</span>
              </StatusBadge>
            }
          />
          <InlineRow
            leading={<ShieldHalf className="size-4" aria-hidden="true" />}
            title="Platform owner bypass"
            subtitle="Owner access is not limited by any future paid plan."
            trailing={
              <StatusBadge tone="green">
                <span>Active</span>
              </StatusBadge>
            }
          />
          <p className={`text-[11px] text-muted-foreground ${WRAP}`}>
            Future paid-plan evaluation must run only after the owner-unrestricted check passes.
          </p>
        </div>
      </Section>

      <Section
        leading={<Activity className="size-4" aria-hidden="true" />}
        title="System Health"
        description="Scheduler status reported by the platform service."
        actions={
          <StatusBadge tone={healthIssue ? "red" : "green"}>
            <span>{healthIssue ? "Attention" : "Healthy"}</span>
          </StatusBadge>
        }
      >
        <div className="flex min-w-0 flex-col gap-2">
          <InlineRow
            leading={<Activity className="size-4" aria-hidden="true" />}
            title="Sticker Drop scheduler job"
            subtitle={
              m.scheduler_last_run_status
                ? `Last run: ${m.scheduler_last_run_status}`
                : "No run status reported"
            }
            trailing={
              <>
                <StatusBadge tone={schedulerActive ? "green" : "red"}>
                  <span>{schedulerActive ? "Active" : "Inactive"}</span>
                </StatusBadge>
                <StatusBadge tone="muted">
                  <span>{formatTimestamp(m.scheduler_last_run_at)}</span>
                </StatusBadge>
              </>
            }
          />
          {autoPaused > 0 ? (
            <InlineRow
              leading={<AlertTriangle className="size-4" aria-hidden="true" />}
              title="Auto-paused automations"
              subtitle="One or more Sticker Drop schedules were paused automatically after repeated failures."
              trailing={
                <StatusBadge tone="red">
                  <span>{formatCount(autoPaused)}</span>
                </StatusBadge>
              }
            />
          ) : null}
        </div>
      </Section>
    </div>
  );
}
