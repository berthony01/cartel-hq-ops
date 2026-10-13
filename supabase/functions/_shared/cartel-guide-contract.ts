/**
 * CARTEL HQ — Conversational Guide (G2A.1) request contract.
 *
 * Pure TypeScript: no network, no Deno APIs, no secrets, no provider code.
 * The Edge entry injects auth/membership/flag dependencies so this logic is
 * testable offline.
 *
 * Invariants:
 *  - POST only. Body accepts ONLY { question, selectedWorkspaceId, requestId? }.
 *    Any other key (userId, owner flags, role, context, articles, prompt...) is
 *    rejected, never ignored.
 *  - Identity comes only from the verified Supabase JWT (auth.getUser).
 *  - Workspace access = current workspace_members row for the verified user.
 *    Managed Service Partner access is NOT membership and is denied in G2A.1.
 *  - Default OFF: an authorized request still returns 503 GUIDE_NOT_ENABLED
 *    unless the server flag is exactly enabled. G2A.1 has NO provider path:
 *    even when "enabled" it returns 503 GUIDE_PROVIDER_NOT_CONFIGURED.
 *  - Never logs or echoes the question. Every response is no-store.
 */

export const GUIDE_QUESTION_MAX_CHARS = 500;
export const GUIDE_QUESTION_MIN_CHARS = 2;
export const GUIDE_BODY_MAX_BYTES = 2048;
export const GUIDE_ALLOWED_KEYS = ["question", "selectedWorkspaceId", "requestId"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Control chars except tab/newline/carriage return.
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

export type GuideErrorCode =
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "MALFORMED_JSON"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "MANAGED_ACCESS_NOT_SUPPORTED"
  | "GUIDE_NOT_ENABLED"
  | "GUIDE_PROVIDER_NOT_CONFIGURED"
  | "INTERNAL_ERROR";

export type GuideResponse = {
  status: number;
  body: { error: GuideErrorCode; code: GuideErrorCode; message: string; requestId?: string };
};

export type GuideRequest = { question: string; selectedWorkspaceId: string; requestId?: string };

export const NO_STORE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function err(status: number, code: GuideErrorCode, message: string, requestId?: string): GuideResponse {
  return { status, body: { error: code, code, message, ...(requestId ? { requestId } : {}) } };
}

/** Parse + validate the untrusted body. Never returns question text in errors. */
export function parseGuideRequest(raw: string):
  | { ok: true; value: GuideRequest }
  | { ok: false; response: GuideResponse } {
  if (new TextEncoder().encode(raw).length > GUIDE_BODY_MAX_BYTES)
    return { ok: false, response: err(413, "PAYLOAD_TOO_LARGE", "Request is too large.") };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, response: err(400, "MALFORMED_JSON", "Request body must be valid JSON.") };
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { ok: false, response: err(400, "INVALID_REQUEST", "Request body must be an object.") };
  const obj = data as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!(GUIDE_ALLOWED_KEYS as readonly string[]).includes(key))
      return { ok: false, response: err(400, "INVALID_REQUEST", "Unsupported field in request.") };
  }
  const { question, selectedWorkspaceId, requestId } = obj;
  if (requestId !== undefined && !isUuid(requestId))
    return { ok: false, response: err(400, "INVALID_REQUEST", "requestId must be a UUID.") };
  if (!isUuid(selectedWorkspaceId))
    return { ok: false, response: err(400, "INVALID_REQUEST", "selectedWorkspaceId must be a UUID.") };
  if (typeof question !== "string")
    return { ok: false, response: err(400, "INVALID_REQUEST", "question must be text.") };
  const q = question.normalize("NFC").trim();
  if (q.length < GUIDE_QUESTION_MIN_CHARS || q.length > GUIDE_QUESTION_MAX_CHARS)
    return {
      ok: false,
      response: err(400, "INVALID_REQUEST", `question must be ${GUIDE_QUESTION_MIN_CHARS}-${GUIDE_QUESTION_MAX_CHARS} characters.`),
    };
  if (CONTROL_RE.test(q))
    return { ok: false, response: err(400, "INVALID_REQUEST", "question contains unsupported characters.") };
  return {
    ok: true,
    value: { question: q, selectedWorkspaceId: selectedWorkspaceId.toLowerCase(), ...(requestId ? { requestId: requestId as string } : {}) },
  };
}

/** Flag is ON only for the exact string "true"; anything else (absent, "1", "TRUE ") is OFF. */
export function isGuideEnabled(flag: string | undefined | null): boolean {
  return flag === "true";
}

export type WorkspaceAccess = "member" | "managed" | "none";

export type GuideDeps = {
  /** Verifies the bearer JWT via auth.getUser. Returns null on absent/invalid. */
  verifyUser: (bearer: string) => Promise<{ id: string } | null>;
  /** Server-owned read: member (workspace_members) / managed partner / none. Throws on read failure. */
  workspaceAccess: (userId: string, workspaceId: string) => Promise<WorkspaceAccess>;
  /** Raw server-side flag value (env). Default absent => disabled. */
  guideFlag: string | undefined;
};

export function bearerFrom(header: string | null): string | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.split(".").length === 3 ? token : null;
}

/**
 * Full request decision. Order: method -> auth presence -> body -> verified
 * user -> workspace access -> flag. No provider call exists in G2A.1.
 */
export async function handleGuideRequest(
  input: { method: string; authorization: string | null; body: string },
  deps: GuideDeps,
): Promise<GuideResponse> {
  if (input.method !== "POST") return err(405, "METHOD_NOT_ALLOWED", "Use POST.");
  const bearer = bearerFrom(input.authorization);
  if (!bearer) return err(401, "UNAUTHORIZED", "Sign in required.");
  const parsed = parseGuideRequest(input.body);
  if (!parsed.ok) return parsed.response;
  const { selectedWorkspaceId, requestId } = parsed.value;
  try {
    const user = await deps.verifyUser(bearer);
    if (!user || !isUuid(user.id)) return err(401, "UNAUTHORIZED", "Sign in required.", requestId);
    const access = await deps.workspaceAccess(user.id, selectedWorkspaceId);
    if (access === "managed")
      return err(403, "MANAGED_ACCESS_NOT_SUPPORTED", "The Guide is not available for managed client projects yet.", requestId);
    if (access !== "member") return err(403, "FORBIDDEN", "You do not have access to this project.", requestId);
    if (!isGuideEnabled(deps.guideFlag))
      return err(503, "GUIDE_NOT_ENABLED", "The Guide is not enabled yet. Use the Help Center.", requestId);
    // G2A.1 has no budget reservation or provider integration: fail closed.
    return err(503, "GUIDE_PROVIDER_NOT_CONFIGURED", "The Guide is not available yet. Use the Help Center.", requestId);
  } catch {
    return err(503, "INTERNAL_ERROR", "The Guide is unavailable right now.", requestId);
  }
}
