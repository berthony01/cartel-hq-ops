/**
 * MINI-HQ-1B — owner Mini App Project Inbox.
 *
 * Every read/write goes through the Telegram-authorized bridge, which calls
 * the service-only wrappers that delegate to the EXISTING Project Inbox RPCs.
 * This component holds no business rules: it bounds input, freezes one client
 * request UUID per reply attempt, and renders server truth. Only the opaque
 * member_ref is ever shown — no Telegram identifiers reach this screen.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  MINIAPP_REPLY_MAX_CHARS,
  miniAppInboxAckUncertainty,
  miniAppInboxList,
  miniAppInboxReply,
  miniAppInboxSetBlocked,
  miniAppInboxSetStatus,
  miniAppInboxThread,
  type MiniAppInboxMessage,
  type MiniAppInboxStatus,
} from "@/lib/telegram-miniapp-bridge.functions";
import {
  MiniAppActionButton,
  MiniAppChoiceChip,
  MiniAppMessage,
  MiniAppNotice,
  MiniAppPanel,
  MiniAppRetryButton,
  MiniAppSkeleton,
} from "@/components/telegram-miniapp/MiniAppPieces";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { newRequestId } from "@/lib/telegram-miniapp-client";

export const INBOX_FILTERS: { key: MiniAppInboxStatus | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "WAITING_ON_TEAM", label: "Needs reply" },
  { key: "WAITING_ON_MEMBER", label: "Waiting on member" },
  { key: "OPEN", label: "Open" },
  { key: "RESOLVED", label: "Resolved" },
];

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  WAITING_ON_TEAM: "Needs reply",
  WAITING_ON_MEMBER: "Waiting on member",
  RESOLVED: "Resolved",
};

const DELIVERY_LABELS: Record<string, string> = {
  pending: "Sending",
  processing: "Sending",
  retry: "Sending",
  sent: "Sent via Telegram",
  failed: "Not sent",
  ambiguous: "Delivery uncertain",
};
const SETTLING = new Set(["pending", "processing", "retry"]);

function statusTone(status: string): "green" | "gold" | "red" | "muted" {
  if (status === "WAITING_ON_TEAM") return "gold";
  if (status === "RESOLVED") return "muted";
  return "green";
}

function deliveryTone(status: string): string {
  if (status === "sent") return "text-pepe";
  if (status === "failed") return "text-signal";
  if (status === "ambiguous") return "text-gold";
  return "text-muted-foreground";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** User-safe copy for bounded Inbox failure reasons. */
export function inboxFailureMessage(reason: string | null | undefined): string {
  if (!reason) return "The inbox could not load right now.";
  if (reason.startsWith("inbox:")) return reason.slice("inbox:".length);
  switch (reason) {
    case "not_found":
    case "invalid_workspace_id":
      return "This conversation is not available for your account.";
    case "inbox_plan_required":
      return "Project Inbox replies are not included in this project's current plan.";
    case "invalid_status":
    case "invalid_request":
      return "That request was not valid.";
    case "unavailable":
    case "missing_bot_token":
      return "The inbox is temporarily unavailable. Try again in a moment.";
    default:
      return "Your Telegram session expired. Close and reopen the console from the bot.";
  }
}

export function MiniAppInbox({
  initData,
  workspaceId,
  conversationId,
  onOpenConversation,
}: {
  initData: string;
  workspaceId: string;
  conversationId: string | null;
  onOpenConversation: (conversationId: string | null) => void;
}) {
  return conversationId ? (
    <InboxThread
      initData={initData}
      workspaceId={workspaceId}
      conversationId={conversationId}
      onBack={() => onOpenConversation(null)}
    />
  ) : (
    <InboxList initData={initData} workspaceId={workspaceId} onOpen={onOpenConversation} />
  );
}

function InboxList({
  initData,
  workspaceId,
  onOpen,
}: {
  initData: string;
  workspaceId: string;
  onOpen: (conversationId: string) => void;
}) {
  const [filter, setFilter] = useState<MiniAppInboxStatus | null>("WAITING_ON_TEAM");
  const list = useServerFn(miniAppInboxList);
  const query = useQuery({
    queryKey: ["tg", "inbox", "list", workspaceId, filter ?? "ALL"],
    queryFn: () => list({ data: { initData, workspaceId, status: filter } }),
  });
  const failure = query.data && !query.data.ok ? query.data.reason : null;
  const rows = query.data?.ok ? query.data.conversations : [];

  return (
    <MiniAppPanel heading="Project Inbox" note="Members are shown by private reference only.">
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
        {INBOX_FILTERS.map((item) => (
          <div key={item.label} className="shrink-0">
            <MiniAppChoiceChip
              label={item.label}
              selected={filter === item.key}
              onSelect={() => setFilter(item.key)}
            />
          </div>
        ))}
      </div>
      {query.isPending ? (
        <MiniAppSkeleton label="Loading conversations…" />
      ) : query.isError || failure ? (
        <MiniAppMessage
          title="Could not load the inbox"
          description={inboxFailureMessage(failure ?? "unavailable")}
          action={<MiniAppRetryButton onRetry={() => void query.refetch()} pending={query.isFetching} />}
        />
      ) : rows.length === 0 ? (
        <MiniAppMessage title="No conversations" description="Nothing matches this filter right now." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.conversationId} className="min-w-0">
              <button
                type="button"
                onClick={() => onOpen(row.conversationId)}
                className="flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-surface-raised/50 px-3 py-2.5 text-left transition-colors hover:border-gold/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-xs font-semibold text-foreground">
                      {row.memberRef}
                    </span>
                    {row.contactStatus === "BLOCKED" ? (
                      <span className="shrink-0 text-[10px] uppercase text-signal">Blocked</span>
                    ) : null}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {row.preview ?? "No message preview"}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {formatWhen(row.lastMessageAt)}
                  </span>
                </span>
                <StatusBadge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</StatusBadge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </MiniAppPanel>
  );
}

type ReplyAttempt = { requestId: string; body: string };

function InboxThread({
  initData,
  workspaceId,
  conversationId,
  onBack,
}: {
  initData: string;
  workspaceId: string;
  conversationId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const loadThread = useServerFn(miniAppInboxThread);
  const sendReply = useServerFn(miniAppInboxReply);
  const setStatus = useServerFn(miniAppInboxSetStatus);
  const setBlocked = useServerFn(miniAppInboxSetBlocked);
  const ackUncertainty = useServerFn(miniAppInboxAckUncertainty);

  const threadKey = ["tg", "inbox", "thread", workspaceId, conversationId] as const;
  const thread = useQuery({
    queryKey: threadKey,
    queryFn: () => loadThread({ data: { initData, workspaceId, conversationId } }),
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.ok && d.messages.some((m) => m.deliveryStatus && SETTLING.has(m.deliveryStatus))
        ? 5000
        : false;
    },
  });

  const [draft, setDraft] = useState("");
  /** Frozen attempt: same UUID + exact body until a definite outcome. */
  const [attempt, setAttempt] = useState<ReplyAttempt | null>(null);
  const [uncertainNetwork, setUncertainNetwork] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; text: string } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);

  useEffect(() => {
    setDraft("");
    setAttempt(null);
    setUncertainNetwork(false);
    setNotice(null);
    setConfirmBlock(false);
  }, [conversationId]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: threadKey });
    void queryClient.invalidateQueries({ queryKey: ["tg", "inbox", "list", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["tg", "inbox", "summary", workspaceId] });
  };

  const reply = useMutation({
    mutationFn: (a: ReplyAttempt) =>
      sendReply({
        data: { initData, workspaceId, conversationId, body: a.body, clientRequestId: a.requestId },
      }),
    onSuccess: (result) => {
      setUncertainNetwork(false);
      if (result.ok) {
        setAttempt(null);
        setDraft("");
        setNotice({
          tone: "success",
          text: result.idempotentReplay
            ? "This reply was already queued. It was not sent twice."
            : "Reply queued. Delivery status appears below.",
        });
      } else {
        // Definite refusal: the next edit starts a fresh attempt.
        setAttempt(null);
        setNotice({ tone: "error", text: inboxFailureMessage(result.reason) });
      }
      refresh();
    },
    onError: () => {
      // Outcome unknown: keep the SAME request id and body frozen so a retry
      // can only replay, never duplicate.
      setUncertainNetwork(true);
      setNotice({
        tone: "warning",
        text: "Connection lost before confirmation. Retry sends the same request and cannot duplicate it.",
      });
    },
  });

  const action = useMutation({
    mutationFn: async (kind: "resolve" | "reopen" | "block" | "unblock" | { ack: string }) => {
      if (kind === "resolve" || kind === "reopen") {
        return setStatus({
          data: { initData, workspaceId, conversationId, status: kind === "resolve" ? "RESOLVED" : "OPEN" },
        });
      }
      if (kind === "block" || kind === "unblock") {
        return setBlocked({ data: { initData, workspaceId, conversationId, blocked: kind === "block" } });
      }
      return ackUncertainty({ data: { initData, workspaceId, conversationId, messageId: kind.ack } });
    },
    onSuccess: (result) => {
      setConfirmBlock(false);
      setNotice(result.ok ? null : { tone: "error", text: inboxFailureMessage(result.reason) });
      refresh();
    },
    onError: () => setNotice({ tone: "error", text: "The action could not be confirmed. Refresh to check." }),
  });

  const data = thread.data?.ok ? thread.data : null;
  const failure = thread.data && !thread.data.ok ? thread.data.reason : null;
  const messages = useMemo(
    () => [...(data?.messages ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data],
  );

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-10 items-center gap-1 self-start text-xs font-semibold text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      All conversations
    </button>
  );

  if (thread.isPending) {
    return (
      <>
        {back}
        <MiniAppSkeleton label="Loading conversation…" />
      </>
    );
  }
  if (thread.isError || failure || !data) {
    return (
      <>
        {back}
        <MiniAppMessage
          title="Conversation unavailable"
          description={inboxFailureMessage(failure ?? "unavailable")}
          action={<MiniAppRetryButton onRetry={() => void thread.refetch()} pending={thread.isFetching} />}
        />
      </>
    );
  }

  const convo = data.conversation;
  const resolved = convo.status === "RESOLVED";
  const blocked = convo.contactStatus === "BLOCKED";
  const composerLocked = attempt !== null;
  const bodyToSend = attempt?.body ?? draft;
  const length = bodyToSend.length;
  const canSend =
    !reply.isPending && !resolved && !blocked && bodyToSend.trim().length >= 1 && length <= MINIAPP_REPLY_MAX_CHARS;

  const submit = () => {
    if (attempt) {
      reply.mutate(attempt);
      return;
    }
    const requestId = newRequestId();
    if (!requestId) {
      setNotice({ tone: "error", text: "This device cannot create a safe request id. Reply from CARTEL HQ." });
      return;
    }
    const frozen = { requestId, body: draft };
    setAttempt(frozen);
    reply.mutate(frozen);
  };

  return (
    <>
      {back}
      <MiniAppPanel heading="Conversation">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="truncate font-mono text-sm font-semibold text-foreground">{convo.memberRef}</p>
          <StatusBadge tone={statusTone(convo.status)}>{STATUS_LABELS[convo.status] ?? convo.status}</StatusBadge>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {convo.category}
          {convo.originTitle ? ` · ${convo.originTitle}` : ""}
          {blocked ? " · Member blocked" : ""}
        </p>
      </MiniAppPanel>

      <MiniAppPanel heading="Messages">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No messages yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {messages.map((m) => (
              <MessageBubble
                key={m.messageId}
                message={m}
                onAck={() => action.mutate({ ack: m.messageId })}
                ackPending={action.isPending}
              />
            ))}
          </ol>
        )}
      </MiniAppPanel>

      {notice ? <MiniAppNotice tone={notice.tone} message={notice.text} /> : null}

      <MiniAppPanel
        heading="Reply"
        note={
          resolved
            ? "Reopen this conversation before replying."
            : blocked
              ? "Unblock this member before replying."
              : "Queued replies are delivered by the CARTEL HQ bot."
        }
      >
        <textarea
          value={bodyToSend}
          onChange={(e) => setDraft(e.target.value)}
          disabled={composerLocked || resolved || blocked}
          maxLength={MINIAPP_REPLY_MAX_CHARS}
          rows={4}
          aria-label="Reply message"
          className="w-full min-w-0 resize-y rounded-md border border-border/70 bg-background/40 px-3 py-2 text-sm text-foreground outline-none focus:border-gold/50 disabled:opacity-60"
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{composerLocked && uncertainNetwork ? "Locked until this attempt is confirmed" : ""}</span>
          <span className="tabular-nums">
            {length}/{MINIAPP_REPLY_MAX_CHARS}
          </span>
        </div>
        <div className="mt-2">
          <MiniAppActionButton
            label={uncertainNetwork ? "Retry same reply" : "Queue reply"}
            pendingLabel="Queuing…"
            onPress={submit}
            pending={reply.isPending}
            disabled={!canSend}
          />
        </div>
      </MiniAppPanel>

      <MiniAppPanel heading="Actions">
        <div className="grid grid-cols-2 gap-2">
          <MiniAppActionButton
            tone="quiet"
            label={resolved ? "Reopen conversation" : "Resolve conversation"}
            onPress={() => action.mutate(resolved ? "reopen" : "resolve")}
            pending={action.isPending}
          />
          {blocked ? (
            <MiniAppActionButton
              tone="quiet"
              label="Unblock"
              onPress={() => action.mutate("unblock")}
              pending={action.isPending}
            />
          ) : confirmBlock ? (
            <MiniAppActionButton
              tone="quiet"
              label="Confirm block"
              onPress={() => action.mutate("block")}
              pending={action.isPending}
            />
          ) : (
            <MiniAppActionButton tone="quiet" label="Block member" onPress={() => setConfirmBlock(true)} />
          )}
        </div>
        {confirmBlock && !blocked ? (
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            Blocking stops this member's new messages from reaching the inbox. You can unblock later.
          </p>
        ) : null}
      </MiniAppPanel>
    </>
  );
}

function MessageBubble({
  message,
  onAck,
  ackPending,
}: {
  message: MiniAppInboxMessage;
  onAck: () => void;
  ackPending: boolean;
}) {
  const team = message.authorType === "TEAM";
  const system = message.authorType === "SYSTEM";
  const delivery = message.deliveryStatus;
  const needsAck = team && delivery === "ambiguous" && !message.uncertaintyAcknowledgedAt;
  return (
    <li className={team ? "flex min-w-0 justify-end" : "flex min-w-0 justify-start"}>
      <div
        className={
          system
            ? "w-full rounded-md border border-dashed border-border/60 px-3 py-2 text-center text-[11px] text-muted-foreground"
            : team
              ? "max-w-[85%] min-w-0 rounded-lg border border-gold/25 bg-gold/8 px-3 py-2"
              : "max-w-[85%] min-w-0 rounded-lg border border-border/60 bg-surface-raised/60 px-3 py-2"
        }
      >
        {!system ? (
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            {team ? (message.teamDisplayName ?? "Team") : "Member"}
          </p>
        ) : null}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">{message.body}</p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {formatWhen(message.createdAt)}
          {team && delivery ? (
            <span className={`ml-2 font-semibold ${deliveryTone(delivery)}`}>
              {DELIVERY_LABELS[delivery] ?? delivery}
            </span>
          ) : null}
        </p>
        {needsAck ? (
          <div className="mt-2 border-t border-border/40 pt-2">
            <p className="text-[11px] leading-4 text-muted-foreground">
              Telegram may already have delivered this. Acknowledging does NOT resend it; it only allows a new reply.
            </p>
            <button
              type="button"
              onClick={onAck}
              disabled={ackPending}
              className="mt-1 min-h-9 text-xs font-semibold text-gold disabled:opacity-60"
            >
              Acknowledge uncertainty
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
