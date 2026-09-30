/**
 * TEST FIXTURE ONLY — not routed, not bundled into the app. Renders the real
 * MiniAppCustomMediaView with MOCK adapters (no server functions, no auth).
 * Select with ?state=loading|error|free|pro|empty
 */
import "@/styles.css";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MiniAppCustomMediaView, type CustomMediaAdapter } from "@/components/telegram-miniapp/MiniAppCustomMedia";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGO8skKLgYGBgYGBiQEGAB6SAaoMEkBsAAAAAElFTkSuQmCC";
const GIF = "R0lGODlhBAAEAIAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAHgAAACwAAAAABAAEAAAICQABCBxIsCCAgAA7";
const mode = new URLSearchParams(location.search).get("state") ?? "pro";
const OLD = "00000000-0000-4000-8000-0000000000aa";
const assets = [
  { id: "00000000-0000-4000-8000-000000000001", mimeType: "image/gif", animated: true, width: 4, height: 4, bytes: 900, previewDataUrl: `data:image/gif;base64,${GIF}` },
  { id: "00000000-0000-4000-8000-000000000002", mimeType: "image/png", animated: false, width: 3, height: 2, bytes: 1200, previewDataUrl: `data:image/png;base64,${PNG}` },
  { id: OLD, mimeType: "image/png", animated: false, width: 3, height: 2, bytes: 1200, previewDataUrl: `data:image/png;base64,${PNG}` },
];
const selection: { mission: string | null; broadcast: string | null } = { mission: null, broadcast: OLD };
const calls: string[] = [];
(window as unknown as { __calls: string[] }).__calls = calls;
const adapter: CustomMediaAdapter = {
  load: () =>
    mode === "loading" ? new Promise(() => {}) :
    mode === "error" ? Promise.reject(new Error("network")) :
    Promise.resolve({ ok: true, entitled: mode !== "free", assets: mode === "empty" ? [] : assets, selection: { ...selection }, brandKitReady: true }),
  upload: async () => ({ ok: false, reason: "too_large" }),
  select: async (slot, id) => { calls.push(`${slot}:${id ?? "clear"}`); selection[slot] = id; return { ok: true }; },
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <main className="mx-auto max-w-md p-3">
      <p className="mb-2 text-xs text-muted-foreground">TEST FIXTURE — mocked authorized state ({mode})</p>
      <MiniAppCustomMediaView workspaceId="ws-fixture" adapter={adapter} />
    </main>
  </QueryClientProvider>,
);
