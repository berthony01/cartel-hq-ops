/**
 * Versioned policy acceptance client (Phase 1B-1).
 * Backed by staged RPCs in docs/sql/PARTNER_1B_1_policy_acceptance.sql
 * (NOT APPLIED). Until applied, the RPCs do not exist: every read fails
 * closed to "no active policy" (documents render as DRAFT — NOT EFFECTIVE)
 * and nothing is recorded. Records: user (server auth.uid()), document
 * type, version, content hash, server timestamp, source. Never IP.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PolicyType } from "@/lib/legal-policies";

export type ActivePolicy = { document_type: PolicyType; version: number; content_hash: string };
export type AcceptanceSource = "signup" | "checkout" | "prompt";

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = supabase.rpc.bind(supabase) as unknown as LooseRpc;

export const policyKeys = {
  active: () => ["policies", "active"] as const,
  pending: (userId: string | null) => ["policies", "pending", userId ?? "anon"] as const,
};

function asPolicies(data: unknown): ActivePolicy[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (r): r is ActivePolicy =>
      !!r && typeof r === "object" &&
      typeof (r as ActivePolicy).document_type === "string" &&
      Number.isInteger((r as ActivePolicy).version) &&
      /^[0-9a-f]{64}$/.test(String((r as ActivePolicy).content_hash)),
  );
}

/** Fail closed: any error => [] (no effective policy). */
export async function fetchActivePolicies(): Promise<ActivePolicy[]> {
  try {
    const { data, error } = await rpc("get_active_policy_versions");
    return error ? [] : asPolicies(data);
  } catch {
    return [];
  }
}

/** Effective versions the current user has not accepted. Error => []. */
export async function fetchPendingAcceptances(): Promise<ActivePolicy[]> {
  try {
    const { data, error } = await rpc("get_my_pending_policy_acceptances");
    return error ? [] : asPolicies(data);
  } catch {
    return [];
  }
}

/** Records acceptance of exact version+hash pairs. Throws on failure. */
export async function recordAcceptances(policies: ActivePolicy[], source: AcceptanceSource): Promise<void> {
  if (policies.length === 0) return;
  const { error } = await rpc("record_policy_acceptances", {
    _acceptances: policies.map((p) => ({ document_type: p.document_type, version: p.version, content_hash: p.content_hash })),
    _source: source,
  });
  if (error) throw new Error("Could not record policy acceptance.");
}
