/** Isolated Cartel HQ AI Guide staging harness client. Never imported by published builds. */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const STAGING_PROJECT = "llicojkxpzwylghptmkf";
const STAGING_URL = `https://${STAGING_PROJECT}.supabase.co`;
const publicKey = import.meta.env['VITE_CARTEL_GUIDE_STAGING_PUBLISHABLE_KEY'];
const enabled = import.meta.env.MODE === "guide-staging-harness" &&
  import.meta.env['VITE_CARTEL_GUIDE_STAGING_HARNESS'] === "STAGING_ONLY";
if (!enabled || !publicKey) {
  throw new Error("Guide staging harness requires isolated mode and staging publishable key");
}
// Refuse a key tied to the production project when the key is a legacy JWT.
// For modern publishable keys, rely on the explicit supplied staging project and
// a separate authorized validation of the project's publishable key.
if (publicKey.startsWith("eyJ")) {
  const part = publicKey.split(".")[1];
  if (!part || typeof atob === "undefined") {
    throw new Error("Cannot validate staging JWT key");
  }
  let payload: { ref?: string; iss?: string };
  try { payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { throw new Error("Invalid staging JWT key"); }
  if (payload.ref !== STAGING_PROJECT) throw new Error("Wrong Supabase project key");
}
export const supabase = createClient<Database>(STAGING_URL, publicKey, {
  auth: {
    storageKey: "cartel-guide-staging-isolated-auth",
    storage: typeof window === "undefined" ? undefined : window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
