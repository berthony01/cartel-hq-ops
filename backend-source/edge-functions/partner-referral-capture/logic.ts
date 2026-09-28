/** Pure helpers for partner-referral-capture (shared with the regression). */

export const ALLOWED_ORIGINS = [
  "https://pepecartelhq.com",
  "https://id-preview--469fb83c-0f27-4aa7-bb99-c4125279c565.lovable.app",
] as const;

export const REFERRAL_CODE_RE = /^[a-z0-9]{10}$/;
export const REFERRAL_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Accepts mixed case input; stored/used lowercased. Exactly 10 chars. */
export function isValidReferralCode(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE_RE.test(value.trim().toLowerCase()) && value.trim().length === 10;
}

export function captureCorsHeaders(origin: string | null): Record<string, string> {
  const base: Record<string, string> = { Vary: "Origin" };
  if (!origin || !(ALLOWED_ORIGINS as readonly string[]).includes(origin)) return base;
  return {
    ...base,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
  };
}

/** 256 bits from the platform CSPRNG, base64url without padding (43 chars). */
export function newReferralToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
