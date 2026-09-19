/**
 * SE-16.1 — Telegram Mini App route tree root.
 *
 * Deliberately OUTSIDE `_authenticated`: a Telegram Mini App user has no
 * Supabase browser session, so this tree never mounts AppShell, the sidebar,
 * or the operator navigation. Authorization happens entirely server-side in
 * the SE-16.0 bridge, from the signed Telegram `initData`.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * SE-16.1H4 — route-scoped response hardening for the Mini App tree only.
 *
 * Bounded sources only (no `*`). Telegram Web must be able to frame this
 * surface, so framing is controlled by `frame-ancestors`, never by
 * `X-Frame-Options`. COOP/CORP are deliberately omitted: they are unproven
 * against the Telegram WebView and are not required here.
 */
const SUPABASE_ORIGIN = "https://ocoinbnjgstkmnwwvnhi.supabase.co";
const SUPABASE_REALTIME_ORIGIN = "wss://ocoinbnjgstkmnwwvnhi.supabase.co";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  // Telegram Web clients embed the Mini App in an iframe.
  "frame-ancestors https://web.telegram.org https://telegram.org https://*.telegram.org",
  // 'unsafe-inline' is required by the inline bootstrap TanStack Start emits.
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_REALTIME_ORIGIN}`,
  "img-src 'self' data: blob:",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
].join(", ");

export const Route = createFileRoute("/tg")({
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  }),

  head: () => ({
    meta: [
      { title: "Mission Control — CARTEL HQ" },
      {
        name: "description",
        content: "Telegram Mini App view of live CARTEL HQ social mission results and targets.",
      },
      { property: "og:title", content: "Mission Control — CARTEL HQ" },
      {
        property: "og:description",
        content: "Telegram Mini App view of live CARTEL HQ social mission results and targets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
    // NOT async: the Mini App screens need the bridge as early as possible.
    // Client code still waits for readiness with a bounded poll, so a slow or
    // absent bridge degrades safely instead of racing the first effect.
    scripts: [{ src: "https://telegram.org/js/telegram-web-app.js" }],
  }),
  component: () => <Outlet />,
});
