export type SetupDeliveryState = "PENDING" | "FAILED" | "SENT" | "SENDING" | "AMBIGUOUS" | "UNKNOWN";

export type SetupRecoveryAction = "start" | "continue" | "refresh" | "complete";

export function normalizeSetupDeliveryState(value: unknown): SetupDeliveryState {
  const state = String(value ?? "").toUpperCase();
  return ["PENDING", "FAILED", "SENT", "SENDING", "AMBIGUOUS"].includes(state)
    ? state as SetupDeliveryState
    : "UNKNOWN";
}

export function setupRecoveryAction(state: "READY" | "STARTING" | "STARTED", delivery: SetupDeliveryState): SetupRecoveryAction {
  if (state === "STARTED") return "complete";
  if (state === "READY") return "start";
  return delivery === "SENDING" || delivery === "AMBIGUOUS" || delivery === "UNKNOWN" ? "refresh" : "continue";
}

export function setupPermissionProofAllowsStart(
  proof: { resolved: boolean; isAdmin: boolean; canDelete: boolean; canPin: boolean },
  requirements: { sourceCleanupRequired: boolean; autoPinMission: boolean },
): boolean {
  return proof.resolved && proof.isAdmin
    && (!requirements.sourceCleanupRequired || proof.canDelete)
    && (!requirements.autoPinMission || proof.canPin);
}

export function setupDeliveryMaySend(state: SetupDeliveryState): boolean {
  return state === "PENDING" || state === "FAILED";
}

export async function continueSetupDelivery<T>(
  state: SetupDeliveryState,
  send: () => Promise<T>,
): Promise<{ sent: false; reason: "ambiguous" | "invalid" } | { sent: true; result: T } | { sent: false; reason: "already_sent" }> {
  if (state === "SENDING" || state === "AMBIGUOUS") return { sent: false, reason: "ambiguous" };
  if (state === "SENT") return { sent: false, reason: "already_sent" };
  if (!setupDeliveryMaySend(state)) return { sent: false, reason: "invalid" };
  return { sent: true, result: await send() };
}

export async function requestExactSetupCleanup<T>(deps: {
  readExact: () => Promise<{ cleanupConfirmed: boolean }>;
  requestCleanup: () => Promise<T>;
}): Promise<{ ok: false } | { ok: true; result: T }> {
  const exact = await deps.readExact();
  if (!exact.cleanupConfirmed) return { ok: false };
  return { ok: true, result: await deps.requestCleanup() };
}

export async function saveSetupDraft<T>(deps: {
  save: () => Promise<{ data: T; error: unknown }>;
}): Promise<{ ok: false } | { ok: true; data: T }> {
  const result = await deps.save();
  return result.error ? { ok: false } : { ok: true, data: result.data };
}

export async function suggestSetupTargets<TSnapshot, TSuggestion>(deps: {
  readCandidate: () => Promise<{ externalPostId: string } | null>;
  readMetrics: (externalPostId: string) => Promise<TSnapshot | null>;
  suggest: (snapshot: TSnapshot) => Promise<TSuggestion>;
}): Promise<{ available: false } | { available: true; suggestion: TSuggestion }> {
  const candidate = await deps.readCandidate();
  if (!candidate) return { available: false };
  const snapshot = await deps.readMetrics(candidate.externalPostId);
  if (!snapshot) return { available: false };
  return { available: true, suggestion: await deps.suggest(snapshot) };
}

export async function startSetupMutation<T>(deps: {
  permissions: { resolved: boolean; isAdmin: boolean; canDelete: boolean; canPin: boolean };
  requirements: { sourceCleanupRequired: boolean; autoPinMission: boolean };
  mutate: () => Promise<T>;
}): Promise<{ ok: false; reason: "permissions" } | { ok: true; result: T }> {
  if (!setupPermissionProofAllowsStart(deps.permissions, deps.requirements)) return { ok: false, reason: "permissions" };
  return { ok: true, result: await deps.mutate() };
}