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
