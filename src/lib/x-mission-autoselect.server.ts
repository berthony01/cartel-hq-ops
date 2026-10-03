import { lookupXPostMetrics } from "../../backend-source/edge-functions/_shared/x-metrics";

export async function readMissionSetupMetrics(bearer: string, externalPostId: string) {
  const result = await lookupXPostMetrics(bearer, [externalPostId]);
  if (!result.ok) return { ok: false as const, reason: result.reason };
  const post = result.posts.get(externalPostId);
  if (!post) return { ok: false as const, reason: "No readable metrics were returned." };
  return { ok: true as const, observedAt: result.observedAt, metrics: post.metrics };
}