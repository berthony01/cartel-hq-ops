import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  Cpu,
  CreditCard,
  EyeOff,
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
import { SocialMissionTestControl } from "@/components/cartel/SocialMissionTestControl";
import { BrandedSocialMissionTestControl } from "@/components/cartel/BrandedSocialMissionTestControl";

import { StatusBadge } from "@/components/cartel/StatusBadge";
import { InlineRow } from "@/components/cartel/InlineRow";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { PartnerAdminSection } from "@/components/cartel/PartnerAdminSection";
import { PolicyAdminSection } from "@/components/cartel/PolicyAdminSection";

import {
  TelegramConnectionCard,
  useTelegramSetup,
} from "@/components/cartel/TelegramConnectionCard";

import {
  canRequestVerification,
  fetchPlatformProjectVerifications,
  projectVerificationKeys,
  reviewProjectVerification,
  VERIFICATION_STATUS_LABEL,
  verificationStatusOf,
  type PlatformProjectVerificationRow,
  type ReviewAction,
} from "@/lib/project-verification";
import {
  fetchPlatformNetworkModeration,
  MODERATION_REASON_MAX,
  platformModerationKeys,
  setProjectNetworkModeration,
  type PlatformNetworkModerationRow,
} from "@/lib/platform-moderation";
import {
  CANONICAL_DELIVERY_STATES,
  fetchPlatformLaunchAnalytics,
  platformAnalyticsKeys,
} from "@/lib/platform-analytics";
import { LAUNCH_STATUS_LABELS, LAUNCH_STATUSES } from "@/lib/launch-control";
import {
  formatCost,
  formatCount,
  formatTimestamp,
  type PlatformDropScheduleDetail,
} from "@/lib/platform";


function ProjectVerificationSection() {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const directory = useQuery({
    queryKey: projectVerificationKeys.platformDirectory(),
    queryFn: fetchPlatformProjectVerifications,
  });

  const review = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: ReviewAction; note: string }) =>
      reviewProjectVerification(id, action, note),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.action === "verify"
          ? "Platform review recorded"
          : vars.action === "reject"
            ? "Verification request declined"
            : "Platform review revoked",
      );
      setNotes((prev) => ({ ...prev, [vars.id]: "" }));
      queryClient.invalidateQueries({ queryKey: ["project-verification"] });
      queryClient.invalidateQueries({ queryKey: ["cartel-network"] });
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Could not update the platform review state.",
      );
    },
  });

  const rows: PlatformProjectVerificationRow[] = directory.data ?? [];

  return (
    <Section
      leading={<BadgeCheck className="size-4" aria-hidden="true" />}
      title="Project Verification"
      description="Platform Reviewed is a review of the CURRENT project profile and its listed official links only. It automatically clears after material profile edits, and it never certifies token safety, contract code, liquidity, team identity or investment quality."
    >
      {directory.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading project profiles…</p>
      ) : directory.isError ? (
        <div className="flex min-w-0 flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            {(directory.error as Error)?.message ??
              "Project verification directory could not be loaded right now."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => void directory.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No project profiles exist yet.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {rows.map((row) => {
            const status = verificationStatusOf(row.verification_status);
            const pending = review.isPending && review.variables?.id === row.project_profile_id;
            const note = notes[row.project_profile_id] ?? "";
            const meta = [
              row.public_slug ? `/${row.public_slug}` : null,
              row.ticker,
              row.primary_chain,
              row.workspace_name,
            ]
              .filter(Boolean)
              .join(" · ");
            const timeline =
              status === "pending"
                ? `Requested ${formatTimestamp(row.requested_at)}`
                : status === "verified"
                  ? `Reviewed ${formatTimestamp(row.verified_at)}`
                  : row.reviewed_at
                    ? `Last decision ${formatTimestamp(row.reviewed_at)}`
                    : "No review activity yet";
            const links = [
              row.website_url ? "Website" : null,
              row.telegram_url ? "Telegram" : null,
              row.x_url ? "X" : null,
            ].filter(Boolean);
            const act = (action: ReviewAction) =>
              review.mutate({ id: row.project_profile_id, action, note });

            return (
              <div
                key={row.project_profile_id}
                className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-3"
              >
                <InlineRow
                  leading={<Layers className="size-4" aria-hidden="true" />}
                  title={row.project_name}
                  subtitle={meta}
                  trailing={
                    <>
                      <StatusBadge tone="muted">
                        <span>{row.discovery_status}</span>
                      </StatusBadge>
                      <StatusBadge tone={status === "verified" ? "gold" : "muted"}>
                        <span>{VERIFICATION_STATUS_LABEL[status]}</span>
                      </StatusBadge>
                    </>
                  }
                />

                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {timeline}
                  {" · "}
                  {links.length > 0
                    ? `Official links: ${links.join(", ")}`
                    : "No official links listed"}
                </p>

                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    value={note}
                    onChange={(event) =>
                      setNotes((prev) => ({
                        ...prev,
                        [row.project_profile_id]: event.target.value,
                      }))
                    }
                    maxLength={500}
                    placeholder="Internal review note (owner-only, never public)"
                    aria-label={`Internal review note for ${row.project_name}`}
                    className="min-h-11 sm:flex-1"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={pending || status === "verified"}
                      onClick={() => act("verify")}
                    >
                      Mark Platform Reviewed
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={pending || status !== "pending"}
                      onClick={() => act("reject")}
                    >
                      Decline Request
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={pending || status !== "verified"}
                      onClick={() => act("revoke")}
                    >
                      Revoke Review
                    </Button>
                  </div>
                </div>

                {canRequestVerification(status) ? (
                  <p className="text-xs text-muted-foreground">
                    No open request. Marking this project reviewed is an owner decision and does
                    not require a request.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

type ModerationIntent = { row: PlatformNetworkModerationRow; hide: boolean };

function NetworkModerationSection() {
  const queryClient = useQueryClient();
  const [intent, setIntent] = useState<ModerationIntent | null>(null);
  const [reason, setReason] = useState("");

  const directory = useQuery({
    queryKey: platformModerationKeys.directory(),
    queryFn: fetchPlatformNetworkModeration,
  });

  const mutation = useMutation({
    mutationFn: ({ id, hide, note }: { id: string; hide: boolean; note: string }) =>
      setProjectNetworkModeration(id, hide, note),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.hide
          ? "Project hidden from Cartel Network"
          : "Cartel Network visibility restored",
      );
      setIntent(null);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: platformModerationKeys.all() });
      void queryClient.invalidateQueries({ queryKey: ["cartel-network"] });
    },
    onError: (err: unknown) => {
      // Dialog intentionally stays open so the action can be retried.
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not update Cartel Network visibility right now.",
      );
    },
  });

  const rows: PlatformNetworkModerationRow[] = directory.data ?? [];
  const hasCached = rows.length > 0;
  const staleWarning = directory.isError && hasCached;

  const openFor = (row: PlatformNetworkModerationRow, hide: boolean) => {
    setReason("");
    setIntent({ row, hide });
  };

  return (
    <>
      <Section
        leading={<EyeOff className="size-4" aria-hidden="true" />}
        title="Network Moderation"
        description="Temporarily remove a project and its launches from public Cartel Network surfaces without deleting project data. This does not change the project's own publication setting, verification status, launch lifecycle, Launch Watch subscriptions, or history."
      >
        {directory.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading network moderation state…</p>
        ) : directory.isError && !hasCached ? (
          <div className="flex min-w-0 flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Network moderation data could not be loaded right now.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => void directory.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : !directory.isError && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No project profiles exist yet.</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {staleWarning ? (
              <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg border border-border bg-surface p-3">
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  Showing previously loaded data. The latest refresh failed, so this may be stale.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => void directory.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            {rows.map((row) => {
              const hidden = row.is_hidden === true;
              const pending =
                mutation.isPending && mutation.variables?.id === row.project_profile_id;
              const meta = [
                row.public_slug ? `/${row.public_slug}` : null,
                row.ticker,
                row.primary_chain,
                `${formatCount(row.launch_count)} launches`,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <div
                  key={row.project_profile_id}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  <InlineRow
                    leading={<Layers className="size-4" aria-hidden="true" />}
                    title={row.project_name}
                    subtitle={meta}
                    trailing={
                      <>
                        <StatusBadge tone="muted">
                          <span>{`Operator: ${text(row.discovery_status, "unknown")}`}</span>
                        </StatusBadge>
                        <StatusBadge tone={hidden ? "red" : "green"}>
                          <span>{hidden ? "Hidden by platform" : "Visible"}</span>
                        </StatusBadge>
                        {row.verification_status ? (
                          <StatusBadge tone="muted">
                            <span>
                              {
                                VERIFICATION_STATUS_LABEL[
                                  verificationStatusOf(row.verification_status)
                                ]
                              }
                            </span>
                          </StatusBadge>
                        ) : null}
                      </>
                    }
                  />

                  {hidden ? (
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {`Hidden ${formatTimestamp(row.hidden_at)}`}
                      {row.internal_reason
                        ? ` · Internal reason: ${row.internal_reason}`
                        : " · No internal reason recorded"}
                    </p>
                  ) : row.restored_at ? (
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {`Visibility restored ${formatTimestamp(row.restored_at)}`}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {hidden ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={pending}
                        onClick={() => openFor(row, false)}
                      >
                        Restore to Cartel Network
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={pending}
                        onClick={() => openFor(row, true)}
                      >
                        Hide from Cartel Network
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <AlertDialog
        open={!!intent}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) {
            setIntent(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intent?.hide ? "Hide from Cartel Network?" : "Restore Cartel Network visibility?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {intent?.hide ? (
                  <>
                    <p className="[overflow-wrap:anywhere]">
                      {`“${intent.row.project_name}” will be suppressed by a platform visibility override on every public Cartel Network surface: its public project page, its project launches, upcoming launches, launch detail pages and Cartel Signals.`}
                    </p>
                    <p>
                      No underlying data is deleted. The project profile, launches, Launch Watch
                      subscriptions, notifications and history remain stored exactly as they are,
                      and this hold is reversible at any time.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="[overflow-wrap:anywhere]">
                      {`This removes ONLY the platform moderation hold on “${intent?.row.project_name ?? ""}”. It does not publish the project or change anything the operator controls.`}
                    </p>
                    {intent && intent.row.discovery_status !== "published" ? (
                      <p>
                        {`This project's own discovery status is “${text(intent.row.discovery_status, "unknown")}”, so it will still remain absent from public Cartel Network surfaces until its operator publishes it.`}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {intent?.hide ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor="moderation-reason"
                className="text-xs uppercase tracking-[0.14em] text-muted-foreground"
              >
                Internal reason (owner-only)
              </label>
              <Textarea
                id="moderation-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={MODERATION_REASON_MAX}
                rows={3}
                placeholder="Optional internal note"
              />
              <p className="text-[11px] text-muted-foreground">
                Never shown publicly. {`Max ${MODERATION_REASON_MAX} characters.`}
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={mutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!intent) return;
                mutation.mutate({
                  id: intent.row.project_profile_id,
                  hide: intent.hide,
                  note: reason,
                });
              }}
            >
              {mutation.isPending
                ? "Working…"
                : intent?.hide
                  ? "Hide from Cartel Network"
                  : "Restore visibility"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AnalyticsMetric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 px-3 py-2.5">
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}
      >
        {label}
      </p>
      <p className={`mt-1 font-display text-xl leading-none text-gold ${WRAP}`}>
        {formatCount(value)}
      </p>
      {hint ? <p className={`mt-1 text-[11px] text-muted-foreground ${WRAP}`}>{hint}</p> : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <p className={`min-w-0 text-[11px] text-muted-foreground ${WRAP}`}>
      <span className="uppercase tracking-[0.12em]">{label}</span>{" "}
      <span className="font-medium text-foreground">{formatCount(value)}</span>
    </p>
  );
}

function launchStatusLabel(status: string | null): string {
  if (!status) return "—";
  return (
    (LAUNCH_STATUS_LABELS as Record<string, string>)[status] ??
    status.replaceAll("_", " ").toLowerCase()
  );
}

function LaunchAnalyticsSection() {
  const analytics = useQuery({
    queryKey: platformAnalyticsKeys.all(),
    queryFn: fetchPlatformLaunchAnalytics,
  });

  const data = analytics.data ?? null;
  const staleWarning = analytics.isError && data !== null;

  const otherDeliveryStates = data
    ? Object.entries(data.deliveries_by_status).filter(
        ([state]) => !CANONICAL_DELIVERY_STATES.has(state),
      )
    : [];

  const lifecycle = data
    ? LAUNCH_STATUSES.map((status) => ({
        status: status as string,
        count: data.launches_by_status[status] ?? 0,
      })).concat(
        Object.entries(data.launches_by_status)
          .filter(([status]) => !(LAUNCH_STATUSES as readonly string[]).includes(status))
          .map(([status, count]) => ({ status, count })),
      )
    : [];

  return (
    <Section
      leading={<BarChart3 className="size-4" aria-hidden="true" />}
      title="Launch Analytics"
      description="Operational analytics for Cartel Launch Network activity. Counts are aggregated from CARTEL HQ launch, Launch Watch, notification, and connected-community records. No subscriber identities, price data, market data, or investment metrics are included."
    >
      {analytics.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading launch analytics…</p>
      ) : analytics.isError && !data ? (
        <div className="flex min-w-0 flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            Launch analytics could not be loaded right now.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => void analytics.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">No analytics were returned.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-5">
          {staleWarning ? (
            <div className="flex min-w-0 flex-col items-start gap-2 rounded-lg border border-border bg-surface p-3">
              <p className={`text-xs text-muted-foreground ${WRAP}`}>
                Showing previously loaded analytics; latest refresh failed.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => void analytics.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : null}

          <div className={GRID}>
            <AnalyticsMetric label="Published projects" value={data.projects_published} />
            <AnalyticsMetric label="Total launches" value={data.launches_total} />
            <AnalyticsMetric label="Active watchers" value={data.watch_active} />
            <AnalyticsMetric label="Opt-ins · 30d" value={data.opt_ins_30d} />
            <AnalyticsMetric label="Alerts sent" value={data.deliveries_sent} />
            <AnalyticsMetric label="Connected communities" value={data.connected_groups} />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}>
              Network &amp; trust
            </h3>
            <div className={GRID}>
              <AnalyticsMetric label="Projects total" value={data.projects_total} />
              <AnalyticsMetric label="Published" value={data.projects_published} />
              <AnalyticsMetric label="Operator-hidden" value={data.projects_operator_hidden} />
              <AnalyticsMetric label="Platform-hidden" value={data.projects_platform_hidden} />
              <AnalyticsMetric label="Verified projects" value={data.projects_verified} />
              <AnalyticsMetric label="Verification pending" value={data.verification_pending} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}>
              Launch lifecycle
            </h3>
            <div className={GRID}>
              {lifecycle.map((entry) => (
                <AnalyticsMetric
                  key={entry.status}
                  label={launchStatusLabel(entry.status)}
                  value={entry.count}
                />
              ))}
            </div>
            <div className={GRID}>
              <AnalyticsMetric label="Scheduled launches" value={data.launches_scheduled} />
              <AnalyticsMetric label="Contracts registered" value={data.contracts_registered} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}>
              Launch Watch
            </h3>
            <div className={GRID}>
              <AnalyticsMetric label="Active watchers" value={data.watch_active} />
              <AnalyticsMetric label="Stopped watchers" value={data.watch_stopped} />
              <AnalyticsMetric label="Reminders enabled" value={data.reminders_enabled} />
              <AnalyticsMetric label="Reminders muted" value={data.reminders_muted} />
              <AnalyticsMetric
                label="Launches with watchers"
                value={data.launches_with_active_watchers}
              />
              <AnalyticsMetric label="Opt-ins · 7d" value={data.opt_ins_7d} />
              <AnalyticsMetric label="Opt-ins · 30d" value={data.opt_ins_30d} />
            </div>
            <p className={`text-[11px] text-muted-foreground ${WRAP}`}>
              Counts reflect Launch Watch subscription records.
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}>
              Notification health
            </h3>
            <div className={GRID}>
              <AnalyticsMetric label="Launch events" value={data.launch_events_total} />
              <AnalyticsMetric label="Sent" value={data.deliveries_sent} />
              <AnalyticsMetric label="Waiting" value={data.deliveries_pending} />
              <AnalyticsMetric label="Failed" value={data.deliveries_failed} />
              <AnalyticsMetric label="Retried" value={data.deliveries_retried} />
            </div>
            {otherDeliveryStates.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className={`text-[11px] text-muted-foreground ${WRAP}`}>
                  Other delivery states
                </p>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {otherDeliveryStates.map(([state, count]) => (
                    <StatusBadge key={state} tone="muted">
                      <span className={WRAP}>
                        {state}: {formatCount(count)}
                      </span>
                    </StatusBadge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}>
              Community readiness
            </h3>
            <div className={GRID}>
              <AnalyticsMetric label="Connected groups" value={data.connected_groups} />
              <AnalyticsMetric label="Welcome messages enabled" value={data.welcomes_enabled} />
              <AnalyticsMetric
                label="Launch Watch CTA enabled"
                value={data.launch_watch_cta_enabled}
              />
            </div>
            <p className={`text-[11px] text-muted-foreground ${WRAP}`}>
              Stored connection and configuration counts. These are not live Telegram API checks.
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <h3 className={`text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground ${WRAP}`}>
              Per-launch operations
            </h3>
            {data.per_launch.length === 0 ? (
              <p className="text-sm text-muted-foreground">No launches yet.</p>
            ) : (
              <div className="flex min-w-0 flex-col gap-2">
                {data.per_launch.map((row, index) => (
                  <div
                    key={`${row.launch_public_slug ?? "launch"}-${index}`}
                    className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-surface-raised/60 p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className={`text-sm font-medium text-foreground ${WRAP}`}>
                        {text(row.token_name)}
                        {row.ticker ? ` · ${row.ticker}` : ""}
                      </p>
                      <p className={`text-[11px] text-muted-foreground ${WRAP}`}>
                        {text(row.project_name)}
                        {row.chain ? ` · ${row.chain}` : ""}
                        {row.launch_public_slug ? ` · /${row.launch_public_slug}` : ""}
                      </p>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <StatusBadge tone="muted">
                          <span className={WRAP}>{launchStatusLabel(row.status)}</span>
                        </StatusBadge>
                        <span className={`text-[11px] text-muted-foreground ${WRAP}`}>
                          {row.launch_at ? formatTimestamp(row.launch_at) : "No scheduled time"}
                        </span>
                      </div>
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3 lg:grid-cols-6">
                      <MiniStat label="Active" value={row.active_watchers} />
                      <MiniStat label="Muted" value={row.muted_watchers} />
                      <MiniStat label="Events" value={row.events_total} />
                      <MiniStat label="Sent" value={row.deliveries_sent} />
                      <MiniStat label="Waiting" value={row.deliveries_pending} />
                      <MiniStat label="Failed" value={row.deliveries_failed} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}




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
        description="Platform command center. Metrics and operational listings are read-only, except Partner Program controls. Platform Telegram system messages, the single pinned Social Mission live test and Partner Program review are the actions here. Owner identity is verified server-side on every load."
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
            Operational listings in this console are read-only: they never edit users, roles, plans
            or Sticker Drop schedules. The actions available here are editing the platform Telegram
            system messages, running the single pinned Social Mission live test, and the Partner
            Program controls (terms, applications, partner status, manual ledger, referrals,
            payouts) — the only write exception, each enforced server-side by owner-only functions.
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

      <PartnerAdminSection />

      <PolicyAdminSection />

      <ProjectVerificationSection />

      <NetworkModerationSection />

      <LaunchAnalyticsSection />

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

      <SocialMissionTestControl />

      <BrandedSocialMissionTestControl />
    </div>
  );
}
