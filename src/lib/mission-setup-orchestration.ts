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