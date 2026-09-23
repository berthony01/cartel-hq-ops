/**
 * SE-3.2A — owner/admin-only, single-fixture metric capture for the pinned
 * PEPE CARTEL Social Mission live test.
 *
 * Scope guarantees (frozen for SE-3.2A):
 * - The browser supplies NOTHING. The fixture marker, the exact canonical X
 *   URL and the exact Telegram group title are hard-pinned in this module, so
 *   this path cannot be repurposed from the client into a generic social read
 *   or a generic snapshot writer.
 * - Authorization runs BEFORE any provider call and BEFORE any service-role
 *   write: `requireSupabaseAuth` for identity, then the existing
 *   `is_workspace_operator` RPC for the fixture's own workspace.
 * - Exactly ONE official-X metrics read through the existing direct-first
 *   `socialReadRouter`. No retry, no polling, no second provider call.
 * - On provider failure: sanitized error, NO snapshot insert, and the caller
 *   must not edit Telegram.
 * - Exactly ONE `social_metric_snapshots` insert on success. Null stays null;
 *   no metric is coerced to zero. No `usage_ledger` write. No Telegram call
 *   from this module.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MetricAvailability, NormalizedMetrics } from "./social-read-provider";

/** The ONLY fixture this path will ever operate on. */
export const METRIC_CAPTURE_MARKER = "pepe_cartel_community_v1";
export const METRIC_CAPTURE_CANONICAL_URL =
  "https://x.com/PEPECARTELTOKEN/status/2098827349470961903";
export const METRIC_CAPTURE_GROUP_TITLE = "PEPE CARTEL COMMUNITY";
export const METRIC_CAPTURE_MISSION_STATUS = "LIVE";
export const METRIC_CAPTURE_DELIVERY_STATE = "SENT";

export type CaptureMissionMetricsResult =
  | {
      ok: true;
      workspaceId: string;
      missionId: string;
      targetId: string;
      /** Current authoritative revision. The caller edits with revision + 1. */
      editRevision: number;
      provider: string;
      observedAt: string;
      pollBucket: string;
      metrics: NormalizedMetrics;
      availability: MetricAvailability;
      snapshotId: string;
    }
  | { ok: false; reason: string };

function failure(reason: string): CaptureMissionMetricsResult {
  return { ok: false, reason };
}

/** Deterministic minute bucket, so a double click cannot create two rows. */
function minuteBucket(observedAt: string): string {
  const d = new Date(observedAt);
  const ms = Number.isNaN(d.getTime()) ? Date.now() : d.getTime();
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

export const captureMissionMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CaptureMissionMetricsResult> => {
    // 1. Fixture discovery under the caller's own RLS.
    const missions = await context.supabase
      .from("social_missions")
      .select("id, workspace_id, status, social_post_id")
      .contains("metadata", { owner_test_control: METRIC_CAPTURE_MARKER })
      .limit(5);
    if (missions.error) return failure("The prepared mission fixture could not be read.");
    const missionRows = missions.data ?? [];
    if (missionRows.length !== 1) {
      return failure("Exactly one prepared mission must carry the test marker.");
    }
    const mission = missionRows[0]!;
    if (mission.status !== METRIC_CAPTURE_MISSION_STATUS) {
      return failure("The prepared mission is not LIVE.");
    }

    // 2. Authorization before any provider call and before any privileged write.
    const { data: isOperator, error: authError } = await context.supabase.rpc(
      "is_workspace_operator",
      { _workspace_id: mission.workspace_id, _user_id: context.userId },
    );
    if (authError || isOperator !== true) {
      return failure("Only a workspace owner or admin can run this test capture.");
    }

    // Project Identity Gate B — after operator authorization, before the paid
    // X read. Owner bypass lives only inside can_use_project_tools; fails closed.
    const { data: canUseTools, error: identityError } = await context.supabase.rpc(
      "can_use_project_tools",
      { _workspace_id: mission.workspace_id, _user_id: context.userId },
    );
    if (identityError || canUseTools !== true) {
      return failure("Create Project Identity first. Token launch is not required.");
    }


    // 3. Exact fixture binding: pinned post URL, single SENT target, pinned group.
    const post = await context.supabase
      .from("social_posts")
      .select("id, canonical_url")
      .eq("id", mission.social_post_id)
      .maybeSingle();
    if (post.error || !post.data) return failure("The bound social post could not be read.");
    if (post.data.canonical_url !== METRIC_CAPTURE_CANONICAL_URL) {
      return failure("The bound post is not the pinned PEPE CARTEL post.");
    }

    const targets = await context.supabase
      .from("social_mission_targets")
      .select(
        "id, workspace_id, delivery_state, edit_revision, edit_state, group_connection_id, telegram_message_id",
      )
      .eq("mission_id", mission.id)
      .limit(5);
    if (targets.error) return failure("The bound mission target could not be read.");
    const targetRows = targets.data ?? [];
    if (targetRows.length !== 1) {
      return failure("The prepared mission must have exactly one target.");
    }
    const target = targetRows[0]!;
    if (target.workspace_id !== mission.workspace_id) {
      return failure("The target does not belong to the mission workspace.");
    }
    if (target.delivery_state !== METRIC_CAPTURE_DELIVERY_STATE) {
      return failure("The pinned card has not been confirmed as SENT.");
    }
    if (!target.telegram_message_id) {
      return failure("The pinned card has no confirmed Telegram message id.");
    }
    if (!target.group_connection_id) {
      return failure("The target is not bound to a Telegram group connection.");
    }

    const group = await context.supabase
      .from("telegram_group_connections")
      .select("id, title")
      .eq("id", target.group_connection_id)
      .maybeSingle();
    if (group.error || !group.data) return failure("The bound Telegram group could not be read.");
    if (group.data.title !== METRIC_CAPTURE_GROUP_TITLE) {
      return failure("The bound Telegram group is not the pinned community.");
    }

    // 4. Exactly one official-X read through the existing direct-first router.
    const { socialReadRouter } = await import("./social-read-router.server");
    const read = await socialReadRouter.fetchPostMetrics({ url: METRIC_CAPTURE_CANONICAL_URL });
    if (!read.ok) {
      return failure(read.error.message || "The official X read did not return metrics.");
    }

    // 5. Exactly one snapshot insert, service role, after authorization.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pollBucket = minuteBucket(read.observedAt);
    const inserted = await supabaseAdmin
      .from("social_metric_snapshots")
      .insert({
        mission_id: mission.id,
        workspace_id: mission.workspace_id,
        provider: read.provider,
        observed_at: read.observedAt,
        poll_bucket: pollBucket,
        views: read.data.metrics.views,
        likes: read.data.metrics.likes,
        comments: read.data.metrics.comments,
        shares: read.data.metrics.shares,
        saves: read.data.metrics.saves,
        availability: read.data.availability,
        metadata: { owner_test_control: METRIC_CAPTURE_MARKER, phase: "SE-3.2A" },
      })
      .select("id")
      .maybeSingle();
    if (inserted.error || !inserted.data) {
      return failure("The metric snapshot was not stored, so the card was not updated.");
    }

    return {
      ok: true,
      workspaceId: mission.workspace_id,
      missionId: mission.id,
      targetId: target.id,
      editRevision: target.edit_revision,
      provider: read.provider,
      observedAt: read.observedAt,
      pollBucket,
      metrics: read.data.metrics,
      availability: read.data.availability,
      snapshotId: inserted.data.id,
    };
  });
