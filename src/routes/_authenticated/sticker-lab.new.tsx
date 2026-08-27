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
  friendlyProviderError,
  hydrateDraftFromPack,
  loadAssets,
  loadLatestJobs,
  loadPackStickers,
  persistDraft,
  type AiJobRow,
  type PersistResult,
  type StickerRow,
} from "@/lib/sticker-packs";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
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
    const pack = typeof search.pack === "string" ? search.pack.trim() : "";
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

type Preview = { url: string; transparencyValid: boolean };

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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [debugErrors, setDebugErrors] = useState<Record<string, string>>({});
  const [previews, setPreviews] = useState<Record<string, Preview>>({});
  const [confirmRemaining, setConfirmRemaining] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    retry: false,
    queryFn: fetchStickerAiConfig,
  });

  const packId = draft?.packId ?? null;

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
    const nextErrors: Record<string, string> = {};
    const nextNotes: Record<string, string> = {};
    const nextDebug: Record<string, string> = {};

    for (const row of rows) {
      const asset = row.image_asset_id ? assets[row.image_asset_id] : undefined;
      const url = asset ? urls[asset.storage_path] : undefined;
      const hasAsset = !!(asset && url);
      if (asset && url) {
        nextPreviews[row.id] = { url, transparencyValid: asset.transparency_valid === true };
      }
      // A locally polling sticker owns its own transient stage.
      if (pollingRef.current.has(row.id)) continue;

      const latest = jobs[row.id]?.[0];
      const isBackground = (latest?.job_type ?? "").toLowerCase().includes("background");

      if (latest && (latest.status === "queued" || latest.status === "running")) {
        nextStages[row.id] = isBackground ? "background" : "generating";
        nextErrors[row.id] = "";
      } else if (latest && latest.status === "failed") {
        nextStages[row.id] = hasAsset ? "replacement_failed" : "failed";
        nextErrors[row.id] = friendlyProviderError(latest.error_message, latest.job_type);
        if (isBackground) nextNotes[row.id] = "Background removal failed";
        if (latest.error_message) nextDebug[row.id] = latest.error_message;
      } else if (hasAsset) {
        nextStages[row.id] = "ready";
        nextErrors[row.id] = "";
      } else if (latest) {
        // Job finished without a stored asset — not a usable sticker.
        nextStages[row.id] = "failed";
        nextErrors[row.id] = "The last attempt finished without a stored image. Retry this sticker.";
      } else {
        nextStages[row.id] = "idle";
      }
    }

    setPreviews((p) => ({ ...p, ...nextPreviews }));
    setStages((s) => ({ ...s, ...nextStages }));
    setErrors((e) => ({ ...e, ...nextErrors }));
    setNotes((n) => ({ ...n, ...nextNotes }));
    setDebugErrors((d) => ({ ...d, ...nextDebug }));
  }, []);

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
      [stickerId]: { url, transparencyValid: asset.transparency_valid === true },
    }));
    return true;
  };

  /** Runs one sticker through the server pipeline. Only ever user initiated. */
  const runGeneration = async (conceptId: string, stickerId: string, packId: string) => {
    const hadPreview = !!previews[stickerId];
    setErrors((e) => ({ ...e, [stickerId]: "" }));
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
          setStages((s) => ({ ...s, [stickerId]: hadPreview ? "replacement_failed" : "failed" }));
          setErrors((e) => ({ ...e, [stickerId]: friendlyProviderError(res.error, res.stage) }));
          if (res.error) setDebugErrors((d) => ({ ...d, [stickerId]: res.error as string }));
          if ((res.stage ?? "").includes("background")) {
            setNotes((n) => ({ ...n, [stickerId]: "Background removal failed" }));
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
              setErrors((e) => ({
                ...e,
                [stickerId]: "The finished image could not be loaded from private storage.",
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
      setErrors((e) => ({
        ...e,
        [stickerId]: "Still running after 15 minutes. Use Refresh status later.",
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation could not start.";
      toast.error(message);
      setErrors((e) => ({ ...e, [stickerId]: message }));
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
  const generatedCount = draft.concepts.filter((c) => stageFor(c.id) === "ready").length;
  const remainingCount = draft.concepts.length - generatedCount;
  const configured = configQuery.data?.configured === true;

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

          {configQuery.isError ? (
            <div className="mt-4">
              <Notice tone="warn">
                Could not reach the generation service. Try “Refresh status”.
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

          {configured ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                type="button"
                className="min-h-11"
                disabled={anyBusy || saving || generatedCount > 0 || draft.concepts.length === 0}
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
            </div>
          ) : null}

          <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {draft.concepts.map((c) => {
              const stage = stageFor(c.id);
              const stickerId = stickerIdFor(c.id);
              const preview = stickerId ? previews[stickerId] : undefined;
              const error = stickerId ? errors[stickerId] : undefined;
              const note = stickerId ? notes[stickerId] : undefined;
              const debug = stickerId ? debugErrors[stickerId] : undefined;
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
                  {note ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>
                  ) : null}
                  {error ? (
                    <p role="alert" title={debug || undefined} className="mt-2 text-[11px] text-signal">
                      {error}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant={preview ? "outline" : "default"}
                    className="mt-3 min-h-10 w-full"
                    disabled={!configured || busy(stage) || saving}
                    onClick={() => void generateOne(c.id)}
                  >
                    {busy(stage) ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {isFailure(stage) ? "Retry" : preview ? "Regenerate" : "Generate"}
                  </Button>
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
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {draft.concepts.map((c) => {
              const stickerId = stickerIdFor(c.id);
              const preview = stickerId ? previews[stickerId] : undefined;
              const stage = stageFor(c.id);
              const error = stickerId ? errors[stickerId] : undefined;
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
                              ? "Transparency verified"
                              : "Transparency not verified"
                          : STAGE_LABEL[stage]}
                      </p>
                      {isFailure(stage) && error ? (
                        <p className="truncate text-[11px] text-signal" title={error}>
                          {error}
                        </p>
                      ) : null}
                    </div>
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

          <Card className="cartel-panel mt-6">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Telegram publish summary</CardTitle>
              <StatusBadge tone="muted">Not connected</StatusBadge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <SummaryRow label="Pack name" value={draft.packName || "Not set"} />
                <SummaryRow label="Stickers" value={`${draft.concepts.length}`} />
                <SummaryRow
                  label="Generated"
                  value={`${generatedCount} of ${draft.concepts.length}`}
                />
                <SummaryRow
                  label="Emoji assigned"
                  value={`${draft.concepts.filter((c) => c.emoji.trim()).length} of ${draft.concepts.length}`}
                />
              </dl>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Requirements for a future publish
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  <li>Transparent PNG per sticker at Telegram's required dimensions</li>
                  <li>One emoji minimum per sticker</li>
                  <li>An authorised CARTEL HQ Telegram connection</li>
                </ul>
              </div>
              <Button type="button" disabled className="min-h-11 w-full sm:w-auto">
                <Send className="size-4" aria-hidden="true" />
                Telegram publishing arrives in a later phase
              </Button>
            </CardContent>
          </Card>
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
