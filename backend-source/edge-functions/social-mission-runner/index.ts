/**
 * SE-4B — `social-mission-runner`.
 *
 * REPOSITORY SOURCE PARITY COPY. Lovable never deploys this function; the
 * authoritative deployment is performed externally against the Supabase
 * project `ocoinbnjgstkmnwwvnhi` with `verify_jwt=false`.
 *
 * Why verify_jwt=false: this worker is cron-only. It is never called by a
 * browser and carries no user session. Authentication is the dedicated
 * scheduler secret header, compared ONLY inside the database through
 * `social_mission_scheduler_secret_matches`. The secret is never logged and
 * never returned in a response body. This is the same model as the existing
 * `telegram-message-cleanup` worker.
 *
 * Frozen behaviour:
 *   * ZERO X / provider calls. ZERO metric reads. No usage ledger.
 *   * PULSE  — exactly one `sendMessage`, replying to the canonical mission
 *              card, with an OPEN ON X button built from the authoritative
 *              `social_posts.canonical_url`. Never `sendPhoto`, never a
 *              resend of the branded card. A confirmed pulse is queued into
 *              the EXISTING `telegram_message_cleanup_jobs` table with
 *              `cleanup_kind='social_mission_pulse'` and
 *              `delete_after = sent_at + 120 seconds`. The cleanup worker
 *              itself is untouched.
 *   * COMPLETE — the mission is ALREADY COMPLETED in the database by the claim
 *              RPC. This worker then makes exactly ONE idempotent
 *              `edit_mission` call against the existing transport using the
 *              stored `client_request_id`. A failed or ambiguous edit NEVER
 *              reverts completion and NEVER sends a replacement message.
 *   * No retries. An ambiguous outcome is recorded as AMBIGUOUS and is
 *              terminal; losing an ephemeral pulse is safer than duplicate
 *              spam.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  lookupXPostMetrics,
  batchPostIds,
  availabilityOf,
  metricSignature,
  X_PROVIDER,
  X_BATCH_MAX,
  type XCanonicalMetrics,
} from "../_shared/x-metrics.ts";
import {
  refreshBucket,
  normalizePulseDeltas,
  normalizeTierTargets,
  highestTierMet,
  isClosingSoon,
  buildCrossingPulseText,
  MILESTONE_ACTIVE,
  MILESTONE_TRENDING,
  MILESTONE_CLOSING_SOON,
  MILESTONE_COMPLETED,
  MILESTONE_COPY,
  TRENDING_TIER,
  tierKey,
  type PulseCrossing,
} from "../_shared/mission-progress.ts";


/**
 * SE-5 metrics refresh, layered ON TOP of the frozen SE-4B behaviour above.
 *
 * - The ONLY provider contacted is the official X API v2 batch lookup.
 * - Each minute the worker collects LIVE missions, de-duplicates post ids and
 *   issues at most `METRICS_MAX_BATCHES` lookups of at most 100 ids each.
 * - At most ONE snapshot is written per mission per minute bucket.
 * - A Telegram edit happens ONLY when the visible metric signature changed,
 *   so an unchanged minute performs zero Telegram calls.
 * - Pulses still make ZERO provider calls: they read stored snapshots only.
 */
const METRICS_WORKLIST_LIMIT = 300;
const METRICS_MAX_BATCHES = 3;

type MetricsRow = {
  mission_id: string;
  workspace_id: string;
  target_id: string;
  external_post_id: string;
  canonical_url: string | null;
  telegram_chat_id: number;
  telegram_message_id: number | null;
  edit_revision: number;
  edit_state: string;
  mission_created_by: string | null;
  accomplished_at: string | null;
  last_metric_signature: string | null;
  ends_at: string | null;
  x_link_status: string | null;
  highest_tier: number | null;
  group_connection_id: string | null;
  effective_config: Record<string, unknown> | null;
  tier_targets: unknown;
  pulse_deltas: unknown;
};


const SCHEDULER_HEADER = "x-cartel-social-mission-scheduler-secret";
const TELEGRAM_API = "https://api.telegram.org";
const PULSE_LIFETIME_SECONDS = 120;
const CLAIM_LIMIT = 25;
const TELEGRAM_TIMEOUT_MS = 10_000;
const TRANSPORT_TIMEOUT_MS = 20_000;

/** This worker is one of the two exact internal callers of the transport. */
const INTERNAL_SOURCE_HEADER_VALUE = "social-mission-runner";

type ClaimedEvent = {
  event_id: string;
  event_type: "PULSE" | "COMPLETE";
  sequence_no: number;
  workspace_id: string;
  mission_id: string;
  target_id: string;
  client_request_id: string;
  edit_revision: number;
  telegram_chat_id: number;
  telegram_message_id: number | null;
  group_connection_id: string;
  mission_created_by: string | null;
  canonical_url: string | null;
};

type TelegramOutcome =
  | { kind: "ok"; messageId: number | null }
  | { kind: "rejected"; description: string }
  | { kind: "uncertain"; description: string };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Narrow, pure validator. The OPEN ON X button is only ever built from a
 * canonical public X/Twitter status URL. Arbitrary HTTPS links, credentials,
 * explicit ports and non-status paths are all refused, and no network call is
 * made. An invalid URL simply means no button.
 */
const PULSE_X_HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"];

export function isCanonicalXStatusUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.port) return false;
  if (!PULSE_X_HOSTS.includes(url.hostname.toLowerCase())) return false;
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 3) return false;
  const handle = String(segments[0]).toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle) || handle === "i") return false;
  if (String(segments[1]).toLowerCase() !== "status") return false;
  return /^[0-9]{1,32}$/.test(String(segments[2]));
}

/**
 * Pulse copy. Short, factual, and about natural participation only. No
 * quotas, points, rewards, streaks, counts or mandatory likes/reposts, and no
 * claim about what the post will do.
 */
export const PULSE_TEXT =
  "This Social Mission is still active. Read the official post above and join the conversation naturally if you have something to add.";

export const PULSE_ACCOMPLISHED_TEXT =
  "This Social Mission has hit its milestone and is still open. Read the official post above and join the conversation naturally if you have something to add.";

/**
 * SE-5 Pulse 2.0 — the pulse may quote the LATEST STORED snapshot, but it
 * performs ZERO provider reads of its own. Unknown metrics are omitted, never
 * printed as 0, and the line is dropped entirely when nothing is known.
 */
export function pulseMetricLine(metrics: XCanonicalMetrics | null): string | null {
  if (!metrics) return null;
  const parts: string[] = [];
  if (metrics.views !== null) parts.push(`${metrics.views} views`);
  if (metrics.likes !== null) parts.push(`${metrics.likes} likes`);
  if (metrics.comments !== null) parts.push(`${metrics.comments} replies`);
  if (metrics.shares !== null) parts.push(`${metrics.shares} reposts`);
  if (parts.length === 0) return null;
  return `Last observed: ${parts.join(" · ")}.`;
}

export function buildPulseText(
  metrics: XCanonicalMetrics | null,
  accomplished: boolean,
): string {
  const head = accomplished ? PULSE_ACCOMPLISHED_TEXT : PULSE_TEXT;
  const line = pulseMetricLine(metrics);
  return line ? `${head}\n\n${line}` : head;
}

export function pulseKeyboard(canonicalUrl: unknown) {
  return isCanonicalXStatusUrl(canonicalUrl)
    ? { inline_keyboard: [[{ text: "OPEN ON X", url: String(canonicalUrl).trim() }]] }
    : null;
}

async function callTelegram(
  botToken: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramOutcome> {
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
  } catch {
    // Transport-level uncertainty: Telegram may or may not have acted.
    return { kind: "uncertain", description: "Telegram did not answer in time." };
  }

  // 429 and 5xx are never definite: the message may still have been delivered.
  if (response.status === 429 || response.status >= 500) {
    return { kind: "uncertain", description: `Telegram responded ${response.status}.` };
  }

  let body: { ok?: boolean; description?: string; result?: { message_id?: number } } | null = null;
  try {
    body = await response.json();
  } catch {
    return { kind: "uncertain", description: "Telegram returned an unreadable response." };
  }

  if (body?.ok === true) {
    const messageId = typeof body.result?.message_id === "number" ? body.result.message_id : null;
    return { kind: "ok", messageId };
  }
  if (body?.ok === false) {
    return { kind: "rejected", description: String(body.description ?? "Telegram rejected the request.") };
  }
  return { kind: "uncertain", description: "Telegram returned an inconclusive response." };
}

/** One idempotent same-message edit through the existing transport. */
async function requestCardEdit(args: {
  supabaseUrl: string;
  serviceKey: string;
  workspaceId: string;
  missionId: string;
  targetId: string;
  actorUserId: string;
  clientRequestId: string;
  revision: number;
}): Promise<string> {
  try {
    const response = await fetch(
      `${args.supabaseUrl.replace(/\/$/, "")}/functions/v1/social-mission-telegram`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: args.serviceKey,
          Authorization: `Bearer ${args.serviceKey}`,
          "X-Cartel-Internal-Source": INTERNAL_SOURCE_HEADER_VALUE,
          "X-Cartel-Actor-User-Id": args.actorUserId,
        },
        body: JSON.stringify({
          action: "edit_mission",
          workspaceId: args.workspaceId,
          missionId: args.missionId,
          targetId: args.targetId,
          clientRequestId: args.clientRequestId,
          revision: args.revision,
        }),
        signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
      },
    );
    const body = (await response.json().catch(() => null)) as { editState?: string } | null;
    return String(body?.editState ?? "");
  } catch {
    return "";
  }
}

/** SE-6 — one ephemeral group message, replying to the canonical card. */
async function sendEphemeralMissionMessage(
  admin: ReturnType<typeof createClient>,
  botToken: string,
  row: { workspace_id: string; group_connection_id: string | null; telegram_chat_id: number; telegram_message_id: number | null; canonical_url: string | null },
  text: string,
): Promise<boolean> {
  if (row.telegram_message_id === null) return false;
  const keyboard = pulseKeyboard(row.canonical_url);
  const outcome = await callTelegram(botToken, "sendMessage", {
    chat_id: row.telegram_chat_id,
    text,
    reply_to_message_id: row.telegram_message_id,
    disable_web_page_preview: true,
    disable_notification: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
  if (outcome.kind !== "ok" || outcome.messageId === null) return false;

  const deleteAfter = new Date(Date.now() + PULSE_LIFETIME_SECONDS * 1000).toISOString();
  const { error } = await admin.from("telegram_message_cleanup_jobs").insert({
    workspace_id: row.workspace_id,
    group_connection_id: row.group_connection_id,
    telegram_chat_id: row.telegram_chat_id,
    telegram_message_id: outcome.messageId,
    cleanup_kind: "social_mission_pulse",
    delete_after: deleteAfter,
    next_attempt_at: deleteAfter,
  });
  if (error) {
    await callTelegram(botToken, "deleteMessage", {
      chat_id: row.telegram_chat_id,
      message_id: outcome.messageId,
    });
  }
  return true;
}

/**
 * SE-6 metrics phase. Never throws, and a failure here must not prevent the
 * SE-4B pulse/completion phase from running.
 *
 * Requirement 2: the work list already excludes any mission that has a
 * snapshot in the current FIVE-MINUTE bucket, so this is the single
 * centralized reader and a viewer can never cause an extra X call.
 * Requirement 4: pulses come from threshold crossings evaluated atomically in
 * the database, combined into ONE message.
 * Requirement 5: milestones are recorded through an idempotent RPC and only
 * announced the first time they are entered.
 * Requirement 8: a post the official API cannot resolve is marked
 * UNAVAILABLE; the mission keeps running.
 */
async function runMetricsRefresh(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  botToken: string,
): Promise<{
  missions: number;
  lookups: number;
  snapshots: number;
  cardsEdited: number;
  pulses: number;
  milestones: number;
  unavailable: number;
}> {
  const stats = {
    missions: 0,
    lookups: 0,
    snapshots: 0,
    cardsEdited: 0,
    pulses: 0,
    milestones: 0,
    unavailable: 0,
  };
  const bearer = Deno.env.get("X_API_BEARER_TOKEN") ?? "";
  if (!bearer) return stats;

  const bucket = refreshBucket();
  const { data, error } = await admin.rpc("list_social_missions_due_for_metrics", {
    _bucket: bucket,
    _limit: METRICS_WORKLIST_LIMIT,
  });
  if (error) return stats;
  const rows = ((data ?? []) as MetricsRow[]).filter(
    (row) => typeof row.external_post_id === "string" && row.telegram_message_id !== null,
  );
  stats.missions = rows.length;
  if (rows.length === 0) return stats;

  // De-duplicate ids across missions, then look them up in batches of <= 100.
  const batches = batchPostIds(rows.map((row) => row.external_post_id), X_BATCH_MAX).slice(
    0,
    METRICS_MAX_BATCHES,
  );
  const found = new Map<string, { metrics: XCanonicalMetrics; observedAt: string }>();
  let anyLookupOk = false;
  for (const batch of batches) {
    const read = await lookupXPostMetrics(bearer, batch);
    stats.lookups += 1;
    if (!read.ok) continue; // No snapshot, no synthetic zeroes, no retry.
    anyLookupOk = true;
    for (const [id, post] of read.posts) {
      found.set(id, { metrics: post.metrics, observedAt: read.observedAt });
    }
  }
  if (!anyLookupOk) return stats; // Provider outage: link status is left alone.

  for (const row of rows) {
    const hit = found.get(row.external_post_id);

    // Requirement 8 — the lookup worked but this post was not returned: it was
    // deleted or is no longer visible. The mission lifecycle continues.
    if (!hit) {
      if (row.x_link_status !== "UNAVAILABLE") {
        await admin.rpc("record_social_mission_link_status", {
          _mission_id: row.mission_id,
          _status: "UNAVAILABLE",
        });
      }
      stats.unavailable += 1;
      continue;
    }
    if (row.x_link_status !== "OK") {
      await admin.rpc("record_social_mission_link_status", {
        _mission_id: row.mission_id,
        _status: "OK",
      });
    }

    const recorded = await admin.rpc("record_social_mission_metric_snapshot", {
      _mission_id: row.mission_id,
      _provider: X_PROVIDER,
      _observed_at: hit.observedAt,
      // Requirement 2/3 — five-minute resolution, one snapshot per window.
      _poll_bucket: bucket,
      _views: hit.metrics.views,
      _likes: hit.metrics.likes,
      _comments: hit.metrics.comments,
      _shares: hit.metrics.shares,
      _saves: hit.metrics.saves,
      _availability: availabilityOf(hit.metrics),
      _metadata: { phase: "SE-6", source: "mission_runner", bucket },
    });
    if (recorded.error) continue;
    stats.snapshots += 1;

    const result = (recorded.data ?? {}) as { accomplished_at?: string | null };
    const accomplished =
      typeof result.accomplished_at === "string" || typeof row.accomplished_at === "string";

    // ---- Requirement 5: idempotent milestones -----------------------------
    const announce: string[] = [];
    const mark = async (key: string, tier: number | null) => {
      const { data: first, error: milestoneError } = await admin.rpc(
        "record_social_mission_milestone",
        {
          _mission_id: row.mission_id,
          _workspace_id: row.workspace_id,
          _milestone_key: key,
          _tier: tier,
          _metadata: { bucket },
        },
      );
      if (milestoneError || first !== true) return;
      stats.milestones += 1;
      announce.push(tier === null ? (MILESTONE_COPY[key] ?? key) : `Tier ${tier} reached.`);
    };

    await mark(MILESTONE_ACTIVE, null);

    const targets = normalizeTierTargets(row.tier_targets);
    const tier = highestTierMet(hit.metrics, targets);
    for (let t = Math.max(1, Number(row.highest_tier ?? 0) + 1); t <= tier; t += 1) {
      await mark(tierKey(t), t);
    }
    if (tier >= TRENDING_TIER) await mark(MILESTONE_TRENDING, null);
    if (isClosingSoon(row.ends_at)) await mark(MILESTONE_CLOSING_SOON, null);

    // ---- Requirement 4: crossing-driven pulse -----------------------------
    const deltas = normalizePulseDeltas(row.pulse_deltas);
    const { data: pulse, error: pulseError } = await admin.rpc("evaluate_social_mission_pulse", {
      _mission_id: row.mission_id,
      _workspace_id: row.workspace_id,
      _views: hit.metrics.views,
      _likes: hit.metrics.likes,
      _shares: hit.metrics.shares,
      _comments: hit.metrics.comments,
      _delta_views: deltas.views,
      _delta_likes: deltas.likes,
      _delta_shares: deltas.shares,
      _delta_comments: deltas.comments,
    });
    const crossings = (!pulseError && (pulse as { crossings?: PulseCrossing[] } | null)?.crossings) || [];
    const crossingLine = buildCrossingPulseText(crossings);

    // ONE combined ephemeral message covering crossings and new milestones.
    const body = [crossingLine, ...announce].filter(Boolean).join(" ");
    if (body) {
      const sent = await sendEphemeralMissionMessage(admin, botToken, row, `${PULSE_TEXT}\n\n${body}`);
      if (sent) stats.pulses += 1;
    }

    // ---- Requirement 3: same canonical card, edited in place --------------
    const signature = metricSignature(hit.metrics, { accomplished, missionStatus: "LIVE" });
    if (signature === row.last_metric_signature) continue; // Nothing visible changed.
    if (!row.mission_created_by) continue;

    // Atomic compare-and-set, so two overlapping invocations cannot both edit.
    const claim = await admin.rpc("claim_social_mission_card_refresh", {
      _target_id: row.target_id,
      _signature: signature,
    });
    if (claim.error || claim.data !== true) continue;

    const editState = await requestCardEdit({
      supabaseUrl,
      serviceKey,
      workspaceId: row.workspace_id,
      missionId: row.mission_id,
      targetId: row.target_id,
      actorUserId: row.mission_created_by,
      // Deterministic per target+signature: a replay can never double-edit.
      clientRequestId: `se5-metrics:${row.target_id}:${signature}`,
      revision: Number(row.edit_revision ?? 0) + 1,
    });
    if (editState === "EDITED") stats.cardsEdited += 1;
    // FAILED / AMBIGUOUS / empty: never retried inside this invocation.
  }

  return stats;
}



Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !BOT_TOKEN) {
    return json({ error: "Runner is not configured." }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // The secret is compared only inside the database and never echoed back.
  const presented = request.headers.get(SCHEDULER_HEADER) ?? "";
  const { data: secretOk, error: secretError } = await admin.rpc(
    "social_mission_scheduler_secret_matches",
    { p_secret: presented },
  );
  if (secretError || secretOk !== true) {
    return json({ error: "Unauthorized" }, 401);
  }

  // SE-5 metrics phase first, so a pulse in this same invocation can quote the
  // freshest STORED snapshot without performing any provider call of its own.
  const metrics = await runMetricsRefresh(admin, SUPABASE_URL, SERVICE_KEY, BOT_TOKEN).catch(
    () => ({
      missions: 0,
      lookups: 0,
      snapshots: 0,
      cardsEdited: 0,
      pulses: 0,
      milestones: 0,
      unavailable: 0,
    }),
  );


  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_due_social_mission_schedule_events",
    { _limit: CLAIM_LIMIT },
  );
  if (claimError) {
    return json({ error: "Could not claim due schedule events." }, 500);
  }

  const events = (claimed ?? []) as ClaimedEvent[];
  let pulsesSent = 0;
  let completionsEdited = 0;
  let unresolved = 0;
  let failed = 0;

  for (const event of events) {
    if (event.event_type === "PULSE") {
      if (event.telegram_message_id === null) {
        await admin.rpc("finish_social_mission_schedule_event", {
          _event_id: event.event_id,
          _state: "FAILED",
          _telegram_message_id: null,
          _last_error: "The canonical mission message id is missing.",
        });
        failed += 1;
        continue;
      }

      const keyboard = pulseKeyboard(event.canonical_url);

      // SE-5 Pulse 2.0: STORED snapshot only. Zero provider calls here.
      const { data: storedSnapshot } = await admin
        .from("social_metric_snapshots")
        .select("views, likes, comments, shares, saves")
        .eq("mission_id", event.mission_id)
        .eq("workspace_id", event.workspace_id)
        .order("observed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: missionRow } = await admin
        .from("social_missions")
        .select("accomplished_at")
        .eq("id", event.mission_id)
        .maybeSingle();
      const storedMetrics = storedSnapshot
        ? ({
            views: (storedSnapshot as Record<string, number | null>)["views"] ?? null,
            likes: (storedSnapshot as Record<string, number | null>)["likes"] ?? null,
            comments: (storedSnapshot as Record<string, number | null>)["comments"] ?? null,
            shares: (storedSnapshot as Record<string, number | null>)["shares"] ?? null,
            saves: (storedSnapshot as Record<string, number | null>)["saves"] ?? null,
          } as XCanonicalMetrics)
        : null;
      const pulseAccomplished =
        typeof (missionRow as Record<string, unknown> | null)?.["accomplished_at"] === "string";

      // Exactly ONE sendMessage. Never sendPhoto, never the branded card.
      const outcome = await callTelegram(BOT_TOKEN, "sendMessage", {
        chat_id: event.telegram_chat_id,
        text: buildPulseText(storedMetrics, pulseAccomplished),
        // No allow_sending_without_reply: a pulse is meaningful ONLY as a
        // reply to the canonical mission card. If that card is gone, Telegram
        // rejects the send and the event is finalized FAILED rather than
        // posting an orphan reminder.
        reply_to_message_id: event.telegram_message_id,
        disable_web_page_preview: true,
        disable_notification: true,
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });

      if (outcome.kind === "ok" && outcome.messageId !== null) {
        const deleteAfter = new Date(Date.now() + PULSE_LIFETIME_SECONDS * 1000).toISOString();
        const { error: cleanupError } = await admin.from("telegram_message_cleanup_jobs").insert({
          workspace_id: event.workspace_id,
          group_connection_id: event.group_connection_id,
          telegram_chat_id: event.telegram_chat_id,
          telegram_message_id: outcome.messageId,
          cleanup_kind: "social_mission_pulse",
          delete_after: deleteAfter,
          next_attempt_at: deleteAfter,
        });

        if (cleanupError) {
          // A pulse with no durable expiry path is removed immediately. One
          // attempt only, and never a replacement message.
          await callTelegram(BOT_TOKEN, "deleteMessage", {
            chat_id: event.telegram_chat_id,
            message_id: outcome.messageId,
          });
        }

        await admin.rpc("finish_social_mission_schedule_event", {
          _event_id: event.event_id,
          _state: "SENT",
          _telegram_message_id: outcome.messageId,
          _last_error: cleanupError ? "Pulse cleanup could not be scheduled; the pulse was deleted." : null,
        });
        pulsesSent += 1;
        continue;
      }

      if (outcome.kind === "rejected") {
        await admin.rpc("finish_social_mission_schedule_event", {
          _event_id: event.event_id,
          _state: "FAILED",
          _telegram_message_id: null,
          _last_error: outcome.description.slice(0, 1000),
        });
        failed += 1;
        continue;
      }

      // Uncertain, or an ok response with no message id: never retried.
      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "AMBIGUOUS",
        _telegram_message_id: null,
        _last_error: (outcome.kind === "uncertain" ? outcome.description : "Telegram confirmed no message id.").slice(0, 1000),
      });
      unresolved += 1;
      continue;
    }

    // COMPLETE. The mission is ALREADY COMPLETED in the database; this is the
    // single same-message edit attempt and it can never revert completion.

    // Requirement 5/7 — both idempotent, and both independent of whether the
    // Telegram edit below succeeds.
    await admin.rpc("record_social_mission_milestone", {
      _mission_id: event.mission_id,
      _workspace_id: event.workspace_id,
      _milestone_key: MILESTONE_COMPLETED,
      _tier: null,
      _metadata: { source: "schedule_complete" },
    });
    await admin.rpc("finalize_social_mission_performance", { _mission_id: event.mission_id });

    if (!event.mission_created_by || event.telegram_message_id === null) {

      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "FAILED",
        _telegram_message_id: null,
        _last_error: "The completion edit has no actor or no canonical message.",
      });
      failed += 1;
      continue;
    }

    let transport: { editState?: string; message?: string } | null = null;
    let transportStatus = 0;
    try {
      const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/social-mission-telegram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "X-Cartel-Internal-Source": INTERNAL_SOURCE_HEADER_VALUE,
          "X-Cartel-Actor-User-Id": event.mission_created_by,
        },
        body: JSON.stringify({
          action: "edit_mission",
          workspaceId: event.workspace_id,
          missionId: event.mission_id,
          targetId: event.target_id,
          clientRequestId: event.client_request_id,
          revision: Number(event.edit_revision ?? 0) + 1,
        }),
        signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
      });
      transportStatus = response.status;
      transport = (await response.json().catch(() => null)) as typeof transport;
    } catch {
      transport = null;
    }

    const editState = String(transport?.editState ?? "");
    if (editState === "EDITED") {
      // A duplicate request id replays the recorded EDITED outcome: success.
      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "SENT",
        _telegram_message_id: null,
        _last_error: null,
      });
      completionsEdited += 1;
      continue;
    }

    if (editState === "FAILED") {
      await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: event.event_id,
        _state: "FAILED",
        _telegram_message_id: null,
        _last_error: String(transport?.message ?? "The completion edit was rejected.").slice(0, 1000),
      });
      failed += 1;
      continue;
    }

    await admin.rpc("finish_social_mission_schedule_event", {
      _event_id: event.event_id,
      _state: "AMBIGUOUS",
      _telegram_message_id: null,
      _last_error: String(
        transport?.message ?? `The completion edit is unresolved (status ${transportStatus}).`,
      ).slice(0, 1000),
    });
    unresolved += 1;
  }

  return json({
    ok: true,
    claimed: events.length,
    pulsesSent,
    completionsEdited,
    unresolved,
    failed,
    metrics,
  });
});
