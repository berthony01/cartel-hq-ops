/**
 * MINI-HQ B1 — Brand tab prepared custom message media.
 * Selections are PREPARED only: no mission card or broadcast uses them until
 * the sending integration ships. Never renders storage paths or Telegram ids.
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  miniAppCustomMediaSelect,
  miniAppCustomMediaState,
  miniAppCustomMediaUpload,
} from "@/lib/telegram-miniapp-bridge.functions";
import { CUSTOM_MEDIA_MAX_BYTES, type CustomMediaSlot } from "@/lib/custom-message-media";
import { MiniAppMessage, MiniAppPanel, MiniAppSkeleton } from "@/components/telegram-miniapp/MiniAppPieces";
import { Button } from "@/components/ui/button";

const REASONS: Record<string, string> = {
  too_large: "That file is over 2 MB. Choose a smaller image.",
  unsupported_type: "Use a PNG, JPEG or GIF file.",
  corrupt: "That file could not be read as an image.",
  bad_dimensions: "Image must be at most 4096 × 4096 pixels.",
  empty: "That file is empty.",
  pro_required: "Custom message media is a Pro feature.",
  brand_kit_required: "Save your Brand Kit in CARTEL HQ first.",
  invalid_asset: "That image is no longer available.",
};

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function MiniAppCustomMedia({ initData, workspaceId }: { initData: string; workspaceId: string }) {
  const qc = useQueryClient();
  const loadState = useServerFn(miniAppCustomMediaState);
  const upload = useServerFn(miniAppCustomMediaUpload);
  const select = useServerFn(miniAppCustomMediaSelect);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = ["miniapp-custom-media", workspaceId];
  const query = useQuery({ queryKey: key, queryFn: () => loadState({ data: { initData, workspaceId } }) });
  const state = query.data && query.data.ok ? query.data : null;

  const onFile = async (file: File | undefined) => {
    setNotice(null);
    if (!file) return;
    if (file.size > CUSTOM_MEDIA_MAX_BYTES) return setNotice(REASONS["too_large"] ?? null);
    setBusy("upload");
    try {
      const res = await upload({ data: { initData, workspaceId, fileBase64: await readBase64(file) } });
      setNotice(res.ok ? "Uploaded." : REASONS[res.reason] ?? "Upload failed. Try again.");
      await qc.invalidateQueries({ queryKey: key });
    } catch {
      setNotice("Upload failed. Try again.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onSelect = async (slot: CustomMediaSlot, assetId: string | null) => {
    setNotice(null);
    setBusy(`${slot}:${assetId ?? "none"}`);
    try {
      const res = await select({ data: { initData, workspaceId, slot, assetId } });
      setNotice(res.ok ? "Saved as prepared media." : REASONS[res.reason] ?? "Could not save. Try again.");
      await qc.invalidateQueries({ queryKey: key });
    } catch {
      setNotice("Could not save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <MiniAppPanel
      heading="Custom message media · Pro"
      note="Prepared media only. Sending with missions and broadcasts is coming later — nothing you pick here is used in messages yet."
    >
      {query.isLoading ? <MiniAppSkeleton label="Loading media…" /> : null}
      {query.data && !query.data.ok ? <MiniAppMessage title="Media unavailable" description="Could not load custom media. Try again later." /> : null}
      {state && !state.entitled ? (
        <MiniAppMessage title="Pro feature" description="Upgrade to Pro in CARTEL HQ Settings to upload custom message media." />
      ) : null}
      {state && state.entitled ? (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor="miniapp-custom-media-file" className="text-sm font-medium text-foreground">
              Upload image or GIF
            </label>
            <p className="text-xs text-muted-foreground">PNG, JPEG or GIF, up to 2 MB and 4096 × 4096 px.</p>
            <input
              id="miniapp-custom-media-file"
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif"
              disabled={busy !== null}
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="min-h-11 w-full min-w-0 text-sm text-foreground file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-primary-foreground"
            />
            {busy === "upload" ? <p className="text-xs text-muted-foreground" role="status">Uploading…</p> : null}
          </div>
          {!state.brandKitReady ? <p className="text-xs text-muted-foreground">Save your Brand Kit in CARTEL HQ before choosing prepared media.</p> : null}
          {state.assets.length === 0 ? <p className="text-sm text-muted-foreground">No custom media yet.</p> : null}
          <ul className="grid min-w-0 grid-cols-1 gap-3">
            {state.assets.map((asset, index) => (
              <li key={asset.id} className="flex min-w-0 flex-col gap-2 rounded-md border border-border/60 p-2">
                {asset.previewDataUrl ? (
                  <img
                    src={asset.previewDataUrl}
                    alt={`Custom media ${index + 1}${asset.animated ? " (animated GIF)" : ""}`}
                    className="max-h-40 w-full rounded object-contain"
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Preview unavailable</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {asset.animated ? "Animated GIF" : asset.mimeType.replace("image/", "").toUpperCase()} · {Math.ceil(asset.bytes / 1024)} KB
                </p>
                <div className="flex min-w-0 flex-wrap gap-2">
                  {(["mission", "broadcast"] as const).map((slot) => {
                    const selected = state.selection[slot] === asset.id;
                    return (
                      <Button
                        key={slot}
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className="min-h-11"
                        aria-pressed={selected}
                        disabled={busy !== null || !state.brandKitReady}
                        onClick={() => void onSelect(slot, selected ? null : asset.id)}
                      >
                        {selected ? `Prepared for ${slot}s ✓` : `Prepare for ${slot}s`}
                      </Button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {notice ? <p className="mt-2 text-sm text-foreground" role="status">{notice}</p> : null}
    </MiniAppPanel>
  );
}
