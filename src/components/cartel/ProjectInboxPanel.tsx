import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Inbox as InboxIcon, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
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
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import {
  CONVERSATION_STATUSES,
  CONVERSATION_STATUS_LABELS,
  acknowledgeProjectInboxDeliveryUncertainty,
  conversationCategoryLabel,
  conversationOriginLabel,
  conversationStatusLabel,
  deliveryStatusLabel,
  getProjectInboxConversation,
  getProjectInboxSettings,
  getProjectInboxSummary,
  listProjectConversationMessages,
  listProjectInboxConversations,
  projectInboxKeys,
  sendProjectInboxTeamReply,
  setProjectInboxConversationBlocked,
  setProjectInboxRepliesEnabled,
  updateProjectConversationStatus,
  type ConversationStatus,
} from "@/lib/project-inbox";


/**
 * C7.3C/C7.3D — Project Inbox panel inside Community Command.
 *
 * Reads/writes go ONLY through the privacy-safe authenticated RPCs in
 * `@/lib/project-inbox`. The panel never renders a Telegram user id, chat id,
 * message id or username — members are shown by opaque `member_ref` only.
 *
 * C7.3D D1 adds an outbound reply composer. Sending is idempotent (one client
 * request id per composed reply) and a successful submit means the reply was
 * QUEUED, never that Telegram delivered it. Delivery state is shown per
 * message and uncertain deliveries are acknowledged, never auto-resent.
 *
 * Deliberately NOT here (not live yet): assignment controls,
 * notification/team-preference controls, unread counts, arbitrary
 * new-conversation DM capture, and History integration.
 */

const REPLY_MAX = 3500;
const DELIVERY_IN_FLIGHT = new Set(["pending", "processing", "retry"]);


function deliveryTone(status: string | null): "gold" | "green" | "red" | "muted" {
  switch (status) {
    case "sent":
      return "green";
    case "failed":
    case "ambiguous":
      return "red";
    case "pending":
    case "processing":
    case "retry":
      return "gold";
    default:
      return "muted";
  }
}


type ProjectInboxPanelProps = {
  /** URL-owned selection; null means no conversation is open. */
  selectedConversationId: string | null;
  onConversationChange: (conversationId: string) => void;
  onConversationClear: () => void;
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status: string): "gold" | "green" | "red" | "muted" {
  switch (status) {
    case "WAITING_ON_TEAM":
      return "gold";
    case "OPEN":
      return "green";
    case "WAITING_ON_MEMBER":
    case "RESOLVED":
    default:
      return "muted";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The request failed.";
}

const FILTERS: Array<{ value: ConversationStatus | null; label: string }> = [
  { value: null, label: "All" },
  { value: "WAITING_ON_TEAM", label: "Needs reply" },
  { value: "WAITING_ON_MEMBER", label: "Waiting on member" },
  { value: "OPEN", label: "Open" },
  { value: "RESOLVED", label: "Resolved" },
];

export function ProjectInboxPanel({
  selectedConversationId,
  onConversationChange,
  onConversationClear,
}: ProjectInboxPanelProps) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<ConversationStatus | null>(null);
  const [settingsDialog, setSettingsDialog] = useState<"enable" | "disable" | null>(null);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [blockDialog, setBlockDialog] = useState<"block" | "unblock" | null>(null);
  const [replyBody, setReplyBody] = useState("");
  // A send attempt freezes its request id AND the exact text submitted. If the
  // RPC result is uncertain (network error, timeout) the SAME id and text are
  // reused on retry, so the server resolves it to the original message instead
  // of queueing a second reply. A new id is minted only after acceptance or an
  // explicit, warned abandonment.
  const [pendingAttempt, setPendingAttempt] = useState<
    { requestId: string; attemptedBody: string } | null
  >(null);
  const [abandonDialogOpen, setAbandonDialogOpen] = useState(false);
  const [ackDialogMessageId, setAckDialogMessageId] = useState<string | null>(null);



  // Clear any selected conversation when the ACTIVE workspace actually
  // CHANGES after mount (previous non-null workspace id -> different id), so
  // a workspace-A thread never stays visibly selected after switching to B.
  // The ref starts null, so an initial valid deep link is NEVER cleared just
  // because the component mounted; an initial wrong-workspace deep link still
  // fails closed server-side through the workspace-bound detail RPC.
  const prevWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevWorkspaceIdRef.current;
    if (prev && workspaceId && workspaceId !== prev) {
      onConversationClear();
    }
    if (workspaceId) {
      prevWorkspaceIdRef.current = workspaceId;
    }
  }, [workspaceId, onConversationClear]);

  // ------------------------------------------------------------------ queries
  const settingsQuery = useQuery({
    queryKey: projectInboxKeys.settings(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => getProjectInboxSettings(workspaceId!),
  });
  const settings = settingsQuery.data ?? null;

  const summaryQuery = useQuery({
    queryKey: projectInboxKeys.summary(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => getProjectInboxSummary(workspaceId!),
  });

  const conversationsQuery = useQuery({
    queryKey: projectInboxKeys.conversations(workspaceId, filter),
    enabled: !!workspaceId,
    queryFn: () => listProjectInboxConversations(workspaceId!, filter, 100),
  });
  const conversations = conversationsQuery.data ?? [];

  // Detail loads by id even when the conversation is not in the currently
  // filtered list, so deep links and filter changes never break selection.
  // The RPC is workspace-bound: the ACTIVE workspace id is part of the query
  // key and the call, so a stale selection from another workspace fails
  // closed server-side instead of rendering.
  const detailQuery = useQuery({
    queryKey: projectInboxKeys.conversation(workspaceId, selectedConversationId),
    enabled: !!workspaceId && !!selectedConversationId,
    queryFn: () => getProjectInboxConversation(workspaceId!, selectedConversationId!),
  });
  const detail = detailQuery.data ?? null;

  // Messages may run ONLY after the workspace-bound detail RPC confirmed the
  // selected conversation belongs to the ACTIVE workspace. This prevents the
  // one-arg C7.3A message-list RPC from ever being called for a stale or
  // wrong-workspace conversation id.
  const detailConfirmedForSelection =
    !!workspaceId &&
    !!selectedConversationId &&
    detailQuery.isSuccess &&
    detailQuery.data?.conversation_id === selectedConversationId;

  const messagesQuery = useQuery({
    queryKey: projectInboxKeys.messages(workspaceId, selectedConversationId),
    enabled: detailConfirmedForSelection,
    queryFn: () => listProjectConversationMessages(selectedConversationId!, 200),
    // Delivery happens out of band in a background worker, so poll only while
    // this thread actually has a reply still in flight.
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (m) => m.delivery_status != null && DELIVERY_IN_FLIGHT.has(m.delivery_status),
      )
        ? 3_000
        : false,
  });

  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  // A draft belongs to exactly one thread in one workspace. Switching either
  // clears the draft and any frozen attempt, so a draft can never be submitted
  // against a different conversation.
  useEffect(() => {
    setReplyBody("");
    setPendingAttempt(null);
  }, [workspaceId, selectedConversationId]);





  // --------------------------------------------------------------- mutations
  const repliesMutation = useMutation({
    mutationFn: (next: boolean) =>
      // Preserves the server-returned `new_conversations_enabled` unchanged —
      // this panel exposes no control for it and must never flip it.
      setProjectInboxRepliesEnabled(
        workspaceId!,
        next,
        settings?.new_conversations_enabled ?? false,
      ),
    onSuccess: (row) => {
      queryClient.setQueryData(projectInboxKeys.settings(workspaceId), row);
      toast.success(
        row.replies_enabled ? "Reply capture is on." : "Reply capture is off.",
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { conversationId: string; status: ConversationStatus }) =>
      updateProjectConversationStatus(vars.conversationId, vars.status),
    onSuccess: (_row, vars) => {
      // Internal Inbox state only — nothing is sent to Telegram. Messages are
      // not invalidated because a status change adds no message row.
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.conversation(workspaceId, vars.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.conversationsRoot(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.summary(workspaceId),
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const blockMutation = useMutation({
    mutationFn: (vars: { conversationId: string; blocked: boolean }) =>
      // Workspace-bound: the server authorizes the ACTIVE workspace first and
      // the conversation must belong to it, otherwise it fails closed.
      setProjectInboxConversationBlocked(workspaceId!, vars.conversationId, vars.blocked),
    onSuccess: (row, vars) => {
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.conversation(workspaceId, vars.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.conversationsRoot(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.summary(workspaceId),
      });
      toast.success(
        row.contact_status === "BLOCKED"
          ? `Member ${row.member_ref} is blocked.`
          : `Member ${row.member_ref} is unblocked.`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const replyMutation = useMutation({
    mutationFn: (vars: { conversationId: string; body: string; requestId: string }) =>
      sendProjectInboxTeamReply(
        workspaceId!,
        vars.conversationId,
        vars.body,
        vars.requestId,
      ),
    onSuccess: (result, vars) => {
      // Only clear the composer and release the frozen attempt after the
      // server confirmed acceptance — otherwise the same text could be queued
      // twice.
      setReplyBody("");
      setPendingAttempt(null);
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.messages(workspaceId, vars.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.conversation(workspaceId, vars.conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.conversationsRoot(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.summary(workspaceId),
      });
      toast.success(
        result.idempotent_replay
          ? "This reply was already queued — it was not sent twice."
          : "Reply queued for delivery.",
      );
    },
    // The frozen attempt is deliberately KEPT on error: the server may already
    // have accepted it, so retrying must reuse the same request id and text.
    onError: (error) => toast.error(errorMessage(error)),
  });

  const ackMutation = useMutation({
    mutationFn: (vars: { messageId: string }) =>
      acknowledgeProjectInboxDeliveryUncertainty(
        workspaceId!,
        selectedConversationId!,
        vars.messageId,
      ),

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectInboxKeys.messages(workspaceId, selectedConversationId),
      });
      toast.success("Uncertainty acknowledged. Nothing was resent.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });



  // ---------------------------------------------------- delivery safety gates
  // A new reply may only be composed when this thread has no reply still in
  // flight and no UNCERTAIN reply awaiting an explicit operator decision.
  const hasInFlightReply = messages.some(
    (m) => m.delivery_status != null && DELIVERY_IN_FLIGHT.has(m.delivery_status),
  );
  const hasUnacknowledgedUncertainReply = messages.some(
    (m) => m.delivery_status === "ambiguous" && !m.delivery_uncertainty_acknowledged_at,
  );

  // ------------------------------------------------------------ derived state

  const settingsChecking = !!workspaceId && settingsQuery.isPending;
  const settingsUnavailable = settingsQuery.isError;
  const repliesOn = settings?.replies_enabled === true;

  const headerTone = settingsChecking
    ? "muted"
    : settingsUnavailable
      ? "red"
      : repliesOn
        ? "green"
        : "muted";
  const headerLabel = settingsChecking
    ? "Checking"
    : settingsUnavailable
      ? "Status unavailable"
      : repliesOn
        ? "Reply capture on"
        : "Reply capture off";

  const summary = summaryQuery.data ?? null;
  const summaryCards: Array<{ label: string; value: number | null }> = [
    { label: "Needs reply", value: summary?.waiting_on_team_count ?? null },
    { label: "Waiting on member", value: summary?.waiting_on_member_count ?? null },
    { label: "Open", value: summary?.open_count ?? null },
    { label: "Resolved", value: summary?.resolved_count ?? null },
    { label: "Blocked members", value: summary?.blocked_contact_count ?? null },
  ];

  const showDetailPane = !!selectedConversationId;

  if (!workspaceId) {
    return (
      <Section variant="surface" title="Project Inbox">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Select a workspace to use the Project Inbox.
        </p>
      </Section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      {/* ---------------------------------------------------- feature header */}
      <Section
        variant="hero"
        title="Project Inbox"
        leading={<InboxIcon className="size-4" aria-hidden="true" />}
        description="Private replies from Launch Watch members, captured into one place your team can triage."
        actions={<StatusBadge tone={headerTone}>{headerLabel}</StatusBadge>}
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-gold" aria-hidden="true" />
              <span>
                Only an explicit private reply to a known official Launch Watch bot message can
                enter this Inbox. Arbitrary bot DMs, commands and group messages are never
                captured. Your team sees an opaque Member reference — never the subscriber&apos;s
                Telegram user id or username. Starting new conversations from arbitrary bot DMs is
                not enabled here yet.
              </span>
            </p>
          </div>

          {settingsUnavailable ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                The Inbox setting could not be loaded. This is not a confirmation that reply
                capture is off.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => void settingsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : settings ? (
            <div className="flex flex-wrap items-center gap-2">
              {repliesOn ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={repliesMutation.isPending}
                  onClick={() => setSettingsDialog("disable")}
                >
                  Turn off reply capture
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={repliesMutation.isPending}
                  onClick={() => setSettingsDialog("enable")}
                >
                  Enable reply capture
                </Button>
              )}
              {repliesMutation.isPending ? (
                <span className="text-xs text-muted-foreground">Saving…</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Section>

      {/* ---------------------------------------------------------- summary */}
      <Section variant="surface" title="Summary">
        {summaryQuery.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Inbox counts could not be loaded right now.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => void summaryQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {summaryCards.map((card) => (
              <div key={card.label} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {card.label}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {summaryQuery.isPending || card.value == null ? "—" : String(card.value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {/* ------------------------------------------------- list + detail */}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Conversation list. On mobile the open thread replaces the list. */}
        <div className={cn("min-w-0", showDetailPane ? "hidden lg:block" : undefined)}>
          <Section
            variant="primary"
            title="Conversations"
            contentClassName="flex flex-col gap-3"
          >
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Filter conversations by status"
            >
              {FILTERS.map((f) => {
                const active = filter === f.value;
                return (
                  <Button
                    key={f.label}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="min-h-11 text-xs"
                    aria-pressed={active}
                    onClick={() => setFilter(f.value)}
                  >
                    {f.label}
                  </Button>
                );
              })}
            </div>

            {conversationsQuery.isError ? (
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Conversations could not be loaded. This is not an empty Inbox.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 min-h-11"
                  onClick={() => void conversationsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : conversationsQuery.isPending ? (
              <p className="p-1 text-xs leading-relaxed text-muted-foreground">
                Loading conversations…
              </p>
            ) : conversations.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 bg-background/40 p-4">
                {settings && !repliesOn ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Reply capture is off. Enable it above so explicit private replies to your
                    official Launch Watch bot messages can reach this Inbox.
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {filter
                      ? `No ${CONVERSATION_STATUS_LABELS[filter].toLowerCase()} conversations.`
                      : "No conversations yet."}{" "}
                    Only explicit replies to official Launch Watch bot DMs appear here.
                  </p>
                )}
              </div>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Inbox conversations">
                {conversations.map((c) => {
                  const selected = c.conversation_id === selectedConversationId;
                  return (
                    <li key={c.conversation_id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onConversationChange(c.conversation_id)}
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "w-full min-h-11 rounded-md border p-3 text-left transition-colors",
                          selected
                            ? "border-gold/60 bg-gold/5"
                            : "border-border/60 bg-background/40 hover:border-gold/40",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                            Member {c.member_ref}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatWhen(c.last_message_at)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge tone={statusTone(c.status)}>
                            {conversationStatusLabel(c.status)}
                          </StatusBadge>
                          <StatusBadge tone="muted">
                            {conversationCategoryLabel(c.category)}
                          </StatusBadge>
                          {c.priority === "HIGH" ? (
                            <StatusBadge tone="red">High priority</StatusBadge>
                          ) : null}
                          {c.contact_status === "BLOCKED" ? (
                            <StatusBadge tone="red">Blocked</StatusBadge>
                          ) : null}
                        </div>
                        <p className="mt-1.5 truncate text-xs text-muted-foreground">
                          {c.origin_title_snapshot || conversationOriginLabel(c.origin_type)}
                        </p>
                        {c.latest_message_preview ? (
                          <p className="mt-1 truncate text-xs text-foreground/80">
                            {c.latest_message_preview}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        {/* Thread detail */}
        {showDetailPane ? (
          <div className="min-w-0">
            <Section variant="primary" contentClassName="flex flex-col gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 self-start lg:hidden"
                onClick={onConversationClear}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back to Inbox
              </Button>

              {detailQuery.isError ? (
                <div className="rounded-md border border-border/60 bg-background/40 p-3">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    This conversation could not be loaded. It may not exist in this workspace.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => void detailQuery.refetch()}
                    >
                      Retry
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={onConversationClear}
                    >
                      Back to Inbox
                    </Button>
                  </div>
                </div>
              ) : detailQuery.isPending || !detail ? (
                <p className="p-1 text-xs leading-relaxed text-muted-foreground">
                  Loading conversation…
                </p>
              ) : (
                <>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="min-w-0 text-sm font-semibold text-foreground">
                        Member {detail.member_ref}
                      </h3>
                      <span className="text-[11px] text-muted-foreground">
                        Opened {formatWhen(detail.opened_at)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone={statusTone(detail.status)}>
                        {conversationStatusLabel(detail.status)}
                      </StatusBadge>
                      <StatusBadge tone="muted">
                        {conversationCategoryLabel(detail.category)}
                      </StatusBadge>
                      {detail.priority === "HIGH" ? (
                        <StatusBadge tone="red">High priority</StatusBadge>
                      ) : null}
                      {detail.contact_status === "BLOCKED" ? (
                        <StatusBadge tone="red">Blocked</StatusBadge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {detail.origin_title_snapshot || conversationOriginLabel(detail.origin_type)}
                    </p>
                  </div>

                  {/* Status controls — internal Inbox state only. */}
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label="Set conversation status"
                  >
                    {CONVERSATION_STATUSES.map((s) => {
                      const isCurrent = detail.status === s;
                      return (
                        <Button
                          key={s}
                          type="button"
                          size="sm"
                          variant={isCurrent ? "default" : "outline"}
                          className="min-h-11 text-xs"
                          aria-pressed={isCurrent}
                          disabled={isCurrent || statusMutation.isPending}
                          onClick={() => {
                            if (s === "RESOLVED") {
                              setResolveDialogOpen(true);
                            } else {
                              statusMutation.mutate({
                                conversationId: detail.conversation_id,
                                status: s,
                              });
                            }
                          }}
                        >
                          {CONVERSATION_STATUS_LABELS[s]}
                        </Button>
                      );
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-11 text-xs"
                      disabled={blockMutation.isPending}
                      onClick={() =>
                        setBlockDialog(detail.contact_status === "BLOCKED" ? "unblock" : "block")
                      }
                    >
                      {detail.contact_status === "BLOCKED" ? "Unblock member" : "Block member"}
                    </Button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Status is internal Inbox state — changing it does not send anything to the
                    member on Telegram. Replies you send below are delivered separately and show
                    their own delivery state.
                  </p>


                  {/* Origin context — NOT a conversation message row. */}
                  {detail.origin_text_snapshot ? (
                    <div className="rounded-md border border-border/60 bg-surface-raised/40 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Original project message
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
                        {detail.origin_text_snapshot}
                      </p>
                    </div>
                  ) : null}

                  {/* Message timeline */}
                  {messagesQuery.isError ? (
                    <div className="rounded-md border border-border/60 bg-background/40 p-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Messages could not be loaded right now.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 min-h-11"
                        onClick={() => void messagesQuery.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : messagesQuery.isPending ? (
                    <p className="p-1 text-xs leading-relaxed text-muted-foreground">
                      Loading messages…
                    </p>
                  ) : messages.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border/70 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
                      No messages are available in this conversation.
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-2" aria-label="Conversation messages">
                      {messages.map((m) => {
                        const isMember = m.author_type === "MEMBER";
                        const isSystem = m.author_type === "SYSTEM";
                        const authorLabel = isMember
                          ? "Member"
                          : isSystem
                            ? "System"
                            : m.team_display_name || "Team";
                        const channelLabel =
                          m.channel === "TELEGRAM"
                            ? "Telegram"
                            : m.channel === "WEB"
                              ? "Web"
                              : "System";
                        const isUncertain = m.delivery_status === "ambiguous";
                        const uncertainUnacked =
                          isUncertain && !m.delivery_uncertainty_acknowledged_at;
                        return (
                          <li
                            key={m.message_id}
                            className={cn(
                              "min-w-0 rounded-md border p-3",
                              isMember
                                ? "border-gold/30 bg-gold/5"
                                : isSystem
                                  ? "border-border/50 bg-surface-raised/30"
                                  : "border-pepe/30 bg-pepe/5",
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                              <span className="text-xs font-semibold text-foreground">
                                {authorLabel}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {channelLabel} · {formatWhen(m.created_at)}
                              </span>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                              {m.body}
                            </p>
                            {m.delivery_status ? (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <StatusBadge tone={deliveryTone(m.delivery_status)}>
                                  {isUncertain && m.delivery_uncertainty_acknowledged_at
                                    ? "Delivery uncertain · acknowledged"
                                    : deliveryStatusLabel(m.delivery_status)}
                                </StatusBadge>
                              </div>
                            ) : null}
                            {isUncertain ? (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                                We could not confirm this reply reached the member. Telegram may
                                already have delivered it. It will not be resent automatically —
                                resending is your decision.
                              </p>
                            ) : null}
                            {m.delivery_status === "failed" ? (
                              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                                This reply was not sent. Nothing reached the member.
                              </p>
                            ) : null}
                            {uncertainUnacked ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2 min-h-11 text-xs"
                                disabled={ackMutation.isPending}
                                onClick={() => setAckDialogMessageId(m.message_id)}
                              >
                                Acknowledge uncertainty
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  )}

                  {/* -------------------------------------------- reply composer */}
                  {(() => {
                    const isBlocked = detail.contact_status === "BLOCKED";
                    const isResolved = detail.status === "RESOLVED";
                    const attemptFrozen = pendingAttempt !== null;
                    const composerDisabled =
                      isBlocked ||
                      isResolved ||
                      hasInFlightReply ||
                      hasUnacknowledgedUncertainReply ||
                      replyMutation.isPending ||
                      attemptFrozen;
                    const value = attemptFrozen ? pendingAttempt.attemptedBody : replyBody;
                    const trimmed = value.trim();
                    return (
                      <div className="rounded-md border border-border/60 bg-background/40 p-3">
                        <label
                          htmlFor="inbox-reply-body"
                          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                        >
                          Reply to this member
                        </label>
                        <Textarea
                          id="inbox-reply-body"
                          value={value}
                          onChange={(event) =>
                            setReplyBody(event.target.value.slice(0, REPLY_MAX))
                          }
                          rows={4}
                          maxLength={REPLY_MAX}
                          className="mt-2"
                          placeholder="Write your reply. It is sent as a plain private Telegram message from your official bot."
                          disabled={composerDisabled}
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="min-h-11"
                            disabled={composerDisabled || trimmed.length === 0}
                            onClick={() => {
                              const requestId = crypto.randomUUID();
                              const attemptedBody = trimmed;
                              setPendingAttempt({ requestId, attemptedBody });
                              replyMutation.mutate({
                                conversationId: detail.conversation_id,
                                body: attemptedBody,
                                requestId,
                              });
                            }}
                          >
                            {replyMutation.isPending ? "Sending…" : "Send through bot"}
                          </Button>
                          <span className="text-[11px] text-muted-foreground">
                            {value.length}/{REPLY_MAX}
                          </span>
                        </div>

                        {attemptFrozen && !replyMutation.isPending ? (
                          <div className="mt-2 rounded-md border border-red/40 bg-red/5 p-2.5">
                            <p className="text-[11px] leading-relaxed text-foreground">
                              We could not confirm whether the server accepted this reply. It may
                              already be queued. Retry sends the SAME reply with the same request
                              id, so it can never be queued twice.
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="min-h-11"
                                onClick={() =>
                                  replyMutation.mutate({
                                    conversationId: detail.conversation_id,
                                    body: pendingAttempt.attemptedBody,
                                    requestId: pendingAttempt.requestId,
                                  })
                                }
                              >
                                Retry this reply
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-h-11"
                                onClick={() => setAbandonDialogOpen(true)}
                              >
                                Abandon local retry
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                          {isBlocked
                            ? "This member is blocked, so replies cannot be sent."
                            : isResolved
                              ? "This conversation is resolved. Reopen it above before replying."
                              : hasInFlightReply
                                ? "Reply is being delivered…"
                                : hasUnacknowledgedUncertainReply
                                  ? "Delivery uncertain — acknowledge the uncertain reply above before sending another."
                                  : "Your reply is delivered privately on Telegram from @PepeCartelHQBot. Cartel HQ prefixes it with your saved Project Profile name and ticker and the line OFFICIAL PROJECT RESPONSE, and adds an official-response footer. Plain text only."}
                        </p>
                        {!repliesOn ? (
                          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                            Reply capture is off, so NEW inbound replies from members are not being
                            captured. You can still reply in this conversation.
                          </p>
                        ) : null}
                        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                          Delivery activation is still pending, so a queued reply has not reached
                          the member yet. Each reply shows its own delivery state above.
                        </p>
                      </div>
                    );
                  })()}

                </>
              )}

            </Section>
          </div>
        ) : (
          <div className="hidden min-w-0 lg:block">
            <Section variant="quiet" contentClassName="p-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Select a conversation to read the thread. Members are shown by opaque reference
                only.
              </p>
            </Section>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ settings dialogs */}
      <AlertDialog
        open={settingsDialog !== null}
        onOpenChange={(open) => {
          if (!open) setSettingsDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {settingsDialog === "enable" ? "Enable reply capture?" : "Turn off reply capture?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {settingsDialog === "enable"
                ? "Explicit private replies to your official Launch Watch bot messages will be captured into this Inbox."
                : "New explicit replies will stop being captured. Existing conversations and messages remain in the Inbox."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {settingsDialog === "enable" ? (
            <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
              <li>
                Only an explicit reply to a known official Launch Watch bot message is captured —
                arbitrary bot DMs, commands and group messages are not.
              </li>
              <li>
                Your team sees an opaque Member reference, never the subscriber&apos;s Telegram
                user id or username.
              </li>
              <li>
                Starting new conversations from arbitrary bot DMs stays off — this switch does not
                enable it.
              </li>
            </ul>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                repliesMutation.mutate(settingsDialog === "enable");
                setSettingsDialog(null);
              }}
            >
              {settingsDialog === "enable" ? "Enable reply capture" : "Turn off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -------------------------------------------------- resolve dialog */}
      <AlertDialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this conversation as resolved?</AlertDialogTitle>
            <AlertDialogDescription>
              This is internal Inbox state only — the member is not notified on Telegram. If the
              member sends another eligible reply later, the conversation reopens automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                if (detail) {
                  statusMutation.mutate({
                    conversationId: detail.conversation_id,
                    status: "RESOLVED",
                  });
                }
                setResolveDialogOpen(false);
              }}
            >
              Mark resolved
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------------------------------------- block/unblock dialog */}
      <AlertDialog
        open={blockDialog !== null}
        onOpenChange={(open) => {
          if (!open) setBlockDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {blockDialog === "block"
                ? `Block Member ${detail?.member_ref ?? ""}?`
                : `Unblock Member ${detail?.member_ref ?? ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {blockDialog === "block"
                ? "Future replies from this member will be ignored for this workspace. The historical conversation and its messages remain in the Inbox."
                : "Future eligible explicit replies from this member can be captured again, as long as reply capture is enabled."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                if (detail) {
                  blockMutation.mutate({
                    conversationId: detail.conversation_id,
                    blocked: blockDialog === "block",
                  });
                }
                setBlockDialog(null);
              }}
            >
              {blockDialog === "block" ? "Block member" : "Unblock member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --------------------------------------- uncertainty acknowledgement */}
      <AlertDialog
        open={ackDialogMessageId !== null}
        onOpenChange={(open) => {
          if (!open) setAckDialogMessageId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Acknowledge this uncertain delivery?</AlertDialogTitle>
            <AlertDialogDescription>
              Telegram MAY already have delivered this reply to the member. Acknowledging does not
              mark it sent, does not mark it failed and does not resend anything — it only records
              that you reviewed the uncertainty so you can deliberately send another reply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                if (ackDialogMessageId) {
                  ackMutation.mutate({ messageId: ackDialogMessageId });
                }
                setAckDialogMessageId(null);
              }}
            >
              Acknowledge uncertainty
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ------------------------------------------- abandon local retry */}
      <AlertDialog open={abandonDialogOpen} onOpenChange={setAbandonDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandon this local retry?</AlertDialogTitle>
            <AlertDialogDescription>
              The server may already have accepted your previous attempt. Abandoning sends nothing
              and cancels nothing — it only lets you start a new draft. If the earlier reply was
              accepted, it stays queued and still blocks a new send until it settles.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep retry</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                setPendingAttempt(null);
                setReplyBody("");
                setAbandonDialogOpen(false);
                void queryClient.invalidateQueries({
                  queryKey: projectInboxKeys.messages(workspaceId, selectedConversationId),
                });
              }}
            >
              Abandon local retry
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>

  );
}
