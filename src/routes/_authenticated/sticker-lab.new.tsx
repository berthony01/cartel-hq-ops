import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
import {
  listWorkspaceAssets,
  signedUrl,
  signedUrlMap,
  uploadWorkspaceAsset,
  validateImageFile,
  type MediaAsset,
} from "@/lib/media";
import {
  fetchStickerAiConfig,
  startStickerGeneration,
  syncStickerJob,
} from "@/lib/sticker-ai";
import {
  classifyProviderError,
  hydrateDraftFromPack,
  loadAssets,
  loadLatestJobs,
  loadPackStickers,
  persistDraft,
  summarizeAttempts,
  type AiJobRow,
  type PersistResult,
  type ProviderFailure,
  type StickerRow,
} from "@/lib/sticker-packs";
import {
  downloadStickerPng,
  downloadStickersZip,
  packZipName,
  stickerFileName,
  prepareTelegramCutoutAtUrl,
} from "@/lib/sticker-export";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Download,
  FileArchive,
  ImagePlus,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import {
  loadPackTelegramState,
  previewShortName,
  publishPack,
  refreshPackStatus,
  telegramErrorMessage,
  type PackTelegramState,
  type StickerTelegramState,
  type TelegramPublishResult,
} from "@/lib/telegram-stickers";
import {
  TelegramConnectionCard,
  useTelegramSetup,
} from "@/components/cartel/TelegramConnectionCard";
import {
  TelegramGroupCard,
  useTelegramGroupSetup,
} from "@/components/cartel/TelegramGroupCard";
import {
  distributePackToGroups,
  fetchPackGroupDistribution,
  sendGroupTestSticker,
  type TelegramDistributePackResult,
  type TelegramPackGroupTarget,
} from "@/lib/telegram-group";
import { PageHeader } from "@/components/cartel/PageHeader";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BUILDER_STEPS,
  MAX_REFERENCES,
  PACK_SIZES,
  PACK_THEMES,
  loadDraft,
  saveDraft,
  starterConcepts,
  type BuilderDraft,
  type Concept,
  type PackSize,
  type PackTheme,
} from "@/lib/sticker-lab";

type BuilderSearch = { pack?: string };

export const Route = createFileRoute("/_authenticated/sticker-lab/new")({
  validateSearch: (search: Record<string, unknown>): BuilderSearch => {
    const raw = search["pack"];
    const pack = typeof raw === "string" ? raw.trim() : "";
    return pack ? { pack } : {};
  },

  head: () => ({
    meta: [
      { title: "New Sticker Pack — Sticker Lab — CARTEL HQ" },
      {
        name: "description",
        content:
          "Build a PEPECARTEL sticker pack: private references, pack setup, concepts, AI generation with verified transparency, and review.",
      },
      { property: "og:title", content: "New Sticker Pack — CARTEL HQ" },
      {
        property: "og:description",
        content: "Create a PEPECARTEL sticker pack inside the CARTEL HQ operating layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StickerLabBuilder,
});

const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";
const REFERENCE_TYPES = ["mascot", "reference_image", "logo"] as const;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

type Stage =
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

const STAGE_LABEL: Record<Stage, string> = {
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

type Preview = { url: string; transparencyValid: boolean; storagePath?: string };

/** Action-scoped signed URL lifetime (seconds) for verify/download only. */
const ACTION_URL_TTL = 300;

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.08) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function StickerLabBuilder() {
  const { workspaceId } = useWorkspace();
  const { user } = useSession();
  const { pack: urlPackId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [packNameError, setPackNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  /** Structured, user-facing failure per sticker id. */
  const [failures, setFailures] = useState<Record<string, ProviderFailure | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  /** Latest ai_jobs rows per sticker id — attempt history only, read-only. */
  const [jobHistory, setJobHistory] = useState<Record<string, AiJobRow[]>>({});
  const [confirmRemaining, setConfirmRemaining] = useState(false);
  const [exporting, setExporting] = useState(false);
  /**
   * Local-only, second transparency verification performed in the browser on the
   * already-signed PNG bytes. Never written back to Supabase.
   */
  const [clientChecks, setClientChecks] = useState<
    Record<
      string,
      {
        source: string;
        status: "checking" | "verified" | "failed";
        reason?: string;
        /** Telegram-cutout analysis of the same fresh bytes. */
        cutout?: "verified" | "will_clean" | "failed";
        removedPixels?: number;
      }
    >
  >({});

  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);
  const verifyRunRef = useRef(false);
  /** Sticker ids currently polled in this tab — their live stage wins. */
  const pollingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * Durable identity: when the URL carries a pack id it wins over the session
   * draft. The session draft may only supplement unpersisted fields, and only
   * when it belongs to the same pack.
   */
  useEffect(() => {
    let active = true;
    if (!urlPackId) {
      setDraft(loadDraft());
      return;
    }
    if (!workspaceId) return;
    setDraft(null);
    setHydrateError(null);
    hydrateDraftFromPack({ packId: urlPackId, workspaceId })
      .then((hydrated) => {
        if (!active) return;
        if (!hydrated) {
          setHydrateError(
            "That pack could not be found in this workspace. It may belong to another workspace, or the link is wrong. Nothing was created or changed.",
          );
          return;
        }
        const session = loadDraft();
        const supplement =
          session.packId === urlPackId
            ? {
                imageName: session.imageName,
                referenceStoragePath: session.referenceStoragePath,
                referenceAssetIds:
                  session.referenceAssetIds.length > 0
                    ? session.referenceAssetIds
                    : hydrated.referenceAssetIds,
              }
            : {};
        setDraft({ ...hydrated, ...supplement });
      })
      .catch(() => {
        if (active)
          setHydrateError("Could not load that pack. Check your connection and try again.");
      });
    return () => {
      active = false;
    };
  }, [urlPackId, workspaceId]);


  useEffect(() => {
    if (draft) saveDraft(draft);
  }, [draft]);

  // Restore a preview for a reference already stored in the private bucket.
  const storedPath = draft?.referenceStoragePath ?? null;
  useEffect(() => {
    let active = true;
    if (!storedPath) return;
    signedUrl(storedPath, 3600).then((url) => {
      if (active && url) setPreviewUrl(url);
    });
    return () => {
      active = false;
    };
  }, [storedPath]);

  // Existing private workspace references the user can reuse without uploading.
  const referencesQuery = useQuery({
    queryKey: ["workspace-references", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const assets = await listWorkspaceAssets(workspaceId!);
      const usable = assets.filter((a) =>
        (REFERENCE_TYPES as readonly string[]).includes(a.asset_type),
      );
      const urls = await signedUrlMap(usable.map((a) => a.storage_path));
      return { assets: usable, urls };
    },
  });

  // Provider status. Free probe, never a generation call.
  const configQuery = useQuery({
    queryKey: ["sticker-ai-config"],
    enabled: step === 4,
    staleTime: 60_000,
    retry: 1,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: fetchStickerAiConfig,
  });

  // A previously failed probe must never persist as a stale "service down"
  // impression when the user comes back to Step 4. Re-probe (free) instead.
  const configRefetch = configQuery.refetch;
  const configErrored = configQuery.isError;
  useEffect(() => {
    if (step === 4 && configErrored) void configRefetch();
  }, [step, configErrored, configRefetch]);


  const packId = draft?.packId ?? null;

  /* ---------------- Telegram publishing (Step 5, explicit clicks only) --------------- */
  const telegram = useTelegramSetup(step === 5);
  const telegramGroup = useTelegramGroupSetup(step === 5);
  const [distributing, setDistributing] = useState(false);
  const [distError, setDistError] = useState<string | null>(null);
  const [distResult, setDistResult] = useState<TelegramDistributePackResult | null>(null);
  const [distTargets, setDistTargets] = useState<TelegramPackGroupTarget[]>([]);
  const [tgPack, setTgPack] = useState<PackTelegramState | null>(null);
  const [tgStickers, setTgStickers] = useState<Record<string, StickerTelegramState>>({});
  const [publishing, setPublishing] = useState(false);
  const [tgRefreshing, setTgRefreshing] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishResult, setPublishResult] = useState<TelegramPublishResult | null>(null);
  const [tgError, setTgError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const loadTelegramState = useCallback(async (id: string) => {
    try {
      const state = await loadPackTelegramState(id);
      setTgPack(state.pack);
      setTgStickers(state.stickers);
    } catch {
      /* read-only; the panel simply shows no Telegram state */
    }
  }, []);

  /** Durable per-group distribution rows. Read-only. */
  const loadDistribution = useCallback(
    async (id: string) => {
      if (!workspaceId) return;
      try {
        const { targets } = await fetchPackGroupDistribution({ workspaceId, packId: id });
        setDistTargets(targets ?? []);
      } catch {
        /* read-only; the panel simply shows no distribution history */
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (step === 5 && packId) {
      void loadTelegramState(packId);
      void loadDistribution(packId);
    }
  }, [step, packId, loadTelegramState, loadDistribution]);



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
    const paths = Object.values(assets).map((a) => a.storage_path);
    const urls = await signedUrlMap(paths);
    if (!aliveRef.current) return;

    const nextPreviews: Record<string, Preview> = {};
    const nextStages: Record<string, Stage> = {};
    const nextFailures: Record<string, ProviderFailure | undefined> = {};
    const nextNotes: Record<string, string> = {};

    for (const row of rows) {
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
          body: "The last attempt finished but no transparent image was saved to your workspace. Retry this sticker.",
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
  }, []);

  /**
   * Second, browser-side transparency verification. Read-only: it mints a fresh,
   * short-lived signed URL from the immutable storage path immediately before
   * fetching the original PNG bytes, then inspects them with the same verifyAlpha()
   * helper used at export time. Nothing is uploaded, re-encoded or written back to
   * Supabase, and no provider call is made.
   */
  const runClientVerification = useCallback(
    async (force = false) => {
      if (verifyRunRef.current) return;
      const candidates = Object.entries(previews)
        .filter(([, p]) => p.transparencyValid === true && !!(p.storagePath ?? p.url))
        .map(([stickerId, p]) => ({
          stickerId,
          // Staleness keys off the immutable asset source, never the temporary URL.
          source: p.storagePath ?? p.url,
          storagePath: p.storagePath,
          fallbackUrl: p.url,
        }));
      const pending = candidates.filter(({ stickerId, source }) => {
        const existing = clientChecks[stickerId];
        return force || !existing || existing.source !== source;
      });
      if (pending.length === 0) return;

      verifyRunRef.current = true;
      setCheckProgress({ done: 0, total: pending.length });
      setClientChecks((prev) => {
        const next = { ...prev };
        for (const { stickerId, source } of pending) next[stickerId] = { source, status: "checking" };
        return next;
      });

      let done = 0;
      const queue = [...pending];
      const worker = async () => {
        for (;;) {
          const item = queue.shift();
          if (!item) return;
          // Fresh action-scoped URL so a stale 60s preview link can never fail the check.
          // eslint-disable-next-line no-await-in-loop
          const freshUrl = item.storagePath
            ? await signedUrl(item.storagePath, ACTION_URL_TTL)
            : item.fallbackUrl;
          if (!aliveRef.current) return;
          if (!freshUrl) {
            setClientChecks((prev) => ({
              ...prev,
              [item.stickerId]: {
                source: item.source,
                status: "failed",
                reason: "a secure download link could not be created for this private file",
              },
            }));
            done += 1;
            setCheckProgress({ done, total: pending.length });
            continue;
          }
          // Single fetch: real-alpha verification plus Telegram-cutout analysis.
          // eslint-disable-next-line no-await-in-loop
          const check = await prepareTelegramCutoutAtUrl(freshUrl);
          if (!aliveRef.current) return;
          setClientChecks((prev) => ({
            ...prev,
            [item.stickerId]: !check.alphaOk
              ? {
                  source: item.source,
                  status: "failed",
                  reason: check.reason ?? "transparency check failed",
                  cutout: "failed",
                }
              : {
                  source: item.source,
                  status: "verified",
                  ...(check.ok || !check.reason ? {} : { reason: check.reason }),
                  cutout: check.ok ? (check.cleaned ? "will_clean" : "verified") : "failed",
                  removedPixels: check.removedPixels,
                },
          }));

          done += 1;
          setCheckProgress({ done, total: pending.length });
        }
      };
      try {
        await Promise.all([worker(), worker(), worker()]);
      } finally {
        verifyRunRef.current = false;
        if (aliveRef.current) setCheckProgress(null);
      }
    },
    [previews, clientChecks],
  );

  useEffect(() => {
    if (step !== 5) return;
    void runClientVerification(false);
  }, [step, runClientVerification]);

  useEffect(() => {
    if (!packId) return;
    if (step !== 4 && step !== 5) return;
    void loadExisting(packId);
  }, [packId, step, loadExisting]);

  if (hydrateError) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center">
        <p className="text-sm text-destructive">{hydrateError}</p>
        <Button asChild variant="outline" className="mt-5 min-h-10">
          <Link to="/sticker-lab">Back to Sticker Lab</Link>
        </Button>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="py-24 text-center text-sm text-muted-foreground">Loading builder…</div>
    );
  }

  const update = (patch: Partial<BuilderDraft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const applyFile = async (file: File | undefined | null) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setFileError(invalid);
      return;
    }
    if (!workspaceId || !user) {
      setFileError("Select or create a workspace before uploading a reference.");
      return;
    }
    setFileError(null);
    setUploading(true);
    try {
      const asset = await uploadWorkspaceAsset({
        workspaceId,
        userId: user.id,
        file,
        assetType: "reference_image",
      });
      const url = await signedUrl(asset.storage_path, 3600);
      setPreviewUrl(url);
      update({
        imageName: file.name,
        referenceAssetId: asset.id,
        referenceStoragePath: asset.storage_path,
        referenceAssetIds: Array.from(
          new Set([asset.id, ...draft.referenceAssetIds]),
        ).slice(0, MAX_REFERENCES),
      });
      void referencesQuery.refetch();
      toast.success("Reference stored privately in this workspace");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setFileError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearFile = () => {
    setPreviewUrl(null);
    const removed = draft.referenceAssetId;
    update({
      imageName: null,
      referenceAssetId: null,
      referenceStoragePath: null,
      referenceAssetIds: draft.referenceAssetIds.filter((id) => id !== removed),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const toggleReference = (asset: MediaAsset) => {
    const selected = draft.referenceAssetIds.includes(asset.id);
    if (selected) {
      update({ referenceAssetIds: draft.referenceAssetIds.filter((id) => id !== asset.id) });
      return;
    }
    if (draft.referenceAssetIds.length >= MAX_REFERENCES) {
      toast.error(`Select at most ${MAX_REFERENCES} references.`);
      return;
    }
    update({ referenceAssetIds: [...draft.referenceAssetIds, asset.id] });
  };

  const setTheme = (theme: PackTheme) =>
    update({ theme, concepts: starterConcepts(theme, draft.size) });

  const setSize = (size: PackSize) => {
    const next =
      size <= draft.concepts.length
        ? draft.concepts.slice(0, size)
        : [
            ...draft.concepts,
            ...starterConcepts(draft.theme, size).slice(draft.concepts.length),
          ];
    update({ size, concepts: next });
  };

  const editConcept = (id: string, patch: Partial<Concept>) =>
    update({
      concepts: draft.concepts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  const removeConcept = (id: string) =>
    update({ concepts: draft.concepts.filter((c) => c.id !== id) });

  const addConcept = () => {
    if (draft.concepts.length >= draft.size) return;
    update({
      concepts: [
        ...draft.concepts,
        {
          id: `c${Date.now()}`,
          label: "NEW CONCEPT",
          action: "describe the pose or expression",
          emoji: "⭐",
        },
      ],
    });
  };

  /** Persists pack + concepts. Never triggers a provider call. */
  const persist = async (): Promise<PersistResult | null> => {
    if (!workspaceId || !user) {
      toast.error("Select a workspace first.");
      return null;
    }
    if (!draft.packName.trim()) {
      toast.error("Give the pack a name in Step 2 before saving.");
      return null;
    }
    setSaving(true);
    try {
      const result = await persistDraft({ workspaceId, userId: user.id, draft });
      setDraft((d) =>
        d ? { ...d, packId: result.packId, stickerIds: result.stickerIds } : d,
      );
      // The URL becomes the durable pack identity (no reload, no history spam).
      if (urlPackId !== result.packId) {
        void navigate({
          search: { pack: result.packId },
          replace: true,
        });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the pack.";
      toast.error(message);
      return null;
    } finally {
      setSaving(false);
    }
  };

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
        referenceAssetIds: draft.referenceAssetIds,
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
      toast.error(message);
      setFailures((e) => ({ ...e, [stickerId]: classifyProviderError(message) }));
      // Fall back to durable, backend-derived state.
      pollingRef.current.delete(stickerId);
      await loadExisting(packId);

    } finally {
      pollingRef.current.delete(stickerId);
    }
    void conceptId;
  };

  const generateOne = async (conceptId: string) => {
    setStages((s) => ({ ...s, [`concept:${conceptId}`]: "saving" }));
    const result = await persist();
    if (!result) {
      setStages((s) => ({ ...s, [`concept:${conceptId}`]: "idle" }));
      return;
    }
    setStages((s) => ({ ...s, [`concept:${conceptId}`]: "idle" }));
    const stickerId = result.stickerIds[conceptId];
    if (!stickerId) {
      toast.error("That concept could not be matched to a saved sticker.");
      return;
    }
    await runGeneration(conceptId, stickerId, result.packId);
  };

  const generateRemaining = async () => {
    setConfirmRemaining(false);
    const result = await persist();
    if (!result) return;
    for (const concept of draft.concepts) {
      const stickerId = result.stickerIds[concept.id];
      if (!stickerId) continue;
      if (stages[stickerId] === "ready" || previews[stickerId]) continue;
      // eslint-disable-next-line no-await-in-loop
      await runGeneration(concept.id, stickerId, result.packId);
      if (!aliveRef.current) return;
    }
  };

  /** Reconciles provider config AND durable sticker/job state. Never generates. */
  const refreshStatus = () => {
    void configQuery.refetch();
    const id = draft.packId;
    if (id) void loadExisting(id);
  };

  const stickerIdFor = (conceptId: string) => draft.stickerIds[conceptId] ?? null;
  const stageFor = (conceptId: string): Stage => {
    const id = stickerIdFor(conceptId);
    const local = stages[`concept:${conceptId}`];
    if (local === "saving") return "saving";
    if (!id) return "idle";
    return stages[id] ?? (previews[id] ? "ready" : "idle");
  };
  const busy = (stage: Stage) =>
    stage === "saving" ||
    stage === "starting" ||
    stage === "generating" ||
    stage === "background" ||
    stage === "verifying";
  const isFailure = (stage: Stage) =>
    stage === "failed" || stage === "replacement_failed" || stage === "timeout";

  const anyBusy = draft.concepts.some((c) => busy(stageFor(c.id)));
  const readyConcepts = draft.concepts.filter((c) => stageFor(c.id) === "ready");
  const generatedCount = readyConcepts.length;
  const remainingCount = draft.concepts.length - generatedCount;
  const failedConcepts = draft.concepts.filter((c) => isFailure(stageFor(c.id)));
  const failedCount = failedConcepts.length;
  const activeCount = draft.concepts.filter((c) => busy(stageFor(c.id))).length;
  // Backend invariant: ready AND has a preview AND backend transparency verified.
  const backendExportable = (conceptId: string) => {
    if (stageFor(conceptId) !== "ready") return false;
    const id = stickerIdFor(conceptId);
    const preview = id ? previews[id] : undefined;
    return !!preview && preview.transparencyValid === true;
  };
  const clientCheckFor = (conceptId: string) => {
    const id = stickerIdFor(conceptId);
    return id ? clientChecks[id] : undefined;
  };
  /** Telegram cutout preparation succeeded (nothing to remove, or a safe edge halo). */
  const cutoutOk = (conceptId: string) => {
    const c = clientCheckFor(conceptId)?.cutout;
    return c === "verified" || c === "will_clean";
  };
  // Export invariant: backend conditions AND browser alpha AND a safe Telegram cutout.
  const isExportable = (conceptId: string) =>
    backendExportable(conceptId) &&
    clientCheckFor(conceptId)?.status === "verified" &&
    cutoutOk(conceptId);
  const checksRunning = checkProgress !== null;
  const transparentCount = readyConcepts.filter((c) => backendExportable(c.id)).length;
  const browserVerifiedCount = draft.concepts.filter(
    (c) => clientCheckFor(c.id)?.status === "verified",
  ).length;
  const cutoutVerifiedCount = draft.concepts.filter((c) => cutoutOk(c.id)).length;
  const browserFailedCount = draft.concepts.filter(
    (c) => clientCheckFor(c.id)?.status === "failed" || clientCheckFor(c.id)?.cutout === "failed",
  ).length;
  const attentionCount = failedCount + browserFailedCount;

  const exportableConcepts = draft.concepts.filter((c) => isExportable(c.id));
  const exportableCount = exportableConcepts.length;
  const allReady = draft.concepts.length > 0 && generatedCount === draft.concepts.length && !anyBusy;
  // Export/publish readiness is stricter than "ready": transparency must be verified.
  const exportReady = draft.concepts.length > 0 && exportableCount === draft.concepts.length;
  const omittedLabels = draft.concepts.filter((c) => !isExportable(c.id)).map((c) => c.label);

  /* ---------------- Telegram publish handlers (user-initiated only) ---------------- */
  const tgPublishedCount = draft.concepts.filter((c) => {
    const id = stickerIdFor(c.id);
    return id ? tgStickers[id]?.status === "published" : false;
  }).length;
  const totalConcepts = draft.concepts.length;
  const allPublished = totalConcepts > 0 && tgPublishedCount === totalConcepts;
  const partiallyPublished = tgPublishedCount > 0 && !allPublished;
  const telegramSetExists = !!tgPack?.telegram_set_url || !!tgPack?.telegram_set_name;
  const canRetryPublish = !allPublished && (partiallyPublished || telegramSetExists);
  // Only Review/export-approved sticker rows are ever sent to the server.
  const reviewedStickerIds = draft.concepts
    .filter((c) => isExportable(c.id))
    .map((c) => stickerIdFor(c.id))
    .filter((id): id is string => !!id);
  const selectedGroups = telegramGroup.selectedGroups;
  const selectedGroupIds = telegramGroup.selectedGroupIds;
  const selectedGroupNames = selectedGroups.map((g) => g.title);
  const groupsSelectedAndReady =
    selectedGroupIds.length > 0 && telegramGroup.allSelectedReady;
  const canPublish =
    !!packId &&
    !!workspaceId &&
    telegram.botConfigured &&
    telegram.ownerConnected &&
    groupsSelectedAndReady &&
    reviewedStickerIds.length > 0 &&
    !allPublished &&
    !checksRunning &&
    !publishing;
  const canDistribute =
    !!packId &&
    !!workspaceId &&
    allPublished &&
    selectedGroupIds.length > 0 &&
    groupsSelectedAndReady &&
    !distributing;
  const shortNamePreview = packId
    ? previewShortName(draft.packName, packId, telegram.botUsername)
    : null;

  /**
   * Batch distribution of the ALREADY published sticker set to the selected
   * connected groups. Never creates or re-creates a Telegram sticker set.
   */
  const doDistribute = async () => {
    if (!packId || !workspaceId || selectedGroupIds.length === 0) return;
    setDistributing(true);
    setDistError(null);
    try {
      const result = await distributePackToGroups({
        workspaceId,
        packId,
        groupConnectionIds: selectedGroupIds,
      });
      setDistResult(result);
      await loadTelegramState(packId);
      await loadDistribution(packId);
      if (result.status === "complete") {
        toast.success(
          `${result.total} group${result.total === 1 ? "" : "s"} updated: ${result.assigned} official set, ${result.announced} announced.`,
        );
      } else if (result.status === "partial") {
        toast.warning(
          `${result.total - result.failed} of ${result.total} groups updated, ${result.failed} need retry.`,
        );
      } else {
        toast.error("Distribution to the selected groups failed. The sticker set stays published.");
      }
    } catch (err) {
      setDistError(telegramErrorMessage(err));
      toast.error(telegramErrorMessage(err));
    } finally {
      setDistributing(false);
    }
  };

  const doPublish = async () => {
    if (!packId || !workspaceId) return;
    setPublishing(true);
    setTgError(null);
    try {
      const result = await publishPack({ workspaceId, packId, stickerIds: reviewedStickerIds });
      setPublishResult(result);
      await loadTelegramState(packId);
      if (result.status === "published") {
        toast.success(`Published ${result.published} of ${result.total} stickers to Telegram.`);
        // One publish, then exactly one batch distribution to the selected groups.
        await doDistribute();
      } else if (result.status === "partial") {
        toast.warning(
          `${result.published} of ${result.total} published, ${result.failed} need retry.`,
        );
      } else {
        toast.error("Telegram publishing failed. See the publish detail below.");
      }
    } catch (err) {
      setTgError(telegramErrorMessage(err));
      toast.error(telegramErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  };


  const doRefresh = async () => {
    if (!packId || !workspaceId) return;
    setTgRefreshing(true);
    setTgError(null);
    try {
      const result = await refreshPackStatus({ workspaceId, packId });
      await loadTelegramState(packId);
      toast.success(
        result.exists
          ? `Telegram set found${result.stickerCount ? ` with ${result.stickerCount} stickers` : ""}.`
          : "No Telegram set exists for this pack yet.",
      );
    } catch (err) {
      setTgError(telegramErrorMessage(err));
      toast.error(telegramErrorMessage(err));
    } finally {
      setTgRefreshing(false);
    }
  };

  /** A native test always targets exactly one selected group — never a broadcast. */
  const testTargetGroup = selectedGroups.length === 1 ? selectedGroups[0]! : null;
  const doSendTest = async () => {
    if (!packId || !workspaceId || !testTargetGroup) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      const result = await sendGroupTestSticker({
        workspaceId,
        packId,
        groupConnectionId: testTargetGroup.id,
      });
      const title = testTargetGroup.title;

      if (result.sent) {
        setTestResult(`Native sticker sent to ${title}.`);
        toast.success(`Native sticker sent to ${title}.`);
      } else {
        const base = result.message || "Telegram could not deliver the test sticker to the group.";
        setTestResult(result.technical ? `${base} (${result.technical})` : base);
        toast.error("Telegram could not deliver the test sticker to the group.");
      }
    } catch (err) {
      setTestResult(telegramErrorMessage(err));
      toast.error(telegramErrorMessage(err));
    } finally {
      setSendingTest(false);
    }
  };
  // Read-only history derived from already-loaded ai_jobs rows. No extra queries.
  const historyRows = draft.concepts
    .map((c) => {
      const id = stickerIdFor(c.id);
      const summary = summarizeAttempts(id ? jobHistory[id] : undefined);
      return { conceptId: c.id, label: c.label, ...summary };
    })
    .filter((row) => row.attempts > 1 || row.failed > 0);

  const configured = configQuery.data?.configured === true;

  /** Retries only the failed stickers. Finished stickers are never touched. */
  const retryFailed = async () => {
    const result = await persist();
    if (!result) return;
    for (const concept of failedConcepts) {
      const stickerId = result.stickerIds[concept.id];
      if (!stickerId) continue;
      // eslint-disable-next-line no-await-in-loop
      await runGeneration(concept.id, stickerId, result.packId);
      if (!aliveRef.current) return;
    }
  };

  /** Sends the user back to Step 3 with the offending concept focused. */
  const editConceptFromFailure = (conceptId: string) => {
    setStep(3);
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      const el = document.getElementById(`${conceptId}-action`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLInputElement | null)?.focus();
    }, 120);
  };

  const downloadOne = async (conceptId: string, index: number) => {
    const stickerId = stickerIdFor(conceptId);
    const preview = stickerId ? previews[stickerId] : undefined;
    const concept = draft.concepts.find((c) => c.id === conceptId);
    if (!preview || !concept || !backendExportable(conceptId)) {
      toast.error("Only ready, transparency-verified stickers can be downloaded.");
      return;
    }
    const localCheck = clientCheckFor(conceptId);
    if (localCheck?.status === "failed" || localCheck?.cutout === "failed") {
      toast.error(
        `Browser cutout check failed — ${localCheck?.reason ?? "unknown reason"}. This sticker was not saved.`,
      );
      return;
    }
    try {
      // Preview links are deliberately short-lived; mint a fresh one at click time.
      const freshUrl = preview.storagePath
        ? await signedUrl(preview.storagePath, ACTION_URL_TTL)
        : preview.url;
      if (!freshUrl) {
        toast.error(
          "Could not create a secure download link for this private file. Refresh status and try again.",
        );
        return;
      }
      const saved = await downloadStickerPng(
        freshUrl,
        stickerFileName(draft.packName || "cartel-pack", index, concept.label),
      );
      toast.success(
        saved.cleaned
          ? `Telegram cutout verified and saved — an outer light halo (${saved.removedPixels.toLocaleString()} pixels) was removed for this download. The stored original is unchanged.`
          : "Telegram cutout verified and saved — no outer halo was found.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed.");
    }
  };

  const downloadZip = async () => {
    const candidates = draft.concepts
      .map((c, i) => {
        const id = stickerIdFor(c.id);
        const preview = id ? previews[id] : undefined;
        if (!preview || !isExportable(c.id)) return null;
        return {
          filename: stickerFileName(draft.packName || "cartel-pack", i, c.label),
          storagePath: preview.storagePath,
          fallbackUrl: preview.url,
          label: c.label,
        };
      })
      .filter(Boolean) as {
      filename: string;
      storagePath?: string;
      fallbackUrl: string;
      label: string;
    }[];
    if (candidates.length === 0) {
      toast.error("There are no ready, transparency-verified stickers to export yet.");
      return;
    }
    setExporting(true);
    try {
      // One batched, action-scoped signing call so a multi-sticker export cannot
      // expire mid-download. Read-only: no storage or table write.
      const paths = candidates.map((c) => c.storagePath).filter(Boolean) as string[];
      const fresh = await signedUrlMap(paths, ACTION_URL_TTL);

      const entries: { filename: string; url: string; label: string }[] = [];
      const linkFailures: { label: string; reason: string }[] = [];
      for (const c of candidates) {
        const url = c.storagePath ? fresh[c.storagePath] : c.fallbackUrl;
        if (!url) {
          linkFailures.push({ label: c.label, reason: "no secure download link could be created" });
          continue;
        }
        entries.push({ filename: c.filename, url, label: c.label });
      }

      if (entries.length === 0) {
        toast.error(
          "Secure download links could not be created for these private files. Refresh status and try again.",
        );
        return;
      }

      const result = await downloadStickersZip(
        entries,
        packZipName(draft.packName || "cartel-pack"),
      );
      const omitted = [...linkFailures, ...result.omitted];
      if (omitted.length > 0) {
        toast.warning(
          `${result.exported} Telegram-cutout PNG${result.exported === 1 ? "" : "s"} exported (${result.cleanedCount} had an outer halo removed). Omitted: ${omitted
            .map((o) => `${o.label} (${o.reason})`)
            .join(", ")}.`,
        );
      } else {
        toast.success(
          `${result.exported} Telegram-cutout PNG${result.exported === 1 ? "" : "s"} exported${
            result.cleanedCount > 0 ? ` (${result.cleanedCount} with an outer halo removed)` : ""
          }.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };



  const goNext = () => {
    if (step === 2 && !draft.packName.trim()) {
      setPackNameError("Give the pack a name before continuing.");
      return;
    }
    setPackNameError(null);
    setStep((s) => Math.min(BUILDER_STEPS.length, s + 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    setStep((s) => Math.max(1, s - 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Sticker Lab"
        title="New Sticker Pack"
        description="References, packs and stickers are stored in your private CARTEL HQ workspace. AI generation runs server-side and only when you start it."
        status={draft.packId ? "Saved to workspace" : "Draft"}
        actions={
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/sticker-lab">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Sticker Lab
            </Link>
          </Button>
        }
      />

      <Stepper current={step} onSelect={setStep} />

      {step === 1 ? (
        <StepCard
          title="Character Reference"
          hint="Stored privately in this workspace's Asset Vault and reused for generation."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <span className="mb-2 block text-sm font-medium text-foreground">
                Upload a new reference
              </span>
              {previewUrl ? (
                <div className="cartel-panel flex flex-col items-center gap-3 rounded-lg p-4">
                  <img
                    src={previewUrl}
                    alt={`Reference image ${draft.imageName ?? ""}`}
                    className="max-h-56 w-auto rounded-md border border-border object-contain"
                  />
                  <p className="w-full truncate text-center text-xs text-muted-foreground">
                    {draft.imageName}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-10"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Change image
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-10 text-signal hover:text-signal"
                      onClick={clearFile}
                    >
                      <X className="size-4" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void applyFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center transition-colors ${
                    dragging ? "border-gold bg-gold/5" : "border-border bg-background/40"
                  }`}
                >
                  <span className="flex size-11 items-center justify-center rounded-md border border-border bg-surface-raised text-gold">
                    <ImagePlus className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-medium text-foreground">
                    Drag an image here, or choose a file
                  </p>
                  <p className="text-xs text-muted-foreground">PNG, JPG, WEBP or GIF</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? "Uploading…" : "Choose file"}
                  </Button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                aria-label="Choose a character reference image"
                onChange={(e) => void applyFile(e.target.files?.[0])}
              />
              {fileError ? (
                <p role="alert" className="mt-2 text-xs text-signal">
                  {fileError}
                </p>
              ) : null}
            </div>

            <div className="space-y-5">
              <div>
                <Label htmlFor="character-name">Character or brand name (optional)</Label>
                <Input
                  id="character-name"
                  className="mt-2 min-h-11"
                  placeholder="e.g. Pepe Capo"
                  value={draft.characterName}
                  aria-describedby="character-name-help"
                  onChange={(e) => update({ characterName: e.target.value })}
                />
                <p id="character-name-help" className="mt-2 text-xs text-muted-foreground">
                  Used to keep the character consistent across every sticker.
                </p>
              </div>
              <Notice tone="muted">
                Uploads go straight into the private <strong>workspace-assets</strong> bucket in
                Supabase and are recorded in your Asset Vault. Previews use short-lived signed
                URLs; nothing is public.
              </Notice>
            </div>
          </div>

          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-foreground">
                Reuse existing workspace references
              </h3>
              <span className="text-xs text-muted-foreground">
                {draft.referenceAssetIds.length} of {MAX_REFERENCES} selected
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Mascots, reference images and logos already in your Asset Vault. If none are
              selected, the server picks the best available reference automatically.
            </p>
            {referencesQuery.isLoading ? (
              <p className="mt-4 text-xs text-muted-foreground">Loading references…</p>
            ) : (referencesQuery.data?.assets.length ?? 0) === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                No mascot, reference or logo assets yet. Upload one above or from the Asset Vault.
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {referencesQuery.data!.assets.map((asset) => {
                  const selected = draft.referenceAssetIds.includes(asset.id);
                  const url = referencesQuery.data!.urls[asset.storage_path];
                  return (
                    <li key={asset.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleReference(asset)}
                        className={`w-full overflow-hidden rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? "border-gold bg-gold/10"
                            : "border-border bg-surface-raised hover:border-gold/40"
                        }`}
                      >
                        <span
                          className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border"
                          style={CHECKERBOARD}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={asset.asset_type}
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No preview</span>
                          )}
                        </span>
                        <span className="mt-2 block truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          {asset.asset_type.replace("_", " ")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </StepCard>
      ) : null}

      {step === 2 ? (
        <StepCard title="Pack Setup" hint="Saved to this workspace's sticker packs.">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <Label htmlFor="pack-name">Pack name</Label>
              <Input
                id="pack-name"
                className="mt-2 min-h-11"
                placeholder="e.g. PEPECARTEL Reactions Vol. 1"
                value={draft.packName}
                aria-invalid={packNameError ? true : undefined}
                aria-describedby={packNameError ? "pack-name-error" : undefined}
                onChange={(e) => {
                  update({ packName: e.target.value });
                  if (e.target.value.trim()) setPackNameError(null);
                }}
              />
              {packNameError ? (
                <p id="pack-name-error" role="alert" className="mt-2 text-xs text-signal">
                  {packNameError}
                </p>
              ) : null}
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-foreground">Pack size</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PACK_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={draft.size === s}
                    onClick={() => setSize(s)}
                    className={`min-h-11 rounded-md border px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      draft.size === s
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
                    }`}
                  >
                    {s} stickers
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium text-foreground">Theme</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PACK_THEMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={draft.theme === t}
                    onClick={() => setTheme(t)}
                    className={`min-h-11 rounded-md border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      draft.theme === t
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Changing the theme replaces the starter concept suggestions in the next step.
              </p>
            </fieldset>

            <div>
              <Label htmlFor="brief">Custom brief</Label>
              <Textarea
                id="brief"
                className="mt-2 min-h-28"
                placeholder="What should this pack communicate? Tone, audience, running jokes…"
                value={draft.brief}
                onChange={(e) => update({ brief: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="style-notes">Visual style notes (optional)</Label>
              <Textarea
                id="style-notes"
                className="mt-2 min-h-28"
                placeholder="Line weight, palette, outline, shading, background treatment…"
                value={draft.styleNotes}
                onChange={(e) => update({ styleNotes: e.target.value })}
              />
            </div>
          </div>
        </StepCard>
      ) : null}

      {step === 3 ? (
        <StepCard
          title="Sticker Concepts"
          hint="Starter suggestions come from a fixed local list — not AI output."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                onClick={() => update({ concepts: starterConcepts(draft.theme, draft.size) })}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset suggestions
              </Button>
              <Button
                type="button"
                size="sm"
                className="min-h-10"
                disabled={draft.concepts.length >= draft.size}
                onClick={addConcept}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add concept
              </Button>
            </div>
          }
        >
          <p className="mb-4 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {draft.concepts.length} of {draft.size}
            </span>{" "}
            concepts used for this pack size.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {draft.concepts.map((c, i) => (
              <li key={c.id} className="cartel-panel rounded-lg p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9 text-muted-foreground hover:text-signal"
                    onClick={() => removeConcept(c.id)}
                    aria-label={`Remove concept ${i + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor={`${c.id}-label`} className="text-xs">
                      Label
                    </Label>
                    <Input
                      id={`${c.id}-label`}
                      className="mt-1.5 min-h-10"
                      value={c.label}
                      onChange={(e) => editConcept(c.id, { label: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${c.id}-action`} className="text-xs">
                      Action / expression
                    </Label>
                    <Input
                      id={`${c.id}-action`}
                      className="mt-1.5 min-h-10"
                      value={c.action}
                      onChange={(e) => editConcept(c.id, { action: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${c.id}-emoji`} className="text-xs">
                      Emoji
                    </Label>
                    <Input
                      id={`${c.id}-emoji`}
                      className="mt-1.5 min-h-10 w-24"
                      value={c.emoji}
                      onChange={(e) => editConcept(c.id, { emoji: e.target.value })}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={saving}
              onClick={() => void persist()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save pack to workspace
            </Button>
            {draft.packId ? (
              <span className="text-xs text-pepe">Pack saved. Retries reuse the same rows.</span>
            ) : null}
          </div>
        </StepCard>
      ) : null}

      {step === 4 ? (
        <StepCard
          title="Generation"
          hint="Each sticker runs generation, background removal and a server-side transparency check."
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              onClick={refreshStatus}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh status
            </Button>
          }
        >
          <div className="cartel-panel flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Provider
              </p>
              <p className="mt-1 truncate text-sm text-foreground">
                {configQuery.isLoading
                  ? "Checking…"
                  : configQuery.data
                    ? `${configQuery.data.model} · ${configQuery.data.backgroundModel}`
                    : "Status unavailable"}
              </p>
            </div>
            <StatusBadge tone={configured ? "green" : "muted"}>
              {configured ? "Configured" : "Not configured"}
            </StatusBadge>
          </div>

          {/* A provider probe failure is only alarming when it actually blocks the
              user. With finished stickers present it degrades to a neutral note. */}
          {configQuery.isError && generatedCount === 0 && !anyBusy ? (
            <div className="mt-4">
              <Notice tone="warn">
                Could not reach the generation service, so generation cannot start right now.
                Nothing was lost — use “Refresh status” to try again.
              </Notice>
            </div>
          ) : null}

          {configQuery.isError && (generatedCount > 0 || anyBusy) ? (
            <div className="mt-4">
              <Notice tone="muted">
                Provider status unknown right now — finished stickers are unaffected. Use “Refresh
                status” to re-check.
              </Notice>
            </div>
          ) : null}

          {!configQuery.isLoading && !configQuery.isError && !configured ? (
            <div className="mt-4">
              <Notice tone="warn">
                Generation is unavailable until <strong>KIE_API_KEY</strong> is added to the
                Supabase Edge Function secrets for the <strong>sticker-ai</strong> function.
                Everything else in the builder keeps working and nothing has been lost.
              </Notice>
            </div>
          ) : null}

          <Pipeline />

          {allReady ? (
            <div className="mt-6 rounded-lg border border-pepe/40 bg-pepe/5 p-4">
              <div className="flex items-start gap-3">
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-pepe" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-pepe">
                    All {draft.concepts.length} stickers ready
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {transparentCount} of {draft.concepts.length} transparency verified. Regenerate
                    any single sticker from its card below if you want a different take.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button type="button" className="min-h-11" onClick={goNext}>
                  Continue to Review
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={refreshStatus}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Refresh status
                </Button>
              </div>
            </div>
          ) : configured ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {failedCount > 0 && generatedCount > 0 ? (
                <>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={anyBusy || saving}
                    onClick={() => void retryFailed()}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Retry failed ({failedCount})
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {failedCount} of {draft.concepts.length} need another attempt — retries only
                    re-run the failed stickers and never touch finished ones.
                  </p>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={
                      anyBusy || saving || generatedCount > 0 || draft.concepts.length === 0
                    }
                    onClick={() => {
                      const first = draft.concepts[0];
                      if (first) void generateOne(first.id);
                    }}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    Generate first test sticker
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={anyBusy || saving || remainingCount === 0}
                    onClick={() => setConfirmRemaining(true)}
                  >
                    Generate remaining ({remainingCount})
                  </Button>
                </>
              )}
            </div>
          ) : null}


          <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {draft.concepts.map((c, index) => {
              const stage = stageFor(c.id);
              const stickerId = stickerIdFor(c.id);
              const preview = stickerId ? previews[stickerId] : undefined;
              const failure = stickerId ? failures[stickerId] : undefined;
              const note = stickerId ? notes[stickerId] : undefined;
              return (
                <li key={c.id} className="cartel-panel rounded-lg p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                      {c.emoji} {c.label}
                    </span>
                    <StatusBadge
                      tone={
                        stage === "ready"
                          ? "green"
                          : isFailure(stage)
                            ? "red"
                            : busy(stage)
                              ? "gold"
                              : "muted"
                      }
                    >
                      {STAGE_LABEL[stage]}
                    </StatusBadge>
                  </div>
                  <div
                    className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border"
                    style={CHECKERBOARD}
                  >
                    {preview ? (
                      <img
                        src={preview.url}
                        alt={`Generated sticker ${c.label}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : busy(stage) ? (
                      <Loader2 className="size-6 animate-spin text-gold" aria-hidden="true" />
                    ) : (
                      <span className="px-3 text-center text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        No image yet
                      </span>
                    )}
                  </div>
                  {preview ? (
                    <p
                      className={`mt-2 text-[11px] ${preview.transparencyValid ? "text-pepe" : "text-signal"}`}
                    >
                      {preview.transparencyValid
                        ? "Transparency verified"
                        : "Transparency not verified"}
                    </p>
                  ) : null}
                  {note && isFailure(stage) ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
                  ) : null}
                  {failure && isFailure(stage) ? (
                    <FailureBlock
                      failure={failure}
                      replacement={stage === "replacement_failed"}
                      onEditConcept={() => editConceptFromFailure(c.id)}
                    />
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={preview ? "outline" : "default"}
                      className="min-h-10 flex-1"
                      disabled={!configured || busy(stage) || saving}
                      onClick={() => void generateOne(c.id)}
                    >
                      {busy(stage) ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      {isFailure(stage)
                        ? "Retry this sticker"
                        : preview
                          ? "Regenerate"
                          : "Generate"}
                    </Button>
                    {backendExportable(c.id) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-10"
                        aria-label={`Download ${c.label} as PNG`}
                        onClick={() => void downloadOne(c.id, index)}
                      >
                        <Download className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>


          <AlertDialog open={confirmRemaining} onOpenChange={setConfirmRemaining}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Generate {remainingCount} stickers?</AlertDialogTitle>
                <AlertDialogDescription>
                  Each sticker uses TWO Kie tasks — image generation plus background removal — and
                  consumes Kie credits on your account. That is {remainingCount * 2} provider tasks
                  in total. Existing ready stickers are skipped.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void generateRemaining()}>
                  Generate {remainingCount}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </StepCard>
      ) : null}

      {step === 5 ? (
        <StepCard
          title="Review"
          hint="Verified static stickers from private storage. Telegram publishing is not connected."
        >
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <SummaryStat
              label="Backend ready"
              value={`${generatedCount}/${draft.concepts.length}`}
              tone={allReady ? "green" : "muted"}
            />
            <SummaryStat
              label="Backend transparency verified"
              value={`${transparentCount}/${draft.concepts.length}`}
              tone={
                transparentCount === draft.concepts.length && draft.concepts.length > 0
                  ? "green"
                  : "muted"
              }
            />
            <SummaryStat
              label="Browser alpha verified"
              value={`${browserVerifiedCount}/${draft.concepts.length}`}
              tone={
                browserVerifiedCount === draft.concepts.length && draft.concepts.length > 0
                  ? "green"
                  : "muted"
              }
            />
            <SummaryStat
              label="Telegram cutout verified"
              value={`${cutoutVerifiedCount}/${draft.concepts.length}`}
              tone={
                cutoutVerifiedCount === draft.concepts.length && draft.concepts.length > 0
                  ? "green"
                  : "muted"
              }
            />
            <SummaryStat label="In progress" value={String(activeCount)} tone="muted" />
            <SummaryStat
              label="Failed / needs attention"
              value={String(attentionCount)}
              tone={attentionCount > 0 ? "red" : "muted"}
            />
          </div>

          <div
            className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/40 p-3"
            aria-live="polite"
          >
            {checksRunning ? (
              <>
                <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
                <p className="text-xs text-foreground">
                  Checking transparency &amp; Telegram cutout {checkProgress?.done ?? 0}/
                  {checkProgress?.total ?? 0}…
                </p>
                <span
                  className="h-1.5 w-40 overflow-hidden rounded-full bg-border"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full bg-gold transition-all duration-300"
                    style={{
                      width: `${Math.round(
                        ((checkProgress?.done ?? 0) / Math.max(1, checkProgress?.total ?? 1)) * 100,
                      )}%`,
                    }}
                  />
                </span>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Review re-checks every finished sticker in your browser for a real alpha channel and
                analyses it for an edge-connected light halo. {browserVerifiedCount} alpha verified,{" "}
                {cutoutVerifiedCount} Telegram cutout verified
                {browserFailedCount > 0 ? `, ${browserFailedCount} need attention` : ""}.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto min-h-10"
              disabled={checksRunning}
              onClick={() => void runClientVerification(true)}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Re-check transparency &amp; cutout
            </Button>
          </div>

          {!exportReady ? (
            <div className="mb-6">
              <Notice tone="warn">
                Only stickers that are <strong>ready</strong>, <strong>transparency verified</strong>{" "}
                by the backend, <strong>alpha verified in your browser</strong> and{" "}
                <strong>Telegram cutout verified</strong> can be exported or published later. The rest of this pack is untouched and nothing has been lost — retry
                or regenerate them in the previous step whenever you want.
              </Notice>
            </div>
          ) : null}

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="min-h-11"
              disabled={exporting || checksRunning || exportableCount === 0}
              onClick={() => void downloadZip()}
            >
              {exporting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              Download all as ZIP ({exportableCount})
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={refreshStatus}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Refresh status
            </Button>
            <p className="text-xs text-muted-foreground">
              {checksRunning
                ? "Export is paused until the browser transparency and cutout checks finish."
                : "Exports are transparent PNGs downloaded straight to this device. Nothing is uploaded or published."}
            </p>
          </div>

          <div className="mb-6 rounded-md border border-border bg-background/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pepe">
              Telegram cutout verified
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              The checkerboard behind each preview marks the pixels that are actually transparent.
              Some image viewers display transparent areas as white or black — that is the viewer
              compositing the image, not a background baked into the file. Telegram places the
              transparent sticker directly over the chat background, so no rectangular background
              appears. A transparent canvas alone is not enough, though: some generations bake a
              thick white or cream contour around the artwork. Before export, CARTEL HQ removes only
              the light halo that is connected to the transparent outside edge — internal whites such
              as shirts, teeth, eyes, highlights and lettering interiors are always preserved, and if
              the halo looks unexpectedly large the sticker is flagged for manual review instead of
              being cleaned. Cleanup happens in your browser on the exported copy only; the stored
              original is never modified.
            </p>
          </div>


          {omittedLabels.length > 0 ? (
            <p className="mb-6 text-xs text-muted-foreground">
              The ZIP will contain {exportableCount} sticker
              {exportableCount === 1 ? "" : "s"}. Not included ({omittedLabels.length}):{" "}
              {omittedLabels.join(", ")}.
            </p>
          ) : null}

          {historyRows.length > 0 ? (
            <details className="mb-6 rounded-md border border-border bg-background/40 p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <FileArchive className="mr-2 inline size-3.5" aria-hidden="true" />
                Generation history ({historyRows.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {historyRows.map((row) => (
                  <li
                    key={row.conceptId}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border/60 pt-2 text-[11px] first:border-t-0 first:pt-0"
                  >
                    <span className="font-semibold text-foreground">{row.label}</span>
                    <span className="text-muted-foreground">
                      {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
                    </span>
                    <span className={row.failed > 0 ? "text-signal" : "text-muted-foreground"}>
                      {row.failed} failed
                    </span>
                    {row.lastFailure ? (
                      <span className="text-muted-foreground">· last failure: {row.lastFailure}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}


          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {draft.concepts.map((c, index) => {
              const stickerId = stickerIdFor(c.id);
              const preview = stickerId ? previews[stickerId] : undefined;
              const stage = stageFor(c.id);
              const failure = stickerId ? failures[stickerId] : undefined;
              const attempts = summarizeAttempts(stickerId ? jobHistory[stickerId] : undefined);
              const check = clientCheckFor(c.id);
              return (
                <li key={c.id} className="cartel-panel rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border"
                      style={CHECKERBOARD}
                    >
                      {preview ? (
                        <img
                          src={preview.url}
                          alt={`Generated sticker ${c.label}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span aria-hidden="true" className="text-xl">
                          {c.emoji}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{c.label}</p>
                      <p
                        className={`truncate text-xs ${
                          stage === "ready" && preview?.transparencyValid
                            ? "text-pepe"
                            : isFailure(stage)
                              ? "text-signal"
                              : "text-muted-foreground"
                        }`}
                      >
                        {preview
                          ? isFailure(stage)
                            ? STAGE_LABEL[stage]
                            : preview.transparencyValid
                              ? "Server verified"
                              : "Server: transparency not verified"
                          : STAGE_LABEL[stage]}
                      </p>
                      {backendExportable(c.id) ? (
                        <p
                          className={`truncate text-[11px] ${
                            check?.status === "verified"
                              ? "text-pepe"
                              : check?.status === "failed"
                                ? "text-signal"
                                : "text-muted-foreground"
                          }`}
                          title={check?.reason}
                        >
                          {check?.status === "verified"
                            ? "Browser alpha verified"
                            : check?.status === "failed"
                              ? `Browser check failed — ${check.reason}`
                              : check?.status === "checking"
                                ? "Checking in browser…"
                                : "Browser check pending"}
                        </p>
                      ) : null}
                      {backendExportable(c.id) && check?.status === "verified" ? (
                        <p
                          className={`truncate text-[11px] ${
                            check.cutout === "failed" ? "text-signal" : "text-pepe"
                          }`}
                          title={check.cutout === "failed" ? check.reason : undefined}
                        >
                          {check.cutout === "verified"
                            ? "Telegram cutout verified"
                            : check.cutout === "will_clean"
                              ? `Outer halo will be removed on export (${(check.removedPixels ?? 0).toLocaleString()} px)`
                              : `Telegram cutout failed — ${check.reason ?? "needs manual review"}`}
                        </p>
                      ) : null}
                      {isFailure(stage) && failure ? (
                        <p className="truncate text-[11px] text-signal" title={failure.body}>
                          {failure.title}
                        </p>
                      ) : null}
                      {attempts.attempts > 1 ? (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {attempts.attempts} attempts
                          {attempts.failed > 0 ? ` · ${attempts.failed} failed` : ""}
                          {attempts.lastFailure && stage === "ready"
                            ? ` · recovered after “${attempts.lastFailure}”`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    {isExportable(c.id) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto min-h-10"
                        disabled={checksRunning}
                        aria-label={`Download ${c.label} as PNG`}
                        onClick={() => void downloadOne(c.id, index)}
                      >
                        <Download className="size-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3 grid grid-cols-[5rem_1fr] gap-2">
                    <div>
                      <Label htmlFor={`${c.id}-review-emoji`} className="text-xs">
                        Emoji
                      </Label>
                      <Input
                        id={`${c.id}-review-emoji`}
                        className="mt-1.5 min-h-10"
                        value={c.emoji}
                        onChange={(e) => editConcept(c.id, { emoji: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`${c.id}-keywords`} className="text-xs">
                        Keywords
                      </Label>
                      <Input
                        id={`${c.id}-keywords`}
                        className="mt-1.5 min-h-10"
                        placeholder="comma, separated"
                        value={draft.keywords[c.id] ?? ""}
                        onChange={(e) =>
                          update({ keywords: { ...draft.keywords, [c.id]: e.target.value } })
                        }
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={saving}
              onClick={() => void persist()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save emoji &amp; keywords
            </Button>
          </div>

          <div className="mt-6">
            <TelegramConnectionCard setup={telegram} compact />
          </div>

          <div className="mt-6">
            <TelegramGroupCard
              setup={telegramGroup}
              personalConnected={telegram.ownerConnected}
              botConfigured={telegram.botConfigured}
            />
          </div>

          <Card className="cartel-panel mt-6">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Telegram publishing</CardTitle>
              {allPublished ? (
                <StatusBadge tone="green">Published</StatusBadge>
              ) : partiallyPublished ? (
                <StatusBadge tone="gold">Partly published</StatusBadge>
              ) : publishResult?.status === "failed" ? (
                <StatusBadge tone="red">Failed</StatusBadge>
              ) : (
                <StatusBadge tone="muted">Not published</StatusBadge>
              )}
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                {telegram.botConfigured ? (
                  <StatusBadge tone="green">Bot @{telegram.botUsername}</StatusBadge>
                ) : (
                  <StatusBadge tone="red">Bot not configured</StatusBadge>
                )}
                {telegram.ownerConnected ? (
                  <StatusBadge tone="green">Telegram account connected</StatusBadge>
                ) : (
                  <StatusBadge tone="red">Telegram account not connected</StatusBadge>
                )}
                {telegramGroup.connectedGroupCount === 0 ? (
                  <StatusBadge tone="red">No group connected</StatusBadge>
                ) : selectedGroupIds.length === 0 ? (
                  <StatusBadge tone="red">No distribution group selected</StatusBadge>
                ) : groupsSelectedAndReady ? (
                  <StatusBadge tone="green">
                    {selectedGroupIds.length} of {telegramGroup.connectedGroupCount} group
                    {telegramGroup.connectedGroupCount === 1 ? "" : "s"} selected
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="red">A selected group is not verified</StatusBadge>
                )}

                <StatusBadge tone={exportableCount > 0 ? "gold" : "muted"}>
                  {exportableCount} export-ready
                </StatusBadge>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2">
                <SummaryRow label="Sticker set title" value={draft.packName || "Not set"} />
                <SummaryRow
                  label="Pack status"
                  value={tgPack?.status ?? "draft"}
                />
                <SummaryRow
                  label="Published stickers"
                  value={`${tgPublishedCount} of ${draft.concepts.length}`}
                />
                <SummaryRow
                  label="Emoji assigned"
                  value={`${draft.concepts.filter((c) => c.emoji.trim()).length} of ${draft.concepts.length}`}
                />
              </dl>

              <p className="text-xs text-muted-foreground">
                Short name preview:{" "}
                <span className="font-mono text-foreground">
                  {tgPack?.telegram_set_name ?? shortNamePreview ?? "available once the bot is configured"}
                </span>
                . The authoritative set name is decided by the server at publish time. Stickers
                without an emoji fall back to 🐸.
              </p>

              {publishResult ? (
                <p className="text-xs text-muted-foreground">
                  {publishResult.published} of {publishResult.total} published
                  {publishResult.failed > 0 ? `, ${publishResult.failed} need retry` : ""}.
                </p>
              ) : null}

              {distResult ? (
                <p
                  className={`rounded-md border p-3 text-xs ${
                    distResult.failed > 0
                      ? "border-gold/40 bg-gold/5 text-muted-foreground"
                      : "border-pepe/40 bg-pepe/5 text-pepe"
                  }`}
                >
                  {distResult.total} group{distResult.total === 1 ? "" : "s"} updated:{" "}
                  {distResult.assigned} official set, {distResult.announced} announced,{" "}
                  {distResult.failed} failed.
                </p>
              ) : null}

              {distTargets.length > 0 || distResult ? (
                <ul className="space-y-2 text-xs">
                  {/* Durable per-group history is authoritative; the most recent
                      run only fills in before the persisted state has loaded. */}
                  {(distTargets.length > 0
                    ? distTargets.map((t) => ({
                        id: t.group_connection_id,
                        title:
                          telegramGroup.groups.find((g) => g.id === t.group_connection_id)?.title ??
                          "Connected group",
                        status: t.status,
                        detail: t.last_error,
                      }))
                    : (distResult?.results ?? []).map((r) => ({
                        id: r.groupConnectionId,
                        title: r.title,
                        status: r.status,
                        detail: r.message ?? r.reason ?? null,
                      }))

                  ).map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2"
                    >
                      <span className="font-medium text-foreground">{row.title}</span>
                      <StatusBadge
                        tone={
                          row.status === "assigned"
                            ? "green"
                            : row.status === "announced"
                              ? "gold"
                              : row.status === "failed"
                                ? "red"
                                : "muted"
                        }
                      >
                        {row.status === "assigned"
                          ? "Assigned as official group set"
                          : row.status === "announced"
                            ? "Pack announced in group"
                            : row.status === "failed"
                              ? "Failed — retry needed"
                              : row.status}
                      </StatusBadge>
                      {row.detail ? (
                        <span className="text-muted-foreground">{row.detail}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {distError ? (
                <p className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
                  Sticker set stays published — group distribution needs attention. {distError}
                </p>
              ) : null}


              {tgError ? (
                <p className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
                  {tgError}
                </p>
              ) : null}

              {publishResult?.failures?.length ? (
                <details className="rounded-md border border-border bg-surface-raised p-3 text-xs">
                  <summary className="cursor-pointer font-semibold">Technical detail</summary>
                  <ul className="mt-2 space-y-2 text-muted-foreground">
                    {publishResult.failures.map((f, i) => (
                      <li key={`${f.stickerId ?? i}`}>
                        <span className="text-foreground">{f.label ?? f.stickerId ?? "Sticker"}</span>
                        {f.message ? ` — ${f.message}` : ""}
                        {f.technical ? (
                          <span className="mt-1 block font-mono text-[11px] text-muted-foreground/80">
                            {f.technical}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {tgPublishedCount > 0 || Object.keys(tgStickers).length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {draft.concepts.map((c) => {
                    const id = stickerIdFor(c.id);
                    const row = id ? tgStickers[id] : undefined;
                    return (
                      <li key={c.id} className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground">{c.label}</span>
                        <span className="text-muted-foreground">
                          {row?.status === "published"
                            ? "Published to Telegram"
                            : row?.telegram_publish_error
                              ? `Failed — ${row.telegram_publish_error}`
                              : "Not published"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={allPublished || !canPublish}
                  onClick={() => (canRetryPublish ? void doPublish() : setConfirmPublish(true))}
                >
                  {publishing ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-4" aria-hidden="true" />
                  )}
                  {allPublished
                    ? "Published"
                    : canRetryPublish
                      ? "Retry failed stickers"
                      : "Publish sticker pack"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={!packId || tgRefreshing}
                  onClick={() => void doRefresh()}
                >
                  {tgRefreshing ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-4" aria-hidden="true" />
                  )}
                  Refresh Telegram status
                </Button>
                {tgPack?.telegram_set_url ? (
                  <Button asChild variant="outline" className="min-h-11">
                    <a href={tgPack.telegram_set_url} target="_blank" rel="noreferrer noopener">
                      Open sticker pack
                    </a>
                  </Button>
                ) : null}
                {allPublished ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={!canDistribute}
                    onClick={() => void doDistribute()}
                  >
                    {distributing ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {distError || distResult?.failed
                      ? "Retry distribution to selected groups"
                      : "Distribute to selected groups"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={tgPublishedCount === 0 || sendingTest || !testTargetGroup}
                  onClick={() => void doSendTest()}
                >
                  {sendingTest ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Send test sticker to group
                </Button>
              </div>

              {!testTargetGroup ? (
                <p className="text-xs text-muted-foreground">
                  Select exactly one group to send a test sticker.
                </p>
              ) : null}
              {canRetryPublish ? (
                <p className="text-xs text-muted-foreground">
                  Retrying only re-attempts stickers that are not published yet — the existing set is
                  not recreated.
                </p>
              ) : null}
              {testResult ? <p className="text-xs text-muted-foreground">{testResult}</p> : null}
              <p className="text-xs text-muted-foreground">
                One Telegram sticker set is created for this pack and then distributed to the groups
                you selected — connecting more groups later lets you distribute the same set again
                without recreating it. The test sends a <strong>native Telegram sticker</strong> into
                a single selected group, not an image file, and works for any verified connected
                group — basic group or supergroup. Telegram’s{" "}
                <strong>official group sticker set</strong> is separate and optional — it only
                exists for eligible supergroups; otherwise CARTEL HQ posts the pack link in the
                group instead. Installing the pack to a personal Telegram account stays a separate
                individual action.
              </p>
              {!canPublish && !publishing && !allPublished ? (
                <p className="text-xs text-muted-foreground">
                  Publishing needs: a configured bot, your connected Telegram account, at least one
                  selected and verified group or supergroup (bot admin + Change Group Info), at
                  least one export-ready sticker, and all browser/cutout checks finished.
                </p>
              ) : null}

            </CardContent>
          </Card>

          <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Publish this pack to Telegram?</AlertDialogTitle>
                <AlertDialogDescription>
                  <strong>One</strong> Telegram sticker set will be created for this pack, owned by
                  your connected Telegram account ({telegram.connection?.telegram_user_id}).{" "}
                  {reviewedStickerIds.length} reviewed sticker
                  {reviewedStickerIds.length === 1 ? "" : "s"} will be uploaded. Sets cannot be
                  transferred to another owner later.
                  <br />
                  <br />
                  {selectedGroupIds.length === 0 ? (
                    <>
                      No connected group is selected. Select at least one group above before
                      publishing and distributing.
                    </>
                  ) : (
                    <>
                      After the set is created it will be distributed once to the{" "}
                      <strong>
                        {selectedGroupIds.length} selected group
                        {selectedGroupIds.length === 1 ? "" : "s"}
                      </strong>
                      {selectedGroupNames.length <= 4 ? (
                        <> — {selectedGroupNames.join(", ")}</>
                      ) : null}{" "}
                      by sharing the pack link, or by assigning it as the official group sticker set
                      where Telegram permits (eligible supergroups only).
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={selectedGroupIds.length === 0}
                  onClick={() => {
                    setConfirmPublish(false);
                    void doPublish();
                  }}
                >
                  Publish &amp; distribute
                </AlertDialogAction>

              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </StepCard>
      ) : null}

      <nav
        aria-label="Builder navigation"
        className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={goBack}
          disabled={step === 1}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Step {step} of {BUILDER_STEPS.length} · {BUILDER_STEPS[step - 1]!.title}
        </p>
        {step < BUILDER_STEPS.length ? (
          <Button type="button" className="min-h-11" onClick={goNext}>
            Next
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/sticker-lab">Back to Sticker Lab</Link>
          </Button>
        )}
      </nav>
    </div>
  );
}

function Stepper({
  current,
  onSelect,
}: {
  current: number;
  onSelect: (n: number) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Builder steps">
      {BUILDER_STEPS.map((s) => {
        const state = s.id === current ? "current" : s.id < current ? "done" : "todo";
        return (
          <li key={s.id} className="min-w-0 flex-1 basis-[8rem]">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                state === "current"
                  ? "border-gold bg-gold/10 text-gold"
                  : state === "done"
                    ? "border-pepe/40 bg-surface-raised text-pepe"
                    : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
              }`}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold">
                {state === "done" ? <Check className="size-3" aria-hidden="true" /> : s.id}
              </span>
              <span className="truncate font-semibold uppercase tracking-[0.12em]">
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.title}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="cartel-panel rise-in">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle className="text-lg">{title}</CardTitle>
          <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Notice({ tone, children }: { tone: "muted" | "warn"; children: React.ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <p
      className={`flex gap-2 rounded-md border p-3 text-xs leading-relaxed ${
        tone === "warn"
          ? "border-signal/40 bg-signal/5 text-signal"
          : "border-border bg-background/40 text-muted-foreground"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Pipeline() {
  const stages = ["Generate", "Background Removal", "Transparency Check", "Ready"];
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-2" aria-label="Generation pipeline">
      {stages.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className="rounded-md border border-border bg-background/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {s}
          </span>
          {i < stages.length - 1 ? (
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "muted";
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        tone === "green"
          ? "border-pepe/40 bg-pepe/5"
          : tone === "red"
            ? "border-signal/40 bg-signal/5"
            : "border-border bg-background/40"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold ${
          tone === "green" ? "text-pepe" : tone === "red" ? "text-signal" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** Plain-English failure explanation plus the one action that actually helps. */
function FailureBlock({
  failure,
  replacement,
  onEditConcept,
}: {
  failure: ProviderFailure;
  replacement: boolean;
  onEditConcept: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-3 rounded-md border border-signal/40 bg-signal/5 p-3 text-[11px] leading-relaxed"
    >
      <p className="font-semibold text-signal">{failure.title}</p>
      <p className="mt-1 text-muted-foreground">{failure.body}</p>
      {replacement ? (
        <p className="mt-1 text-muted-foreground">
          Your previous sticker is still saved and unchanged.
        </p>
      ) : null}
      {failure.kind === "safety" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 min-h-9"
          onClick={onEditConcept}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit concept wording
        </Button>
      ) : null}
      {failure.raw ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Technical detail
          </summary>
          <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
            {failure.raw}
          </p>
        </details>
      ) : null}
    </div>
  );
}

