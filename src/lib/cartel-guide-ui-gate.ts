/**
 * G2B.1 — staging/review-only visual shell switch.
 * Locked OFF for every build, even when Vite env vars are set.
 * This is NOT the paid AI feature flag and must not be changed without
 * a separate production release gate and authenticated browser QA.
 * The staged component contains NO network or paid model call.
 */
// Compile-time opt-in restricted to isolated test builds; never a production flag.
export const CARTEL_GUIDE_PREVIEW_UI_ENABLED = import.meta.env.MODE === "guide-staging-harness" && import.meta.env['VITE_CARTEL_GUIDE_STAGING_HARNESS'] === "STAGING_ONLY";
