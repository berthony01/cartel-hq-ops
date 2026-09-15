/**
 * SE-16.1 — Telegram Mini App route tree root.
 *
 * Deliberately OUTSIDE `_authenticated`: a Telegram Mini App user has no
 * Supabase browser session, so this tree never mounts AppShell, the sidebar,
 * or the operator navigation. Authorization happens entirely server-side in
 * the SE-16.0 bridge, from the signed Telegram `initData`.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/tg")({
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
    scripts: [{ src: "https://telegram.org/js/telegram-web-app.js", async: true }],
  }),
  component: () => <Outlet />,
});
