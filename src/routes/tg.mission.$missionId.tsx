/**
 * SE-16.2 UI — Mission detail with the two safe Mission Control mutations.
 *
 * The route `missionId` is an untrusted routing hint only: the SE-16.0 bridge
 * re-resolves the mission through operator-scoped RPCs and re-verifies live
 * Telegram group admin status before returning or changing anything. No chat
 * id, workspace id, Telegram user id, target id, actor id or edit revision is
 * ever sent from here — every mutation carries only the signed credential, the
 * mission routing hint, an opaque request id and bounded values.
 *
 * Ending and cancelling a mission stay bot-owned: this screen exposes no such
 * control and calls no such function.
 *
 * Truthfulness rule: the database mutation and the Telegram card refresh are
 * two separate facts. A committed mutation whose card refresh is unconfirmed
 * is reported as saved-but-unconfirmed, and a transport failure never claims a
 * save. Both cases keep the SAME payload and request id so a retry replays
 * idempotently instead of writing twice.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft } from "lucide-react";
import {
  miniAppApplyDuration,
  miniAppApplyTargets,
  miniAppMissionPanel,
} from "@/lib/telegram-miniapp-bridge.functions";
import {
  MiniAppActionButton,
  MiniAppChoiceChip,
  MiniAppEditorShell,
  MiniAppFieldRow,
  MiniAppFrame,
  MiniAppIdentity,
  MiniAppMessage,
  MiniAppNotice,
  MiniAppPanel,
  MiniAppRetryButton,
  MiniAppSkeleton,
  MiniAppStatLine,
} from "@/components/telegram-miniapp/MiniAppPieces";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  MINI_APP_DURATION_CHOICES,
  MINI_APP_MAX_MINUTES,
  MINI_APP_METRIC_LABELS,
  MINI_APP_MIN_MINUTES,
  MINI_APP_PINNED_SUPPORT,
  MINI_APP_PRIMARY_LABELS,
  MINI_APP_PRIMARY_TYPES,
  MINI_APP_SUPPORTING_METRICS,
  classifyMutationResult,
  formatMetricValue,
  formatTargetValue,
  formatTimeRemaining,
  isMinutesInBounds,
  miniAppFailureMessage,
  missionStatusTone,
  networkUncertaintyNotice,
  newRequestId,
  parseOptionalPositiveInt,
  parseRequiredPositiveInt,
  resolveTelegramSession,
  type MiniAppMutationNotice,
  type MiniAppSupportingMetric,
} from "@/lib/telegram-miniapp-client";

const METRIC_ORDER = ["views", "likes", "replies", "reposts", "bookmarks"] as const;

/** Exactly the bounded fields the bridge validator accepts for targets. */
type TargetsPayload = {
  initData: string;
  missionId: string;
  requestId: string;
  primaryType: string;
  primaryTarget: number;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  bookmarks: number | null;
};

/** Exactly the bounded fields the bridge validator accepts for duration. */
type DurationPayload = {
  initData: string;
  missionId: string;
  requestId: string;
  minutes: number;
};

type BoundedResult = { ok?: boolean; outcome?: string; refresh?: string; reason?: string };

/**
 * Exactly one retry can be pending at a time, and it carries its own kind, so
 * the visible Retry always replays the mutation the notice is about.
 */
type PendingRetry =
  | { kind: "targets"; payload: TargetsPayload }
  | { kind: "duration"; payload: DurationPayload };


const BLANK_SUPPORT: Record<MiniAppSupportingMetric, string> = {
  views: "",
  likes: "",
  replies: "",
  reposts: "",
  bookmarks: "",
};

export const Route = createFileRoute("/tg/mission/$missionId")({
  ssr: false,
  component: MiniAppMission,
});

function BackLink() {
  return (
    <Link
      to="/tg"
      className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-gold"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      All missions
    </Link>
  );
}

function MiniAppMission() {
  const { missionId } = Route.useParams();
  const [initData, setInitData] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const [editor, setEditor] = useState<"targets" | "duration" | null>(null);
  const [notice, setNotice] = useState<MiniAppMutationNotice | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [primaryType, setPrimaryType] = useState<string>("VIEWS");
  const [primaryDraft, setPrimaryDraft] = useState("");
  const [supportDraft, setSupportDraft] =
    useState<Record<MiniAppSupportingMetric, string>>(BLANK_SUPPORT);
  const [minutesDraft, setMinutesDraft] = useState("");

  /**
   * A SINGLE discriminated retry slot. Retained only so a retry resends the
   * identical payload and request id. Because there is exactly one slot, the
   * visible Retry can never fire the other mutation's stale payload.
   */
  const [pendingRetry, setPendingRetry] = useState<PendingRetry | null>(null);


  useEffect(() => {
    let cancelled = false;
    void resolveTelegramSession().then((credential) => {
      if (cancelled) return;
      setInitData(credential);
      setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPanel = useServerFn(miniAppMissionPanel);
  const panelQuery = useQuery({
    queryKey: ["tg", "panel", missionId],
    enabled: Boolean(initData),
    queryFn: () => loadPanel({ data: { initData: initData as string, missionId } }),
  });

  const applyTargetsFn = useServerFn(miniAppApplyTargets);
  const applyDurationFn = useServerFn(miniAppApplyDuration);

  /**

   * Committed mutations re-read authoritative state. `not_live` is not
   * committed and is never reported as success, but it still refetches so the
   * stale LIVE controls disappear when the mission ended after page load.
   */
  function settle(result: unknown, kind: PendingRetry["kind"], payload: PendingRetry["payload"]) {
    const bounded = result as BoundedResult;
    const classified = classifyMutationResult(bounded);
    setNotice(classified);
    // Exactly one slot: writing it replaces any opposite-kind payload.
    setPendingRetry(
      classified.retry ? ({ kind, payload } as PendingRetry) : null,
    );
    const noLongerLive = bounded?.ok === true && bounded.outcome === "not_live";
    if (classified.committed || noLongerLive) {
      setEditor(null);
      setFormError(null);
      if (noLongerLive) setPendingRetry(null);
      void panelQuery.refetch();
    }
  }

  const targetsMutation = useMutation({
    mutationFn: (payload: TargetsPayload) => applyTargetsFn({ data: payload }),
    onSuccess: (result, payload) => settle(result, "targets", payload),
    onError: (_error, payload) => {
      setPendingRetry({ kind: "targets", payload });
      setNotice(networkUncertaintyNotice());
    },
  });

  const durationMutation = useMutation({
    mutationFn: (payload: DurationPayload) => applyDurationFn({ data: payload }),
    onSuccess: (result, payload) => settle(result, "duration", payload),
    onError: (_error, payload) => {
      setPendingRetry({ kind: "duration", payload });
      setNotice(networkUncertaintyNotice());
    },
  });


  if (booting) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <MiniAppSkeleton label="Connecting to Telegram…" />
      </MiniAppFrame>
    );
  }

  if (!initData) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <MiniAppMessage
          title="Open Mission Control from Telegram"
          description="This screen only works inside the CARTEL HQ Telegram bot. Open Mission Control from the bot to continue."
        />
      </MiniAppFrame>
    );
  }

  if (panelQuery.isPending) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <BackLink />
        <MiniAppSkeleton label="Loading mission…" />
      </MiniAppFrame>
    );
  }

  const panel = panelQuery.data;
  if (panelQuery.isError || !panel || !panel.ok) {
    const reason = panel && !panel.ok ? panel.reason : "unavailable";
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <BackLink />
        <MiniAppMessage
          title="Mission unavailable"
          description={miniAppFailureMessage(reason)}
          action={
            <MiniAppRetryButton
              onRetry={() => void panelQuery.refetch()}
              pending={panelQuery.isFetching}
            />
          }
        />
      </MiniAppFrame>
    );
  }

  const isLive = panel.status.toUpperCase() === "LIVE";
  const mutationPending = targetsMutation.isPending || durationMutation.isPending;

  function openTargetsEditor() {
    if (!panel || !panel.ok) return;
    setPrimaryType(
      (MINI_APP_PRIMARY_TYPES as readonly string[]).includes(panel.primaryType.toUpperCase())
        ? panel.primaryType.toUpperCase()
        : "VIEWS",
    );
    setPrimaryDraft(panel.primaryTarget === null ? "" : String(panel.primaryTarget));
    const seeded = { ...BLANK_SUPPORT };
    for (const metric of MINI_APP_SUPPORTING_METRICS) {
      const current = panel.targets[metric];
      seeded[metric] = current === null || current === undefined ? "" : String(current);
    }
    setSupportDraft(seeded);
    setFormError(null);
    setNotice(null);
    // Opening a target edit discards any stale duration retry payload.
    setPendingRetry(null);
    setEditor("targets");
  }

  function openDurationEditor() {
    setMinutesDraft("");
    setFormError(null);
    setNotice(null);
    // Opening a duration edit discards any stale target retry payload.
    setPendingRetry(null);
    setEditor("duration");
  }


  function submitTargets() {
    if (!initData) return;
    const primary = parseRequiredPositiveInt(primaryDraft);
    if (!primary.ok || primary.value === null) {
      setFormError("Enter a primary target as a whole number above zero.");
      return;
    }
    const supporting: Record<MiniAppSupportingMetric, number | null> = {
      views: null,
      likes: null,
      replies: null,
      reposts: null,
      bookmarks: null,
    };
    for (const metric of MINI_APP_SUPPORTING_METRICS) {
      const parsed = parseOptionalPositiveInt(supportDraft[metric]);
      if (!parsed.ok) {
        setFormError("Supporting targets must be whole numbers above zero, or blank for Off.");
        return;
      }
      supporting[metric] = parsed.value;
    }
    const requestId = newRequestId();
    if (!requestId) {
      setFormError("This browser cannot submit securely. Reopen Mission Control from the bot.");
      return;
    }
    setFormError(null);
    // A new target submit invalidates any earlier retry payload of either kind.
    setPendingRetry(null);
    targetsMutation.mutate({

      initData,
      missionId,
      requestId,
      primaryType,
      primaryTarget: primary.value,
      views: supporting.views,
      likes: supporting.likes,
      replies: supporting.replies,
      reposts: supporting.reposts,
      bookmarks: supporting.bookmarks,
    });
  }

  function submitDuration(minutes: number) {
    if (!initData) return;
    if (!isMinutesInBounds(minutes)) {
      setFormError(
        `Choose a whole number of minutes between ${MINI_APP_MIN_MINUTES} and ${MINI_APP_MAX_MINUTES}.`,
      );
      return;
    }
    const requestId = newRequestId();
    if (!requestId) {
      setFormError("This browser cannot submit securely. Reopen Mission Control from the bot.");
      return;
    }
    setFormError(null);
    // A new duration submit invalidates any earlier retry payload of either kind.
    setPendingRetry(null);
    durationMutation.mutate({ initData, missionId, requestId, minutes });
  }

  function submitCustomDuration() {
    const parsed = parseRequiredPositiveInt(minutesDraft);
    if (!parsed.ok || parsed.value === null) {
      setFormError(
        `Choose a whole number of minutes between ${MINI_APP_MIN_MINUTES} and ${MINI_APP_MAX_MINUTES}.`,
      );
      return;
    }
    submitDuration(parsed.value);
  }

  /**
   * Retry replays the single active pending payload with its ORIGINAL request
   * id, dispatched by its own kind. No new id is ever minted here.
   */
  function retryPending() {
    if (!pendingRetry) return;
    if (pendingRetry.kind === "targets") targetsMutation.mutate(pendingRetry.payload);
    else durationMutation.mutate(pendingRetry.payload);
  }


  const pinned = MINI_APP_PINNED_SUPPORT[primaryType];

  return (
    <MiniAppFrame>
      <MiniAppIdentity subtitle={panel.workspaceName} />
      <BackLink />

      <section className="min-w-0 rounded-lg border border-gold/25 bg-gold/5 px-3.5 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate font-display text-xl uppercase leading-none text-foreground">
            {panel.authorHandle ? `@${panel.authorHandle}` : "Mission"}
          </h1>
          <StatusBadge tone={missionStatusTone(panel.status)}>{panel.status}</StatusBadge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{formatTimeRemaining(panel.endsAt)}</p>
      </section>

      <MiniAppPanel heading="Live X results" note="Latest stored mission snapshot.">
        {METRIC_ORDER.map((metric) => (
          <MiniAppStatLine
            key={metric}
            label={MINI_APP_METRIC_LABELS[metric] ?? metric}
            value={formatMetricValue(panel.results[metric])}
          />
        ))}
      </MiniAppPanel>

      <MiniAppPanel heading={`Targets · ${panel.controlMode}`}>
        <MiniAppStatLine
          label={`Primary goal · ${panel.primaryType}`}
          value={formatTargetValue(panel.primaryTarget)}
          emphasis
        />
        {METRIC_ORDER.map((metric) => (
          <MiniAppStatLine
            key={metric}
            label={`${MINI_APP_METRIC_LABELS[metric] ?? metric} target`}
            value={formatTargetValue(panel.targets[metric])}
          />
        ))}
      </MiniAppPanel>

      {notice ? (
        <MiniAppNotice
          tone={notice.tone}
          message={notice.message}
          action={
            notice.retry ? (
              <MiniAppRetryButton
                onRetry={retryPending}
                pending={mutationPending}
                label="Retry"
              />
            ) : null
          }
        />
      ) : null}

      {isLive ? (
        <MiniAppPanel
          heading="Mission controls"
          note="Changes apply to the live mission and refresh the pinned Telegram card."
        >
          <div className="flex min-w-0 flex-col gap-2">
            <MiniAppActionButton
              label="Edit targets"
              onPress={openTargetsEditor}
              disabled={mutationPending}
            />
            <MiniAppActionButton
              label="Change end time"
              onPress={openDurationEditor}
              disabled={mutationPending}
              tone="quiet"
            />
          </div>
        </MiniAppPanel>
      ) : null}

      {isLive && editor === "targets" ? (
        <MiniAppEditorShell
          title="Edit targets"
          description={
            panel.controlMode.toUpperCase() === "AUTO"
              ? "Saving switches this mission to MANUAL target control."
              : "Blank supporting fields mean Off."
          }
          onClose={() => setEditor(null)}
        >
          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <p className="text-[12px] text-muted-foreground">Primary goal</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {MINI_APP_PRIMARY_TYPES.map((type) => (
                  <MiniAppChoiceChip
                    key={type}
                    label={MINI_APP_PRIMARY_LABELS[type] ?? type}
                    selected={primaryType === type}
                    onSelect={() => setPrimaryType(type)}
                    disabled={targetsMutation.isPending}
                  />
                ))}
              </div>
            </div>

            <MiniAppFieldRow
              label="Primary target"
              value={primaryDraft}
              onValueChange={setPrimaryDraft}
              placeholder="e.g. 5000"
              disabled={targetsMutation.isPending}
            />

            {pinned ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                The {MINI_APP_METRIC_LABELS[pinned] ?? pinned} supporting target is pinned to the
                primary target by the server, so any value you type for it is replaced.
              </p>
            ) : null}

            {MINI_APP_SUPPORTING_METRICS.map((metric) => (
              <MiniAppFieldRow
                key={metric}
                label={`${MINI_APP_METRIC_LABELS[metric] ?? metric} target`}
                hint={pinned === metric ? "Pinned to the primary target." : "Blank means Off."}
                value={supportDraft[metric]}
                onValueChange={(next) => setSupportDraft((prev) => ({ ...prev, [metric]: next }))}
                placeholder="Off"
                disabled={targetsMutation.isPending}
              />
            ))}

            {formError ? <MiniAppNotice tone="error" message={formError} /> : null}

            <MiniAppActionButton
              label="Save targets"
              pendingLabel="Saving…"
              onPress={submitTargets}
              pending={targetsMutation.isPending}
            />
          </div>
        </MiniAppEditorShell>
      ) : null}

      {isLive && editor === "duration" ? (
        <MiniAppEditorShell
          title="Change end time"
          description="Ends this mission the chosen number of minutes from now."
          onClose={() => setEditor(null)}
        >
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {MINI_APP_DURATION_CHOICES.map((choice) => (
                <MiniAppChoiceChip
                  key={choice.label}
                  label={choice.label}
                  selected={false}
                  onSelect={() => submitDuration(choice.minutes)}
                  disabled={durationMutation.isPending}
                />
              ))}
            </div>

            <MiniAppFieldRow
              label="Custom minutes from now"
              hint={`Between ${MINI_APP_MIN_MINUTES} and ${MINI_APP_MAX_MINUTES} whole minutes.`}
              value={minutesDraft}
              onValueChange={setMinutesDraft}
              placeholder="e.g. 90"
              disabled={durationMutation.isPending}
            />

            {formError ? <MiniAppNotice tone="error" message={formError} /> : null}

            <MiniAppActionButton
              label="Apply end time"
              pendingLabel="Updating…"
              onPress={submitCustomDuration}
              pending={durationMutation.isPending}
            />
          </div>
        </MiniAppEditorShell>
      ) : null}

      <p className="px-1 text-[11px] leading-4 text-muted-foreground">
        Targets and end time can be edited here. Ending or cancelling the mission is still handled
        in the CARTEL HQ Telegram bot.
      </p>
    </MiniAppFrame>
  );
}
