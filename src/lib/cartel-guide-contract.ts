/**
 * CARTEL HQ AI Guide — disabled-state contract (preview shell only).
 *
 * Pure module: no network, no Supabase, no provider. The conversational Guide
 * is NOT active; this only defines the bounded request shape for later phases
 * and the single status the shell may show today.
 */

export const GUIDE_QUESTION_MAX_LENGTH = 1000;

export type GuideStatus = "disabled";

/** The only status available in this build. Never "enabled". */
export const GUIDE_STATUS: GuideStatus = "disabled";

export const GUIDE_DISABLED_MESSAGE =
  "Conversational AI is not active. Nothing you type here is sent anywhere. Setup Help and the Help Center remain fully usable.";

export const GUIDE_SAMPLE_QUESTION = "How do I add Launch Watch to my Telegram welcome message?";

/** Future request shape (not sent in this build). */
export type GuideRequest = { workspaceId: string; requestId: string; question: string };

/** Platform-owner gate: fails closed on loading, error or anything but explicit true. */
export function canSeeGuidePreview(access: { loading: boolean; error: string | null; isPlatformOwner: boolean }): boolean {
  return access.loading === false && access.error === null && access.isPlatformOwner === true;
}

/** Submit outcome while disabled: never dispatches. */
export function submitGuideQuestion(_question: string): { dispatched: false; status: GuideStatus } {
  return { dispatched: false, status: GUIDE_STATUS };
}
