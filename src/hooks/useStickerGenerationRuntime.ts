import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { loadAssets, loadLatestJobs, loadPackStickers, classifyProviderError } from "@/lib/sticker-packs";
import type { AiJobRow, ProviderFailure, StickerRow } from "@/lib/sticker-packs";
import { signedUrl, signedUrlMap } from "@/lib/media";
import { startStickerGeneration, syncStickerJob } from "@/lib/sticker-ai";

/**
 * Sticker Lab generation runtime.
 *
 * Behaviour-preserving extraction of the existing single-sticker generation
 * pipeline, stage/failure/note/preview state, durable ai_jobs attempt history,
 * polling ownership and Supabase reconciliation. No product behaviour is added
 * here: no concurrency, no automatic retries, no new provider calls.
 */

export type Stage =
  | "idle"
  | "saving"
  | "starting"
  | "generating"
  | "background"
  | "verifying"
  | "ready"
  | "failed"
  | "replacement_failed"
  | "timeout";

export const STAGE_LABEL: Record<Stage, string> = {
  idle: "Not generated",
  saving: "Saving pack…",
  starting: "Starting…",
  generating: "Generating",
  background: "Background removal",
  verifying: "Transparency check",
  ready: "Ready",
  failed: "Failed",
  replacement_failed: "Replacement failed",
  timeout: "Timed out",
};

export type Preview = { url: string; transparencyValid: boolean; storagePath?: string };

const POLL_TIMEOUT_MS = 15 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useStickerGenerationRuntime(params: {
  workspaceId: string | null | undefined;
  referenceAssetIds: string[];
}) {
  const { workspaceId, referenceAssetIds } = params;

  const [stages, setStages] = useState<Record<string, Stage>>({});
  /** Structured, user-facing failure per sticker id. */
  const [failures, setFailures] = useState<Record<string, ProviderFailure | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  /** Latest ai_jobs rows per sticker id — attempt history only, read-only. */
  const [jobHistory, setJobHistory] = useState<Record<string, AiJobRow[]>>({});
  /**
   * Phase 4C: durable per-sticker Telegram publish footprint, derived from the
   * same `stickers` read `loadExisting` already performs. A sticker is locked
   * when it has ANY Telegram footprint — status is deliberately NOT used
   * because generation overwrites it.
   */
  const [telegramLocked, setTelegramLocked] = useState<Record<string, boolean>>({});

  const aliveRef = useRef(true);
  /** Sticker ids currently polled in this tab — their live stage wins. */
  const pollingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * Durable state: reconciles every persisted sticker against Supabase
   * `stickers`, `media_assets` and the latest related `ai_jobs` rows.
   * Read-only — never calls the provider and never spends credits.
   */
  const loadExisting = useCallback(async (id: string) => {
    let rows: StickerRow[] = [];
    try {
      rows = await loadPackStickers(id);
    } catch {
      return;
    }
    const assetIds = rows.map((r) => r.image_asset_id).filter(Boolean) as string[];
    let assets: Awaited<ReturnType<typeof loadAssets>> = {};
    let jobs: Record<string, AiJobRow[]> = {};
    try {
      [assets, jobs] = await Promise.all([
        loadAssets(assetIds),
        loadLatestJobs(rows.map((r) => r.id)),
      ]);
    } catch {
      /* keep whatever resolved; states below degrade safely */
    }
    // Phase 4D — candidate jobs deliberately never change the current image, so
    // they must not drive current-image stage, failure or attempt state here.
    for (const key of Object.keys(jobs)) {
      jobs[key] = (jobs[key] ?? []).filter((job) => !job.is_candidate);
    }

    const paths = Object.values(assets).map((a) => a.storage_path);
    const urls = await signedUrlMap(paths);
    if (!aliveRef.current) return;

    const nextPreviews: Record<string, Preview> = {};
    const nextStages: Record<string, Stage> = {};
    const nextFailures: Record<string, ProviderFailure | undefined> = {};
    const nextNotes: Record<string, string> = {};
    const nextLocked: Record<string, boolean> = {};

    for (const row of rows) {
      nextLocked[row.id] =
        row.telegram_file_id !== null || row.telegram_published_at !== null;
      const asset = row.image_asset_id ? assets[row.image_asset_id] : undefined;
      const url = asset ? urls[asset.storage_path] : undefined;
      const hasAsset = !!(asset && url);
      if (asset && url) {
        nextPreviews[row.id] = {
          url,
          transparencyValid: asset.transparency_valid === true,
          storagePath: asset.storage_path,
        };
      }
      // A locally polling sticker owns its own transient stage.
      if (pollingRef.current.has(row.id)) continue;

      const latest = jobs[row.id]?.[0];
      const isBackground = (latest?.job_type ?? "").toLowerCase().includes("background");

      if (latest && (latest.status === "queued" || latest.status === "running")) {
        nextStages[row.id] = isBackground ? "background" : "generating";
        nextFailures[row.id] = undefined;
      } else if (latest && latest.status === "failed") {
        // An existing valid asset is never discarded by a failed replacement.
        nextStages[row.id] = hasAsset ? "replacement_failed" : "failed";
        nextFailures[row.id] = classifyProviderError(latest.error_message, latest.job_type);
        if (isBackground) nextNotes[row.id] = "Background removal step";
      } else if (hasAsset) {
        nextStages[row.id] = "ready";
        nextFailures[row.id] = undefined;
      } else if (latest) {
        // Job finished without a stored asset — not a usable sticker.
        nextStages[row.id] = "failed";
        nextFailures[row.id] = {
          kind: "unknown",
          title: "No image was stored",
          body: "The last attempt finished but no transparent image was saved to this project. Retry this sticker.",
          raw: null,
        };
      } else {
        nextStages[row.id] = "idle";
      }
    }

    setPreviews((p) => ({ ...p, ...nextPreviews }));
    setStages((s) => ({ ...s, ...nextStages }));
    setFailures((e) => ({ ...e, ...nextFailures }));
    setNotes((n) => ({ ...n, ...nextNotes }));
    setJobHistory((h) => ({ ...h, ...jobs }));
    // Authoritative replacement (not merge): durable rows are the only truth.
    setTelegramLocked(nextLocked);
  }, []);

  const attachAsset = async (stickerId: string, assetId: string) => {
    const assets = await loadAssets([assetId]);
    const asset = assets[assetId];
    if (!asset) return false;
    const url = await signedUrl(asset.storage_path, 3600);
    if (!url || !aliveRef.current) return false;
    setPreviews((p) => ({
      ...p,
      [stickerId]: {
        url,
        transparencyValid: asset.transparency_valid === true,
        storagePath: asset.storage_path,
      },
    }));
    return true;
  };

  /** Runs one sticker through the server pipeline. Only ever user initiated. */
  const runGeneration = async (conceptId: string, stickerId: string, packId: string) => {
    const hadPreview = !!previews[stickerId];
    setFailures((e) => ({ ...e, [stickerId]: undefined }));
    setNotes((n) => ({ ...n, [stickerId]: "" }));
    // No "Generating" until the server confirms a job id.
    setStages((s) => ({ ...s, [stickerId]: "starting" }));
    pollingRef.current.add(stickerId);
    try {
      const started = await startStickerGeneration({
        workspaceId: workspaceId!,
        packId,
        stickerId,
        referenceAssetIds,
      });
      if (!started.aiJobId) throw new Error("The generation service did not return a job id.");
      let jobId = started.aiJobId;
      setStages((s) => ({ ...s, [stickerId]: "generating" }));
      let delay = 3000;
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        await sleep(delay);
        if (!aliveRef.current) return;
        delay = Math.min(Math.round(delay * 1.3), 15_000);
        const res = await syncStickerJob(jobId);
        if (!aliveRef.current) return;

        if (res.status === "failed") {
          // A failed replacement never removes the existing valid asset.
          setStages((s) => ({ ...s, [stickerId]: hadPreview ? "replacement_failed" : "failed" }));
          setFailures((e) => ({
            ...e,
            [stickerId]: classifyProviderError(res.error, res.stage),
          }));
          if ((res.stage ?? "").includes("background")) {
            setNotes((n) => ({ ...n, [stickerId]: "Background removal step" }));
          }
          return;
        }

        if (res.status === "succeeded") {
          if (res.childJobId) {
            jobId = res.childJobId;
            delay = 3000;
            setStages((s) => ({ ...s, [stickerId]: "background" }));
            continue;
          }
          if (res.assetId) {
            setStages((s) => ({ ...s, [stickerId]: "verifying" }));
            const ok = await attachAsset(stickerId, res.assetId);
            setStages((s) => ({
              ...s,
              [stickerId]: ok ? "ready" : hadPreview ? "replacement_failed" : "failed",
            }));
            if (!ok) {
              setFailures((e) => ({
                ...e,
                [stickerId]: {
                  kind: "service",
                  title: "Image could not be loaded",
                  body: "The sticker finished but its image could not be read from private storage. Use “Refresh status”, then retry if it still does not appear.",
                  raw: null,
                },
              }));
            }
            return;
          }
          // Succeeded without an asset yet — reconcile from the database.
          pollingRef.current.delete(stickerId);
          await loadExisting(packId);
          return;
        }
        if (res.stage === "background_removal") {
          setStages((s) => ({ ...s, [stickerId]: "background" }));
        }
      }
      setStages((s) => ({ ...s, [stickerId]: "timeout" }));
      setFailures((e) => ({
        ...e,
        [stickerId]: {
          kind: "service",
          title: "Still running after 15 minutes",
          body: "This sticker is taking unusually long. It may still finish on the provider — use “Refresh status” later before retrying so you do not pay twice.",
          raw: null,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation could not start.";
      // Phase 4C: a server-side published block is NOT a provider failure and
      // never means Kie ran or charged.
      const published = message.includes("STICKER_PUBLISHED");
      const failure: ProviderFailure = published
        ? {
            kind: "service",
            title: "Regeneration is locked for this sticker",
            body: "This sticker is already connected to Telegram. CARTEL HQ blocked regeneration to keep the live set and current image synchronized. No provider task was started and nothing was charged.",
            raw: null,
          }
        : classifyProviderError(message);
      if (published) {
        toast.message(failure.title, { description: failure.body });
      } else {
        toast.error(failure.title, { description: failure.body });
      }
      setFailures((e) => ({ ...e, [stickerId]: failure }));
      // Fall back to durable, backend-derived state.
      pollingRef.current.delete(stickerId);
      await loadExisting(packId);
    } finally {
      pollingRef.current.delete(stickerId);
    }
    void conceptId;
  };

  return {
    stages,
    setStages,
    failures,
    notes,
    previews,
    jobHistory,
    aliveRef,
    pollingRef,
    loadExisting,
    attachAsset,
    runGeneration,
    telegramLocked,
    /** True when the durable row has ANY Telegram publish footprint. */
    isTelegramLocked: (stickerId: string | null | undefined) =>
      !!(stickerId && telegramLocked[stickerId]),
  };
}
