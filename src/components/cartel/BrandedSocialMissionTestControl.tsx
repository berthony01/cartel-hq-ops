import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ImageIcon, Loader2, ShieldAlert } from "lucide-react";
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
import { sendMissionCard, type SendMissionCardResult } from "@/lib/social-mission-telegram";

/**
 * SE-3.3L — owner-only, single-fixture BRANDED Social Mission live-test control.
 *
 * Diagnostic only. It proves SE-3.3 branded transport behaviour once against a
 * pre-prepared production fixture. It is NOT the Social Campaigns UI and NOT the
 * automation path.
 *
 * The browser supplies nothing but the three authoritative ids read back from
 * the database and one generated request id: no chat id, no URL, no caption, no
 * logo reference, no transport kind. The already-deployed Edge Function resolves
 * and validates the Project Profile logo itself and promotes the target to PHOTO
 * atomically on claim.
 */

/** The ONLY fixture this control will ever operate on. */
const BRANDED_TEST_CONTROL_MARKER = "pepe_cartel_branded_v1";
const REQUIRED_WORKSPACE_ID = "311dfe4c-24f8-47b6-8af3-48b73e4dbfaa";
const REQUIRED_GROUP_TITLE = "PEPE CARTEL COMMUNITY";
const REQUIRED_CANONICAL_URL = "https://x.com/PEPECARTELTOKEN/status/2098827349470961903";
const REQUIRED_MISSION_STATUS = "LIVE";
const REQUIRED_DELIVERY_STATE = "PENDING";

const SEND_LABEL = "Send branded test card";
const CONFIRM_TITLE = "Post one branded Social Mission message?";
const CONFIRM_BODY =
  `This posts ONE new branded Social Mission message into ${REQUIRED_GROUP_TITLE}, ` +
  "sent by the existing @PepeCartelHQBot bot. It will not resend automatically: " +
  "there is no retry and no second attempt from this control, and it cannot be unsent from here.";

type BrandedFixture = {
  missionId: string;
  workspaceId: string;
  missionStatus: string;
  targetId: string;
  deliveryState: string;
  transportKind: string;
  groupConnectionId: string | null;
  telegramMessageId: number | null;
  sentAt: string | null;
  lastError: string | null;
  groupTitle: string | null;
  canonicalUrl: string | null;
};

type BrandedFixtureLoad = { ok: true; fixture: BrandedFixture } | { ok: false; reason: string };

async function loadBrandedFixture(): Promise<BrandedFixtureLoad> {
  const missions = await supabase
    .from("social_missions")
    .select("id, workspace_id, status, social_post_id")
    .contains("metadata", { owner_test_control: BRANDED_TEST_CONTROL_MARKER })
    .limit(5);

  if (missions.error) {
    return { ok: false, reason: "Could not read the prepared branded mission fixture." };
  }
  const missionRows = missions.data ?? [];
  if (missionRows.length === 0) {
    return { ok: false, reason: "No prepared branded test mission found for this marker." };
  }
  if (missionRows.length > 1) {
    return {
      ok: false,
      reason: "More than one mission carries the branded marker. Resolve before testing.",
    };
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
      "id, delivery_state, transport_kind, group_connection_id, telegram_message_id, sent_at, last_error",
    )
    .eq("mission_id", mission.id)
    .limit(5);
  if (targets.error) return { ok: false, reason: "Could not read the bound mission target." };
  const targetRows = targets.data ?? [];
  if (targetRows.length === 0) {
    return { ok: false, reason: "The prepared branded mission has no target." };
  }
  if (targetRows.length > 1) {
    return {
      ok: false,
      reason: "The prepared branded mission has more than one target. Resolve before testing.",
    };
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
      transportKind: target.transport_kind,
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

export function BrandedSocialMissionTestControl() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<SendMissionCardResult | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["owner-branded-social-mission-fixture", BRANDED_TEST_CONTROL_MARKER],
    queryFn: loadBrandedFixture,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const load = query.data;
  const fixture = load?.ok ? load.fixture : null;

  const gates = fixture
    ? [
        {
          label: "Fixture belongs to the expected workspace",
          ok: fixture.workspaceId === REQUIRED_WORKSPACE_ID,
          detail:
            fixture.workspaceId === REQUIRED_WORKSPACE_ID
              ? "Workspace matches the pinned value"
              : "Workspace does not match the pinned value",
        },
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
        {
          label: "No Telegram message exists yet for this target",
          ok: fixture.telegramMessageId === null,
          detail: `Message id: ${fixture.telegramMessageId ?? "—"}`,
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

  const brandedProven = fixture?.deliveryState === "SENT" && fixture?.transportKind === "PHOTO";
  const textFallback = fixture?.deliveryState === "SENT" && fixture?.transportKind !== "PHOTO";

  return (
    <Section
      variant="surface"
      leading={<ImageIcon className="size-4" aria-hidden="true" />}
      title="Branded Social Mission live test"
      description="One pre-prepared branded fixture. Exactly one send, no retry, no resend, no edit."
      actions={
        <StatusBadge tone={canSend ? "gold" : "muted"}>
          <span>{canSend ? "Armed" : "Locked"}</span>
        </StatusBadge>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm [overflow-wrap:anywhere]">
          This is a one-time branded transport test. The backend uses the Project Profile logo
          automatically when it resolves and validates, and falls back to a plain text card
          otherwise. No logo is uploaded, chosen or referenced from this control, and it cannot
          choose a different group, post or message.
        </p>

        {query.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
            Loading the prepared branded fixture…
          </p>
        ) : null}

        {query.isError ? (
          <InlineRow
            leading={<AlertTriangle className="size-4" aria-hidden="true" />}
            title="Fixture unavailable"
            subtitle="The prepared branded fixture could not be read with this session."
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
                subtitle={`Transport kind: ${fixture.transportKind} · Telegram message id: ${
                  fixture.telegramMessageId ?? "—"
                } · Sent at: ${formatWhen(fixture.sentAt)}`}
                trailing={
                  <StatusBadge tone={fixture.deliveryState === "SENT" ? "green" : "muted"}>
                    <span>{fixture.deliveryState}</span>
                  </StatusBadge>
                }
              />
              {brandedProven ? (
                <InlineRow
                  title="Branded transport proven"
                  subtitle="The durable record is SENT with transport kind PHOTO."
                  trailing={
                    <StatusBadge tone="green">
                      <span>PHOTO</span>
                    </StatusBadge>
                  }
                />
              ) : null}
              {textFallback ? (
                <InlineRow
                  leading={<AlertTriangle className="size-4" aria-hidden="true" />}
                  title="Text fallback, not branded"
                  subtitle={`The message was sent, but the durable transport kind is ${fixture.transportKind}. The branded photo path is NOT proven.`}
                  trailing={
                    <StatusBadge tone="red">
                      <span>Fallback</span>
                    </StatusBadge>
                  }
                />
              ) : null}
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

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                disabled={!canSend}
                onClick={() => setConfirmOpen(true)}
                className="h-11 w-full min-w-0 bg-gold px-5 text-sm font-semibold text-background hover:bg-gold/90 sm:w-auto"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ImageIcon className="size-4" aria-hidden="true" />
                )}
                <span>{SEND_LABEL}</span>
              </Button>
            </div>

            {attempted ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                A branded send was already attempted in this session. This control offers no retry
                and no resend; the authoritative state above is the record of what happened.
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
            <AlertDialogAction onClick={confirmedSend}>Post the branded message</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
