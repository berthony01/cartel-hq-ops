/**
 * G2B.1 — staging/review-only visual shell switch.
 * Locked OFF for every build, even when Vite env vars are set.
 * This is NOT the paid AI feature flag and must not be changed without
 * a separate production release gate and authenticated browser QA.
 * The staged component contains NO network or paid model call.
 */
export const CARTEL_GUIDE_PREVIEW_UI_ENABLED = false;
