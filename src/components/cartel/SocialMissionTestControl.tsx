import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { InlineRow } from "@/components/cartel/InlineRow";
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
import { supabase } from "@/integrations/supabase/client";
import {
  editMissionCard,
  sendMissionCard,
  type EditMissionCardResult,
  type SendMissionCardResult,
} from "@/lib/social-mission-telegram";
import {
  captureMissionMetrics,
  type CaptureMissionMetricsResult,
} from "@/lib/social-mission-metrics.functions";

/**
 * SE-3.1 — owner-only, single-fixture Social Mission live-test control.
 *
 * This control NEVER creates social posts, missions or targets, never writes
 * transport-state columns, never polls, never retries and never calls a social
 * provider directly from the browser. It performs exactly one
 * `sendMissionCard()` invocation, and only after explicit owner confirmation
 * against one pre-prepared, hard-pinned production fixture.
 *
 * SE-3.2A adds ONE further owner-only action against the SAME fixture: capture
 * current X metrics server-side (one official read, one snapshot row) and then
 * edit the SAME already-sent Telegram message in place exactly once. There is
 * no replacement send, no retry and no second edit from this control.
 */

/** The ONLY fixture this control will ever operate on. */
const OWNER_TEST_CONTROL_MARKER = "pepe_cartel_community_v1";
const REQUIRED_GROUP_TITLE = "PEPE CARTEL COMMUNITY";
const REQUIRED_CANONICAL_URL = "https://x.com/PEPECARTELTOKEN/status/2098827349470961903";
const REQUIRED_MISSION_STATUS = "LIVE";
const REQUIRED_DELIVERY_STATE = "PENDING";

const CONFIRM_TITLE = "Post one live Telegram message?";
const CONFIRM_BODY =
  `This posts ONE visible Telegram message into ${REQUIRED_GROUP_TITLE}, ` +
  "sent by the existing @PepeCartelHQBot bot. It cannot be unsent from here, " +
  "and there is no automatic retry: " +
  "if the send fails or is inconclusive, this control stays disabled and the authoritative " +
  "state is reported instead.";

/** SE-3.2A — metric capture + in-place edit of the SAME sent message. */
const REQUIRED_UPDATE_DELIVERY_STATE = "SENT";
const UPDATE_CONFIRM_TITLE = "Update the card that is already posted?";
const UPDATE_CONFIRM_BODY =
  "This reads the pinned X post once on the server, stores ONE metric snapshot, then edits " +
  `the SAME existing Telegram message in ${REQUIRED_GROUP_TITLE} in place, using the existing ` +
  "@PepeCartelHQBot bot. No replacement message is sent, no second message appears, and there " +
  "is no automatic retry: if the read, the snapshot or the edit fails, this control stays " +
  "disabled and the authoritative state is reported instead.";

type Fixture = {
  missionId: string;
  workspaceId: string;
  missionStatus: string;
  targetId: string;
  deliveryState: string;
  groupConnectionId: string | null;
  telegramMessageId: number | null;
  sentAt: string | null;
  lastError: string | null;
  groupTitle: string | null;
  canonicalUrl: string | null;
  editRevision: number;
  editState: string;
  lastEditAt: string | null;
  editLastError: string | null;
};

type FixtureLoad =
  | { ok: true; fixture: Fixture }
  | { ok: false; reason: string };

async function loadFixture(): Promise<FixtureLoad> {
  const missions = await supabase
    .from("social_missions")
    .select("id, workspace_id, status, social_post_id")
    .contains("metadata", { owner_test_control: OWNER_TEST_CONTROL_MARKER })
    .limit(5);

  if (missions.error) return { ok: false, reason: "Could not read the prepared mission fixture." };
  const missionRows = missions.data ?? [];
  if (missionRows.length === 0) {
    return { ok: false, reason: "No prepared test mission found for this marker." };
  }
  if (missionRows.length > 1) {
    return { ok: false, reason: "More than one mission carries this marker. Resolve before testing." };
  }
  const mission = missionRows[0]!;

  const post = await supabase
    .from("social_posts")
    .select("id, canonical_url")
    .eq("id", mission.social_post_id)
    .maybeSingle();
  if (post.error) return { ok: false, reason: "Could not read the bound social post." };
  if (!post.data) return { ok: false, reason: "The bound social post is missing." };

  const targets = await supabase
    .from("social_mission_targets")
    .select(
      "id, delivery_state, group_connection_id, telegram_message_id, sent_at, last_error, edit_revision, edit_state, last_edit_at, edit_last_error",
    )
    .eq("mission_id", mission.id)
    .limit(5);
  if (targets.error) return { ok: false, reason: "Could not read the bound mission target." };
  const targetRows = targets.data ?? [];
  if (targetRows.length === 0) return { ok: false, reason: "The prepared mission has no target." };
  if (targetRows.length > 1) {
    return { ok: false, reason: "The prepared mission has more than one target. Resolve before testing." };
  }
  const target = targetRows[0]!;

  let groupTitle: string | null = null;
  if (target.group_connection_id) {
    const group = await supabase
      .from("telegram_group_connections")
      .select("id, title")
      .eq("id", target.group_connection_id)
      .maybeSingle();
    if (group.error) return { ok: false, reason: "Could not read the bound Telegram group." };
    groupTitle = group.data?.title ?? null;
  }

  return {
    ok: true,
    fixture: {
      missionId: mission.id,
      workspaceId: mission.workspace_id,
      missionStatus: mission.status,
      targetId: target.id,
      deliveryState: target.delivery_state,
      groupConnectionId: target.group_connection_id,
      telegramMessageId: target.telegram_message_id,
      sentAt: target.sent_at,
      lastError: target.last_error,
      groupTitle,
      canonicalUrl: post.data.canonical_url,
    },
  };
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toUTCString();
}

function Gate({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <InlineRow
      leading={
        ok ? (
          <CheckCircle2 className="size-4" aria-hidden="true" />
        ) : (
          <ShieldAlert className="size-4" aria-hidden="true" />
        )
      }
      title={label}
      subtitle={detail}
      trailing={
        <StatusBadge tone={ok ? "green" : "red"}>
          <span>{ok ? "Pass" : "Blocked"}</span>
        </StatusBadge>
      }
    />
  );
}

export function SocialMissionTestControl() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendMissionCardResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const query = useQuery({
    queryKey: ["owner-social-mission-test-fixture", OWNER_TEST_CONTROL_MARKER],
    queryFn: loadFixture,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const load = query.data;
  const fixture = load?.ok ? load.fixture : null;

  const gates = fixture
    ? [
        {
          label: "Mission status is LIVE",
          ok: fixture.missionStatus === REQUIRED_MISSION_STATUS,
          detail: `Reported: ${fixture.missionStatus}`,
        },
        {
          label: "Target delivery state is PENDING",
          ok: fixture.deliveryState === REQUIRED_DELIVERY_STATE,
          detail: `Reported: ${fixture.deliveryState}`,
        },
        {
          label: "Target is bound to a Telegram group connection",
          ok: !!fixture.groupConnectionId,
          detail: fixture.groupConnectionId ? "Bound" : "No group connection on the target",
        },
        {
          label: `Group title is exactly ${REQUIRED_GROUP_TITLE}`,
          ok: fixture.groupTitle === REQUIRED_GROUP_TITLE,
          detail: `Reported: ${fixture.groupTitle ?? "—"}`,
        },
        {
          label: "Post canonical URL is the pinned PEPE CARTEL post",
          ok: fixture.canonicalUrl === REQUIRED_CANONICAL_URL,
          detail: `Reported: ${fixture.canonicalUrl ?? "—"}`,
        },
      ]
    : [];

  const allGatesPass = gates.length > 0 && gates.every((g) => g.ok);
  const canSend = !!fixture && allGatesPass && !sending && !attempted;

  async function confirmedSend() {
    if (!fixture || !allGatesPass || sending || attempted) return;
    setConfirmOpen(false);
    setSending(true);
    setAttempted(true);
    setSendError(null);
    try {
      const response = await sendMissionCard({
        workspaceId: fixture.workspaceId,
        missionId: fixture.missionId,
        targetId: fixture.targetId,
        clientRequestId: crypto.randomUUID(),
      });
      setResult(response);
    } catch (error) {
      setSendError(
        error instanceof Error && error.message
          ? error.message
          : "The mission transport service did not return a usable result.",
      );
    } finally {
      setSending(false);
      await query.refetch();
    }
  }

  return (
    <Section
      variant="surface"
      leading={<Send className="size-4" aria-hidden="true" />}
      title="Social Mission live test"
      description="One pre-prepared production fixture. Exactly one send, no retry, no resend, no edit."
      actions={
        <StatusBadge tone={canSend ? "gold" : "muted"}>
          <span>{canSend ? "Armed" : "Locked"}</span>
        </StatusBadge>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm [overflow-wrap:anywhere]">
          This control cannot create missions, posts or targets, cannot choose a different group or
          post, and cannot edit or resend a card. It only invokes the existing mission transport
          once for the fixture pinned below.
        </p>

        {query.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
            Loading the prepared fixture…
          </p>
        ) : null}

        {query.isError ? (
          <InlineRow
            leading={<AlertTriangle className="size-4" aria-hidden="true" />}
            title="Fixture unavailable"
            subtitle="The prepared fixture could not be read with this session."
            trailing={
              <StatusBadge tone="red">
                <span>Blocked</span>
              </StatusBadge>
            }
          />
        ) : null}

        {load && !load.ok ? (
          <InlineRow
            leading={<AlertTriangle className="size-4" aria-hidden="true" />}
            title="Fixture not ready"
            subtitle={load.reason}
            trailing={
              <StatusBadge tone="red">
                <span>Blocked</span>
              </StatusBadge>
            }
          />
        ) : null}

        {fixture ? (
          <>
            <div className="flex min-w-0 flex-col gap-2">
              {gates.map((gate) => (
                <Gate key={gate.label} label={gate.label} ok={gate.ok} detail={gate.detail} />
              ))}
            </div>

            <div className="flex min-w-0 flex-col gap-2">
              <InlineRow
                title="Authoritative delivery state"
                subtitle={`Telegram message id: ${
                  fixture.telegramMessageId ?? "—"
                } · Sent at: ${formatWhen(fixture.sentAt)}`}
                trailing={
                  <StatusBadge tone={fixture.deliveryState === "SENT" ? "green" : "muted"}>
                    <span>{fixture.deliveryState}</span>
                  </StatusBadge>
                }
              />
              {fixture.lastError ? (
                <InlineRow
                  leading={<AlertTriangle className="size-4" aria-hidden="true" />}
                  title="Last recorded transport error"
                  subtitle={fixture.lastError}
                  trailing={
                    <StatusBadge tone="red">
                      <span>Error</span>
                    </StatusBadge>
                  }
                />
              ) : null}
            </div>

            {result ? (
              <InlineRow
                title="Last send result"
                subtitle={`${result.message ?? "No additional detail."}${
                  result.duplicate ? " (Duplicate request — no second message was sent.)" : ""
                }`}
                trailing={
                  <StatusBadge tone={result.deliveryState === "SENT" ? "green" : "red"}>
                    <span>{result.deliveryState}</span>
                  </StatusBadge>
                }
              />
            ) : null}

            {sendError ? (
              <InlineRow
                leading={<AlertTriangle className="size-4" aria-hidden="true" />}
                title="Send did not return a confirmed result"
                subtitle={sendError}
                trailing={
                  <StatusBadge tone="red">
                    <span>Unresolved</span>
                  </StatusBadge>
                }
              />
            ) : null}

            <div className="flex min-w-0 flex-wrap gap-2">
              <Button
                type="button"
                disabled={!canSend}
                onClick={() => setConfirmOpen(true)}
                className="min-w-0"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                <span>Send the one test card</span>
              </Button>
            </div>

            {attempted ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                A send was already attempted in this session. This control offers no retry and no
                resend; the authoritative state above is the record of what happened.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-[min(32rem,92vw)]">
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRM_TITLE}</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {CONFIRM_BODY}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmedSend}>Post the message</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
