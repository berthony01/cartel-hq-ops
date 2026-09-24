/**
 * SE-2 — authenticated, operator-gated social READ boundary.
 *
 * This is the ONLY way app code may reach a social read provider. It follows the
 * PCART-L1B treasury-verification precedent: `createServerFn` +
 * `requireSupabaseAuth`, secrets read server-side only, zero persistence.
 *
 * Guarantees:
 * - Caller must be authenticated AND a workspace operator (owner/admin) of the
 *   workspace named in the request, matching the SE-1 write boundary.
 * - No Supabase write of any kind: no social table write, no usage_ledger write,
 *   no RPC write. The only database call is the operator authorization check.
 * - No cron, no scheduler, no background job, no automatic polling. Nothing runs
 *   unless this function is explicitly invoked.
 * - Only a normalized `ProviderResult` crosses the boundary. Raw provider
 *   payloads, the upstream URL and the API key never leave the server.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  providerFailure,
  type NormalizedMetricsObservation,
  type NormalizedPost,
  type NormalizedSourceRecentPosts,
  type ProviderResult,
  type SocialReadCapability,
} from "./social-read-provider";

const PROVIDER_ID_FOR_REFUSAL = "none";
const PROJECT_IDENTITY_REQUIRED_MESSAGE =
  "Create Project Identity first. Token launch is not required.";

export type SocialReadInput = {
  workspaceId: string;
  operation: SocialReadCapability;
  url: string;
  limit?: number;
};

export type SocialReadOutcome =
  | ({ operation: "post" } & ProviderResult<NormalizedPost>)
  | ({ operation: "metrics" } & ProviderResult<NormalizedMetricsObservation>)
  | ({ operation: "source_recent_posts" } & ProviderResult<NormalizedSourceRecentPosts>);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function commercialDenialMessage(reason: unknown): string {
  const r = typeof reason === "string" ? reason : "";
  if (r === "PLAN_LIMIT_REACHED") return "Monthly plan limit reached.";
  if (r === "FEATURE_NOT_INCLUDED") return "This feature is not included in the current plan.";
  if (r.startsWith("ASSIGNMENT_")) return "Plan access is not active.";
  return "This action is not available for this workspace.";
}

function refusal(operation: SocialReadCapability, code: "INVALID_URL" | "UNKNOWN", message: string) {
  return {
    operation,
    ...providerFailure<never>(PROVIDER_ID_FOR_REFUSAL, code, message),
  } as SocialReadOutcome;
}

export const socialRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SocialReadInput) => ({
    workspaceId: String(input?.workspaceId ?? "").trim(),
    operation: String(input?.operation ?? "") as SocialReadCapability,
    url: String(input?.url ?? "").trim(),
    limit: typeof input?.limit === "number" ? input.limit : undefined,
  }))
  .handler(async ({ data, context }): Promise<SocialReadOutcome> => {
    const operation = data.operation;
    if (operation !== "post" && operation !== "metrics" && operation !== "source_recent_posts") {
      return refusal("post", "UNKNOWN", "That is not a supported social read operation.");
    }
    if (!UUID_RE.test(data.workspaceId)) {
      return refusal(operation, "UNKNOWN", "That workspace reference is not usable.");
    }
    if (!data.url) {
      return refusal(operation, "INVALID_URL", "A public social link is required.");
    }

    // Authorization before any external provider call. Read-only RPC.
    const { data: isOperator, error } = await context.supabase.rpc("is_workspace_operator", {
      _workspace_id: data.workspaceId,
      _user_id: context.userId,
    });
    if (error || isOperator !== true) {
      return refusal(
        operation,
        "UNKNOWN",
        "Only a workspace owner or admin can read social data for this workspace.",
      );
    }

    // Project Identity Gate B — after operator authorization, before any paid
    // provider call. One authority (can_use_project_tools); fails closed.
    const { data: canUseTools, error: identityError } = await context.supabase.rpc(
      "can_use_project_tools",
      { _workspace_id: data.workspaceId, _user_id: context.userId },
    );
    if (identityError || canUseTools !== true) {
      return refusal(operation, "UNKNOWN", PROJECT_IDENTITY_REQUIRED_MESSAGE);
    }

    // Commercial Foundation B — x_reads after identity, before any paid provider
    // call. Single authority (evaluate_commercial_access); fails closed.
    const { data: commercial, error: commercialError } = await context.supabase.rpc(
      "evaluate_commercial_access",
      { _workspace_id: data.workspaceId, _feature_key: "x_reads", _user_id: context.userId },
    );
    const commercialResult = commercial as { allowed?: unknown; reason?: unknown } | null;
    if (commercialError || !commercialResult || typeof commercialResult !== "object") {
      return refusal(operation, "UNKNOWN", "Plan access could not be verified. Try again.");
    }
    if (commercialResult.allowed !== true) {
      return refusal(operation, "UNKNOWN", commercialDenialMessage(commercialResult.reason));
    }

    // Server-only import: keeps every provider adapter out of client bundles.
    // SE-2.1: the direct-first router is the only provider entry point.
    const { socialReadRouter } = await import("./social-read-router.server");

    if (operation === "post") {
      return { operation, ...(await socialReadRouter.fetchPostByUrl({ url: data.url })) };
    }
    if (operation === "metrics") {
      return { operation, ...(await socialReadRouter.fetchPostMetrics({ url: data.url })) };
    }
    return {
      operation,
      ...(await socialReadRouter.fetchSourceRecentPosts({
        url: data.url,
        ...(data.limit === undefined ? {} : { limit: data.limit }),
      })),
    };
  });
