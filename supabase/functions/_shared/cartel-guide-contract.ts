/**
 * G2A.1 — pure, fail-closed request boundary for the future Cartel HQ Guide.
 * STAGED ONLY. There is no model, database write, action execution, or budget.
 * Never treat caller-supplied question text as instructions to a system/model.
 */
export const GUIDE_MAX_BODY_BYTES = 2048;
export const GUIDE_MAX_QUESTION_CHARS = 500;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jwtShape = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const forbidden = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const keys = new Set(["question", "selectedWorkspaceId", "requestId"]);

export type GuideQuestion = { question: string; selectedWorkspaceId: string; requestId?: string };
export type GuideResponse = {
  status: 400 | 401 | 403 | 405 | 413 | 503;
  body: { code: string; message: string; requestId?: string };
};
export type GuideAccess = "member" | "managed" | "none";
export type GuideDependencies = {
  verifyUser(jwt: string): Promise<string | null>;
  workspaceAccess(userId: string, workspaceId: string): Promise<GuideAccess>;
  enabled: string | null | undefined;
};
const fail = (status: GuideResponse["status"], code: string): GuideResponse => ({
  status, body: { code, message: "The Guide is unavailable for this request." },
});
export function isGuideEnabled(flag: string | null | undefined): boolean {
  return flag === "true";
}
export function parseGuideRequest(raw: string):
  | { ok: true; value: GuideQuestion }
  | { ok: false; response: GuideResponse } {
  if (new TextEncoder().encode(raw).length > GUIDE_MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, "REQUEST_TOO_LARGE") };
  }
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { return { ok: false, response: fail(400, "INVALID_JSON") }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: fail(400, "INVALID_REQUEST") };
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(k => !keys.has(k))) {
    return { ok: false, response: fail(400, "UNRECOGNIZED_FIELD") };
  }
  const question = body.question;
  const workspace = body.selectedWorkspaceId;
  if (typeof question !== "string" || question.trim().length < 2 ||
      question.length > GUIDE_MAX_QUESTION_CHARS || forbidden.test(question)) {
    return { ok: false, response: fail(400, "INVALID_QUESTION") };
  }
  if (typeof workspace !== "string" || !uuid.test(workspace)) {
    return { ok: false, response: fail(400, "INVALID_WORKSPACE") };
  }
  const requestId = body.requestId;
  if (requestId !== undefined && (typeof requestId !== "string" || !uuid.test(requestId))) {
    return { ok: false, response: fail(400, "INVALID_REQUEST_ID") };
  }
  return { ok: true, value: {
    question: question.trim(), selectedWorkspaceId: workspace.toLowerCase(),
    ...(typeof requestId === "string" ? { requestId: requestId.toLowerCase() } : {}),
  } };
}

/** Always unavailable until a separately approved, atomic budget guard and
 * model integration have been built and verified. Flag=true DOES NOT enable AI. */
export async function evaluateGuideRequest(
  input: { method: string; authorization: string | null; body: string },
  deps: GuideDependencies,
): Promise<GuideResponse> {
  if (input.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  const token = input.authorization?.match(jwtShape)?.[1];
  if (!token) return fail(401, "UNAUTHENTICATED");
  const parsed = parseGuideRequest(input.body);
  if (!parsed.ok) return parsed.response;

  let userId: string | null;
  try { userId = await deps.verifyUser(token); }
  catch { return fail(503, "AUTH_UNAVAILABLE"); }
  if (!userId || !uuid.test(userId)) return fail(401, "UNAUTHENTICATED");

  let access: GuideAccess;
  try { access = await deps.workspaceAccess(userId, parsed.value.selectedWorkspaceId); }
  catch { return fail(503, "ACCESS_UNAVAILABLE"); }
  if (access === "managed") return fail(403, "MANAGED_SCOPE_NOT_VERIFIED");
  if (access !== "member") return fail(403, "FORBIDDEN");

  // This G2A.1 source has NO provider path or model credentials under any flag.
  if (!isGuideEnabled(deps.enabled)) return fail(503, "GUIDE_NOT_ENABLED");
  return fail(503, "PROVIDER_NOT_CONFIGURED");
}
