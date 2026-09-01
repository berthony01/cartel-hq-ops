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
import { fetchStickerAiConfig } from "@/lib/sticker-ai";
import {
  fetchStickerConceptConfig,
  suggestStickerConcepts,
  type SuggestedConcept,
} from "@/lib/sticker-concepts";
import {
  isCandidateVersionOrigin,
  isVariationVersionOrigin,
  loadStickerVersions,
  setCurrentStickerVersion,
  type SetCurrentVersionStatus,
} from "@/lib/sticker-versions";



import {
  STAGE_LABEL,
  useStickerGenerationRuntime,
  type Stage,
} from "@/hooks/useStickerGenerationRuntime";
import { deriveReviewState, useStickerReviewRuntime } from "@/hooks/useStickerReviewRuntime";
import {
  CANDIDATE_STAGE_LABEL,
  isCandidateBusy,
  usePublishedStickerCandidateRuntime,
} from "@/hooks/usePublishedStickerCandidateRuntime";
import {
  VARIATION_STAGE_LABEL,
  isVariationBusy,
  useStickerVariationRuntime,
} from "@/hooks/useStickerVariationRuntime";

import {
  hydrateDraftFromPack,
  persistDraft,
  summarizeAttempts,
  type PersistResult,
} from "@/lib/sticker-packs";
import {
  downloadStickerPng,
  downloadStickersZip,
  packZipName,
  stickerFileName,
  
} from "@/lib/sticker-export";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CircleCheck,
  Copy,
  Download,
  FileArchive,
  ImagePlus,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import {
  loadPackTelegramState,
  previewShortName,
  publishPack,
  refreshPackStatus,
  replacePublishedStickerVersion,
  telegramErrorMessage,
  type PackTelegramState,
  type StickerTelegramState,
  type TelegramPublishResult,
} from "@/lib/telegram-stickers";

import { useTelegramSetup } from "@/components/cartel/TelegramConnectionCard";
import { useTelegramGroupSetup } from "@/components/cartel/TelegramGroupCard";
import {
  MAX_DISTRIBUTION_TARGETS,
  distributePackToGroups,
  fetchPackGroupDistribution,
  sendGroupTestSticker,
  type TelegramDistributePackResult,
  type TelegramPackGroupTarget,
} from "@/lib/telegram-group";
import { fetchDropStatus } from "@/lib/sticker-drops";
import { PageHeader } from "@/components/cartel/PageHeader";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { StickyActionBar } from "@/components/cartel/StickyActionBar";
import {
  FailureBlock,
  Notice,
  Pipeline,
  StepCard,
  Stepper,
  SummaryRow,
  SummaryStat,
} from "@/components/sticker-lab/BuilderPrimitives";
import { StepGuide } from "@/components/sticker-lab/StickerLabJourney";
import { MotionStudioPanel } from "@/components/sticker-lab/MotionStudioPanel";
import { loadStickerMotionState } from "@/lib/sticker-motion";
import { Checkbox } from "@/components/ui/checkbox";


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
  HUMOR_LEVELS,
  INTENSITY_LEVELS,
  MAX_REFERENCES,
  PACK_SIZES,
  PACK_THEMES,
  TEXT_PREFERENCES,
  loadDraft,
  parseDirectionList,
  saveDraft,
  starterConcepts,
  type BuilderDraft,
  type Concept,
  type CreativeDirection,
  type PackSize,
  type PackTheme,
  type CreativeBlueprint,
} from "@/lib/sticker-lab";

import { supabase } from "@/integrations/supabase/client";
import { readCharacterLock, hasCharacterLockContent } from "@/lib/brand-kit";

type BuilderSearch = { pack?: string; step?: number };

const humorLabel = (v: CreativeDirection["humorLevel"]) =>
  v === "unspecified"
    ? "Not specified"
    : v === "none"
      ? "None"
      : v === "light"
        ? "Light"
        : v === "balanced"
          ? "Balanced"
          : "Heavy";

const intensityLabel = (v: CreativeDirection["intensity"]) =>
  v === "unspecified"
    ? "Not specified"
    : v === "calm"
      ? "Calm"
      : v === "balanced"
        ? "Balanced"
        : v === "high"
          ? "High"
          : "Maximum";

const textPreferenceLabel = (v: CreativeDirection["textPreference"]) =>
  v === "unspecified"
    ? "Not specified"
    : v === "no_text"
      ? "No text"
      : v === "minimal"
        ? "Minimal text"
        : v === "balanced"
          ? "Balanced"
          : "Text-forward";

/** Accessible segmented choice used by the V2 Creative Direction panel. */
function SegmentedChoice<T extends string>({
  legend,
  options,
  label,
  value,
  onSelect,
}: {
  legend: string;
  options: readonly T[];
  label: (v: T) => string;
  value: T;
  onSelect: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onSelect(option)}
            className={`min-h-10 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              value === option
                ? "border-gold bg-gold/10 text-gold"
                : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
            }`}
          >
            {label(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}


export const Route = createFileRoute("/_authenticated/sticker-lab/new")({
  validateSearch: (search: Record<string, unknown>): BuilderSearch => {
    const raw = search["pack"];
    const pack = typeof raw === "string" ? raw.trim() : "";
    // Optional deep-link into a specific builder step. Anything unusable is
    // dropped so existing `?pack=<id>` links behave exactly as before.
    const rawStep = search["step"];
    const parsed =
      typeof rawStep === "number"
        ? rawStep
        : typeof rawStep === "string"
          ? Number.parseInt(rawStep, 10)
          : Number.NaN;
    const step =
      Number.isInteger(parsed) && parsed >= 1 && parsed <= BUILDER_STEPS.length ? parsed : undefined;
    if (pack && step) return { pack, step };
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

/** Action-scoped signed URL lifetime (seconds) for verify/download only. */
const ACTION_URL_TTL = 300;

const CHECKERBOARD: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.08) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
};


function StickerLabBuilder() {
  const { workspaceId, workspace } = useWorkspace();
  const projectName = workspace?.name ?? "this project";
  const { user } = useSession();
  const { pack: urlPackId, step: urlStep } = Route.useSearch();
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

  /* ------- Step 3 AI Concept Studio (text only, never image generation) ------ */
  const [preview, setPreview] = useState<{
    mode: "board" | "alternatives";
    items: Array<{ targetId: string; suggestion: SuggestedConcept; applied: boolean }>;
  } | null>(null);
  const [selectedForAlternatives, setSelectedForAlternatives] = useState<string[]>([]);
  const [conceptError, setConceptError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [confirmSuggest, setConfirmSuggest] = useState<"board" | "alternatives" | null>(null);
  /** Concept ids a confirmed "Suggest another set" must re-target (alternatives only). */
  const [refreshTargetIds, setRefreshTargetIds] = useState<string[] | null>(null);
  const [confirmApplySuggestions, setConfirmApplySuggestions] = useState(false);
  /** Preview target ids awaiting saved-pack confirmation (one item or all). */
  const [pendingApplyTargetIds, setPendingApplyTargetIds] = useState<string[] | null>(null);

  /**
   * Existing generation runtime (stages, structured failures, notes, previews,
   * durable ai_jobs history, polling ownership, reconciliation and the
   * single-sticker pipeline). Behaviour is unchanged — it simply no longer
   * lives inline in this route.
   */
  const {
    stages,
    setStages,
    failures,
    notes,
    previews,
    jobHistory,
    aliveRef,
    pollingRef,
    loadExisting,
    runGeneration,
    isTelegramLocked,
  } = useStickerGenerationRuntime({
    workspaceId,
    referenceAssetIds: draft?.referenceAssetIds ?? [],
  });

  /**
   * Phase 4D.2 — published candidate runtime. Fully separate store: it never
   * writes current-image stages, previews or failures, and `start_candidate` is
   * only reachable from the confirmed dialog handler below.
   */
  const {
    candidateFailures,
    candidateReadySignal,
    startCandidate,
    recoverCandidates,
    clearCandidateState,
    candidateStageFor,
  } = usePublishedStickerCandidateRuntime({
    workspaceId,
    referenceAssetIds: draft?.referenceAssetIds ?? [],
  });
  /** Sticker awaiting the explicit 2-task candidate confirmation. */
  const [candidateConfirm, setCandidateConfirm] = useState<{
    stickerId: string;
    label: string;
  } | null>(null);

  /**
   * A/B/C Variations runtime. Another fully separate store: variations are
   * review-only, never touch the current image, sticker status or Telegram, and
   * `start_variation` is only reachable from the confirmed dialog handler below.
   */
  const {
    variationReadySignal,
    startVariationRound,
    cancelVariationRound,
    recoverVariations,
    clearVariationState,
    variationRoundFor,
  } = useStickerVariationRuntime({
    workspaceId,
    referenceAssetIds: draft?.referenceAssetIds ?? [],
  });
  /** Sticker awaiting the explicit 6-task A/B/C confirmation. */
  const [variationConfirm, setVariationConfirm] = useState<{
    stickerId: string;
    label: string;
  } | null>(null);


  const [confirmRemaining, setConfirmRemaining] = useState(false);
  /**
   * Sticker Studio selective generation. Editor-only local state: never
   * persisted, never sent to the server, and always re-validated against live
   * sticker state immediately before any provider work starts.
   */
  const [selectedForGeneration, setSelectedForGeneration] = useState<string[]>([]);
  const [confirmSelectedBatch, setConfirmSelectedBatch] = useState(false);
  const [exporting, setExporting] = useState(false);
  /**
   * Existing browser-side review/quality runtime (local transparency checks,
   * Telegram-cutout analysis, progress and the forced/non-forced verification
   * pass). Behaviour is unchanged — it simply no longer lives inline here.
   */
  const { clientChecks, checkProgress, checksRunning, runClientVerification } =
    useStickerReviewRuntime({ previews, aliveRef });

  const fileInputRef = useRef<HTMLInputElement>(null);



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
            "That pack could not be found in this project. It may belong to another project, or the link is wrong. Nothing was created or changed.",
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


  /**
   * Deep link support: `?pack=<id>&step=5` opens Review & Telegram for that pack
   * once it has hydrated. Applied once so the user can still navigate freely.
   */
  const deepStepRef = useRef(false);
  useEffect(() => {
    if (deepStepRef.current) return;
    if (!urlStep || !urlPackId) return;
    if (!draft || draft.packId !== urlPackId) return;
    deepStepRef.current = true;
    setStep(urlStep);
  }, [urlStep, urlPackId, draft]);

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

  /**
   * Read-only Brand Kit Character Lock. Free metadata read — never a
   * generation call, and it never touches `referenceAssetIds`.
   */
  const characterLockQuery = useQuery({
    queryKey: ["brand-kit-character-lock", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_kits")
        .select("metadata")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return readCharacterLock(data?.metadata);
    },
  });
  const brandLock = characterLockQuery.data ?? null;
  const brandLockActive = !!brandLock?.enabled;

  /**
   * Concept-suggestion provider status. Free probe: it never contacts the
   * language model and spends nothing. Only runs while Step 3 is visible.
   */
  const conceptConfigQuery = useQuery({
    queryKey: ["sticker-concepts-config"],
    enabled: step === 3,
    staleTime: 300_000,
    retry: 0,
    refetchOnWindowFocus: false,
    queryFn: fetchStickerConceptConfig,
  });
  const conceptsConfigured = conceptConfigQuery.data?.configured === true;


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

  /**
   * Read-only image history for saved stickers (Step 4 only). The key carries
   * the current preview storage paths, so once a successful generation swaps
   * the current image the trigger-captured version is picked up automatically.
   * No provider calls are involved.
   */
  const savedStickerIds = Object.values(draft?.stickerIds ?? {}).filter(Boolean);
  const previewFingerprint = savedStickerIds
    .map((id) => `${id}:${previews[id]?.storagePath ?? ""}`)
    .join("|");
  const versionsQuery = useQuery({
    // `candidateReadySignal` bumps when a candidate finishes so the durable
    // candidate row appears without any manual refresh.
    queryKey: [
      "sticker-versions",
      draft?.packId ?? "",
      previewFingerprint,
      candidateReadySignal,
      variationReadySignal,
    ],
    enabled: !!draft && step === 4 && savedStickerIds.length > 0,
    queryFn: () => loadStickerVersions(savedStickerIds),
  });
  const versionsBySticker = versionsQuery.data ?? {};

  /**
   * Read-only motion state for saved stickers (Step 4 only). One batched read
   * of durable `stickers` pointers plus `sticker_motion_versions` rows. No
   * writes, no RPCs, no provider or Telegram involvement.
   */
  const motionStickerKey = [...savedStickerIds].sort().join(",");
  const motionQuery = useQuery({
    queryKey: ["sticker-motion", draft?.packId ?? "", motionStickerKey],
    enabled: !!draft && step === 4 && savedStickerIds.length > 0,
    queryFn: () => loadStickerMotionState(savedStickerIds),
  });
  const motionBySticker = motionQuery.data ?? {};



  /**
   * Read-only candidate recovery for Step 4. Resumes polling of in-flight
   * candidate jobs from existing `ai_jobs` rows; it can never call
   * `start_candidate` and therefore never creates a provider task.
   */
  const candidateRecoveryKey =
    step === 4 && draft?.packId ? `${draft.packId}:${savedStickerIds.join(",")}` : "";
  useEffect(() => {
    if (!candidateRecoveryKey) return;
    const [packId, ids] = [
      candidateRecoveryKey.slice(0, candidateRecoveryKey.indexOf(":")),
      candidateRecoveryKey.slice(candidateRecoveryKey.indexOf(":") + 1),
    ];
    const stickerIds = ids.split(",").filter(Boolean);
    if (stickerIds.length === 0) return;
    void recoverCandidates(packId, stickerIds);
    // Variation recovery is read-only for the same reason: it inspects existing
    // `ai_jobs` rows and never starts a new billable round.
    void recoverVariations(packId, stickerIds);
  }, [candidateRecoveryKey, recoverCandidates, recoverVariations]);

  /**
   * Phase 4B restore state. Declared with the other top-level hooks, ABOVE every
   * conditional return, so hook order can never change between renders.
   */
  type RestoreTarget = {
    stickerId: string;
    versionId: string;
    versionNumber: number;
    label: string;
  };
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const [restoreTelegramTarget, setRestoreTelegramTarget] = useState<RestoreTarget | null>(null);
  const [restoringStickerId, setRestoringStickerId] = useState<string | null>(null);




  const packId = draft?.packId ?? null;

  /* ---------------- Telegram publishing (Step 5, explicit clicks only) --------------- */
  const telegram = useTelegramSetup(step === 5);
  const telegramGroup = useTelegramGroupSetup(step === 5);
  const [distributing, setDistributing] = useState(false);
  const [distError, setDistError] = useState<string | null>(null);
  const [distResult, setDistResult] = useState<TelegramDistributePackResult | null>(null);
  const [distTargets, setDistTargets] = useState<TelegramPackGroupTarget[]>([]);

  /**
   * Sticker Drops for THIS pack. Read-only reuse of the same workspace status
   * endpoint the Distribution Center uses — no new server behaviour.
   */
  const dropStatusQuery = useQuery({
    queryKey: ["sticker-drops", workspaceId],
    enabled: !!workspaceId && step === 5,
    queryFn: () => fetchDropStatus(workspaceId!),
  });
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
    }
  }, [step, packId, loadTelegramState]);

  // Distribution history exists only once the pack has an actual Telegram set.
  // Querying `distribution_status` for an unpublished pack is not applicable and
  // previously surfaced a background Edge Function error to the user.
  const telegramSetPublished = !!tgPack?.telegram_set_url || !!tgPack?.telegram_set_name;

  useEffect(() => {
    if (step === 5 && packId && telegramSetPublished) {
      void loadDistribution(packId);
    }
  }, [step, packId, telegramSetPublished, loadDistribution]);







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
      setFileError("Select or add a project before uploading a reference.");
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
      toast.success("Reference stored privately in this project");
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

  const blueprint = draft.creativeBlueprint;
  const packLockSnapshot = blueprint.characterLock;

  /**
   * Character Lock toggle. Snapshots the Brand Kit lock into a draft that has
   * none yet; an already-saved pack keeps its own snapshot untouched. Turning
   * it off preserves the snapshot. Generation ignores both in this phase and
   * `referenceAssetIds` is never modified here.
   */
  const toggleUseCharacterLock = (next: boolean) => {
    const blueprintNext: CreativeBlueprint = {
      ...blueprint,
      version: 1,
      useBrandCharacterLock: next,
      characterLock:
        next && !packLockSnapshot && brandLockActive ? brandLock : packLockSnapshot,
    };
    update({ creativeBlueprint: blueprintNext });
  };

  const direction = blueprint.creativeDirection;
  const updateDirection = (patch: Partial<CreativeDirection>) =>
    update({
      creativeBlueprint: {
        ...blueprint,
        creativeDirection: { ...direction, ...patch },
      },
    });


  /**
   * Every material concept change flows through here so the local
   * "concept board ready" flag can never survive a content mutation.
   * `clearKeywordsFor` clears keyword metadata for exactly the concept ids
   * whose content actually changed. `stickerIds` is never touched.
   */
  const mutateConcepts = (concepts: Concept[], clearKeywordsFor?: string[]) => {
    let keywords = draft.keywords;
    if (clearKeywordsFor?.length) {
      keywords = { ...draft.keywords };
      for (const id of clearKeywordsFor) delete keywords[id];
    }
    update({ concepts, keywords, conceptBoardApproved: false });
  };

  const setTheme = (theme: PackTheme) =>
    update({
      theme,
      concepts: starterConcepts(theme, draft.size),
      keywords: {},
      conceptBoardApproved: false,
    });

  const setSize = (size: PackSize) => {
    const next =
      size <= draft.concepts.length
        ? draft.concepts.slice(0, size)
        : [
            ...draft.concepts,
            ...starterConcepts(draft.theme, size)
              .slice(draft.concepts.length)
              .map((c, i) => ({ ...c, id: `c${Date.now()}-${i}` })),
          ];
    update({ size, concepts: next, conceptBoardApproved: false });
  };

  const editConcept = (id: string, patch: Partial<Concept>) =>
    mutateConcepts(draft.concepts.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  /** Lock/unlock does not change concept content, so it never resets approval. */
  const toggleConceptLock = (id: string) => {
    const locking = !draft.concepts.find((c) => c.id === id)?.locked;
    update({
      concepts: draft.concepts.map((c) => (c.id === id ? { ...c, locked: !c.locked } : c)),
    });
    if (locking) setSelectedForAlternatives((s) => s.filter((x) => x !== id));
  };

  const removeConcept = (id: string) => {
    mutateConcepts(
      draft.concepts.filter((c) => c.id !== id),
      [id],
    );
    setSelectedForAlternatives((s) => s.filter((x) => x !== id));
    setPreview((p) =>
      p ? { ...p, items: p.items.filter((item) => item.targetId !== id) } : p,
    );
  };

  const moveConcept = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.concepts.length) return;
    const next = [...draft.concepts];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    // Ids travel with the object, so keywords and stickerIds stay associated.
    update({ concepts: next, conceptBoardApproved: false });
  };

  const duplicateConcept = (id: string) => {
    if (draft.concepts.length >= draft.size) return;
    const index = draft.concepts.findIndex((c) => c.id === id);
    const source = draft.concepts[index];
    if (!source) return;
    const copy: Concept = {
      id: `d${Date.now()}`,
      label: source.label,
      action: source.action,
      emoji: source.emoji,
      locked: false,
    };
    const next = [...draft.concepts];
    next.splice(index + 1, 0, copy);
    update({ concepts: next, conceptBoardApproved: false });
  };

  const addConcept = () => {
    if (draft.concepts.length >= draft.size) return;
    mutateConcepts([
      ...draft.concepts,
      {
        id: `c${Date.now()}`,
        label: "NEW CONCEPT",
        action: "describe the pose or expression",
        emoji: "⭐",
      },
    ]);
  };

  const unlockedConcepts = draft.concepts.filter((c) => !c.locked);
  const selectedConcepts = draft.concepts.filter(
    (c) => !c.locked && selectedForAlternatives.includes(c.id),
  );

  /**
   * ONE explicit, confirmed language-model request. It never calls
   * `sticker-ai`, never starts image generation, never saves the pack and
   * never touches persisted sticker rows. On any failure the current concepts
   * stay exactly as they are.
   */
  const runConceptSuggestion = async (
    mode: "board" | "alternatives",
    targetIds?: string[] | null,
  ) => {
    if (!workspaceId) {
      toast.error("Select a project first.");
      return;
    }
    let targets: Concept[];
    if (mode === "alternatives") {
      if (targetIds && targetIds.length > 0) {
        // Explicit "Suggest another set" refresh: the supplied ids are the
        // authoritative target SET. Resolve them by filtering the current board
        // so the result follows the CURRENT board order. Abort if any id is
        // missing, duplicated, or locked — without contacting the provider or
        // touching the existing preview.
        const requestedIds = new Set(targetIds);
        const ordered = draft.concepts.filter((c) => requestedIds.has(c.id));
        if (
          requestedIds.size !== targetIds.length ||
          ordered.length !== targetIds.length ||
          ordered.some((c) => c.locked)
        ) {
          toast.message(
            "The preview targets changed. Unlock/restore them or request new alternatives.",
          );
          return;
        }
        targets = ordered;
      } else {
        // First-time alternatives request: use the user's current selection.
        targets = selectedConcepts;
      }
    } else {
      targets = unlockedConcepts;
    }
    if (!targets.length) return;
    setSuggesting(true);
    setConceptError(null);
    try {
      const result = await suggestStickerConcepts({
        workspaceId,
        size: draft.size,
        targetCount: targets.length,
        mode,
        focusConcepts:
          mode === "alternatives"
            ? targets.map((c) => ({ label: c.label, action: c.action }))
            : [],
        characterName: draft.characterName,
        theme: draft.theme,
        brief: draft.brief,
        styleNotes: draft.styleNotes,
        creativeBlueprint: draft.creativeBlueprint,
        concepts: draft.concepts.map((c) => ({ label: c.label, action: c.action })),
      });
      setPreview({
        mode,
        items: result.concepts.map((suggestion, i) => ({
          targetId: targets[i]!.id,
          suggestion,
          applied: false,
        })),
      });
      toast.success(`${result.concepts.length} concept suggestions ready to review.`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not get concept suggestions.";
      // Keep any existing preview intact so a failed refresh never loses ideas.
      setConceptError(message);
      toast.error(message);
    } finally {
      setSuggesting(false);
    }
  };

  /**
   * Applies preview items to the LOCAL draft only. Concept ids and positions
   * are preserved, so `stickerIds` stays valid and only the keywords of the
   * concepts that actually changed are cleared. Locked concepts are untouched.
   */
  const applyPreviewItems = (targetIds: string[]) => {
    const current = preview;
    if (!current) return;
    const byTarget = new Map(
      current.items
        .filter((item) => !item.applied && targetIds.includes(item.targetId))
        .map((item) => [item.targetId, item.suggestion]),
    );
    if (!byTarget.size) return;

    const changed: string[] = [];
    const concepts = draft.concepts.map((c) => {
      const suggestion = byTarget.get(c.id);
      if (!suggestion || c.locked) return c;
      changed.push(c.id);
      return { ...c, label: suggestion.label, action: suggestion.action, emoji: suggestion.emoji };
    });
    mutateConcepts(concepts, changed);

    const remaining = current.items.map((item) =>
      changed.includes(item.targetId) ? { ...item, applied: true } : item,
    );
    setPreview(remaining.every((item) => item.applied) ? null : { ...current, items: remaining });
    setConfirmApplySuggestions(false);
    setPendingApplyTargetIds(null);
    if (current.mode === "alternatives") {
      setSelectedForAlternatives((s) => s.filter((id) => !changed.includes(id)));
    }
    toast.success("Suggestions applied to your draft. Review and edit before saving.");
  };

  const pendingPreviewItems = preview?.items.filter((item) => !item.applied) ?? [];

  const conceptAt = (id: string) => draft.concepts.find((c) => c.id === id) ?? null;

  const boardReadyEligible =
    draft.concepts.length === draft.size &&
    draft.concepts.every((c) => c.label.trim() && c.action.trim());




  /** Persists pack + concepts. Never triggers a provider call. */
  const persist = async (): Promise<PersistResult | null> => {
    if (!workspaceId || !user) {
      toast.error("Select a project first.");
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

  /** Phase 4C — friendly, non-provider blocked copy. Nothing is charged. */
  const TELEGRAM_LOCK_MESSAGE =
    "This sticker is already connected to Telegram. Regeneration is locked so CARTEL HQ stays synchronized with the live Telegram set. Use Version history to restore an existing version.";

  const generateOne = async (conceptId: string) => {
    // Hard fail-closed guard against stale UI state in the same render.
    if (conceptTelegramLocked(conceptId)) {
      toast.message("Live on Telegram", { description: TELEGRAM_LOCK_MESSAGE });
      return;
    }
    // A per-card action supersedes any pending batch entry for that sticker.
    setSelectedForGeneration((prev) => prev.filter((id) => id !== conceptId));
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
    if (isTelegramLocked(stickerId)) {
      toast.message("Live on Telegram", { description: TELEGRAM_LOCK_MESSAGE });
      return;
    }
    await runGeneration(conceptId, stickerId, result.packId);
  };

  const generateRemaining = async () => {
    setConfirmRemaining(false);
    setSelectedForGeneration([]);
    const result = await persist();
    if (!result) return;
    for (const concept of draft.concepts) {
      const stickerId = result.stickerIds[concept.id];
      if (!stickerId) continue;
      if (stages[stickerId] === "ready" || previews[stickerId]) continue;
      // Telegram-locked stickers are never regenerated by a batch.
      if (isTelegramLocked(stickerId)) continue;
      // eslint-disable-next-line no-await-in-loop
      await runGeneration(concept.id, stickerId, result.packId);
      if (!aliveRef.current) return;
    }
  };



  /** Reconciles provider config AND durable sticker/job state. Never generates. */
  const refreshStatus = () => {
    void configQuery.refetch();
    if (step === 4 && savedStickerIds.length > 0) void versionsQuery.refetch();
    const id = draft.packId;
    if (id) void loadExisting(id);
    // Read-only forced candidate reconciliation. Never starts provider work.
    if (step === 4 && id && savedStickerIds.length > 0) {
      void recoverCandidates(id, savedStickerIds, { force: true });
      // Same contract for variation rounds: reconcile only, never re-run.
      void recoverVariations(id, savedStickerIds, { force: true });
    }
  };

  /* ---------------- Phase 4B: set current / restore version ---------------- */

  /** Re-reads durable sticker state and history. Never assumes local success. */
  const reconcileAfterRestore = async () => {
    const id = draft.packId;
    if (id) await loadExisting(id);
    await versionsQuery.refetch();
  };

  const RESTORE_MESSAGE: Record<Exclude<SetCurrentVersionStatus, "switched" | "telegram_required">, string> = {
    unchanged: "That version is already the current sticker image.",
    active_generation:
      "This sticker is still generating. Wait for it to finish before restoring a version.",
    version_unavailable: "That version is no longer available for this sticker.",
    asset_not_ready: "That version's image is not transparency-verified and cannot be used.",
    forbidden: "You do not have access to change this sticker.",
    sticker_not_found: "This sticker could not be found.",
    unauthenticated: "Your session expired. Sign in again.",
    unknown: "That version could not be restored. Refresh the status and try again.",
  };

  /** First confirmation accepted. Server decides whether Telegram is involved. */
  const confirmRestore = async (target: RestoreTarget) => {
    setRestoreTarget(null);
    setRestoringStickerId(target.stickerId);
    try {
      const result = await setCurrentStickerVersion({
        stickerId: target.stickerId,
        versionId: target.versionId,
      });
      if (result.status === "telegram_required") {
        setRestoreTelegramTarget(target);
        return;
      }
      if (result.status === "switched") {
        await reconcileAfterRestore();
        // Durable reconciliation succeeded: stale candidate badge is no longer true.
        clearCandidateState(target.stickerId);
        clearVariationState(target.stickerId);
        toast.success(`Version ${target.versionNumber} is now the current image.`);
        return;
      }
      if (result.status === "unchanged") {
        // Not a failure: durable state already matches the requested version.
        await reconcileAfterRestore();
        clearCandidateState(target.stickerId);
        clearVariationState(target.stickerId);
        toast.message(result.message || RESTORE_MESSAGE.unchanged);
        return;
      }
      toast.error(result.message || RESTORE_MESSAGE[result.status]);

    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "That version could not be restored right now.",
      );
    } finally {
      if (aliveRef.current) setRestoringStickerId(null);
    }
  };

  /** Second confirmation accepted. Replaces the sticker in place on Telegram. */
  const confirmTelegramRestore = async (target: RestoreTarget) => {
    setRestoreTelegramTarget(null);
    if (!workspaceId || !draft.packId) {
      toast.error("Select a project first.");
      return;
    }
    setRestoringStickerId(target.stickerId);
    try {
      const result = await replacePublishedStickerVersion({
        workspaceId,
        packId: draft.packId,
        stickerId: target.stickerId,
        versionId: target.versionId,
      });
      await reconcileAfterRestore();
      // Only after durable reconciliation of the Telegram replacement.
      clearCandidateState(target.stickerId);
      clearVariationState(target.stickerId);
      if (result.status === "switched") {
        toast.success(
          result.telegramReplaced
            ? `Version ${target.versionNumber} replaced the live sticker in the existing Telegram set.`
            : `Version ${target.versionNumber} is now the current image.`,
        );
      } else {
        toast.message(result.message || "That version is already the current sticker image.");
      }
    } catch (err) {
      toast.error(telegramErrorMessage(err));
    } finally {
      if (aliveRef.current) setRestoringStickerId(null);
    }
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

  /**
   * Phase 4C — published mutation safety. A concept whose durable sticker row
   * carries ANY Telegram footprint (file id or published timestamp) can never
   * start a paid regeneration from Sticker Studio. Derived purely from the
   * generation runtime's durable read — no second Telegram query here.
   */
  const conceptTelegramLocked = (conceptId: string) =>
    isTelegramLocked(stickerIdFor(conceptId));

  /**
   * Sticker Studio bulk eligibility. Deliberately conservative: a sticker that
   * is busy, already ready, still holds a valid preview, or is live on Telegram
   * can NEVER be part of a batch, so a good sticker cannot be replaced by
   * accident. Those keep their explicit per-card action instead.
   */
  const bulkSelectable = (conceptId: string) => {
    const stage = stageFor(conceptId);
    if (busy(stage)) return false;
    if (stage === "ready") return false;
    if (conceptTelegramLocked(conceptId)) return false;
    const id = stickerIdFor(conceptId);
    if (id && previews[id]) return false;
    return true;
  };


  const anyBusy = draft.concepts.some((c) => busy(stageFor(c.id)));
  // Selection is pruned on every render: anything that became ready, got a
  // preview or started running silently drops out of the batch.
  const selectableConcepts = draft.concepts.filter((c) => bulkSelectable(c.id));
  const selectableIds = selectableConcepts.map((c) => c.id);
  const effectiveSelected = selectableConcepts.filter((c) =>
    selectedForGeneration.includes(c.id),
  );
  const selectedCount = effectiveSelected.length;
  const clearSelection = () => setSelectedForGeneration([]);
  const toggleSelected = (conceptId: string, next: boolean) =>
    setSelectedForGeneration((prev) =>
      next
        ? prev.includes(conceptId)
          ? prev
          : [...prev, conceptId]
        : prev.filter((id) => id !== conceptId),
    );
  const readyConcepts = draft.concepts.filter((c) => stageFor(c.id) === "ready");
  const generatedCount = readyConcepts.length;
  // Telegram-locked stickers are never part of a "remaining" or "retry" run.
  const remainingConcepts = draft.concepts.filter(
    (c) =>
      stageFor(c.id) !== "ready" &&
      !previews[stickerIdFor(c.id) ?? ""] &&
      !conceptTelegramLocked(c.id),
  );
  const remainingCount = remainingConcepts.length;
  const failedConcepts = draft.concepts.filter(
    (c) => isFailure(stageFor(c.id)) && !conceptTelegramLocked(c.id),
  );
  const failedCount = failedConcepts.length;
  const activeCount = draft.concepts.filter((c) => busy(stageFor(c.id))).length;
  // Backend invariant: ready AND has a preview AND backend transparency verified.
  const backendExportable = (conceptId: string) => {
    if (stageFor(conceptId) !== "ready") return false;
    const id = stickerIdFor(conceptId);
    const preview = id ? previews[id] : undefined;
    return !!preview && preview.transparencyValid === true;
  };
  /** Review/readiness predicates and counts — same semantics, extracted. */
  const {
    clientCheckFor,
    cutoutOk,
    isExportable,
    browserVerifiedCount,
    cutoutVerifiedCount,
    browserFailedCount,
    exportableCount,
    exportReady,
    omittedLabels,
  } = deriveReviewState({
    concepts: draft.concepts,
    clientChecks,
    stickerIdFor,
    backendExportable,
  });
  const transparentCount = readyConcepts.filter((c) => backendExportable(c.id)).length;
  const attentionCount = failedCount + browserFailedCount;
  const allReady = draft.concepts.length > 0 && generatedCount === draft.concepts.length && !anyBusy;


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
  /* ---------------- Sticker Drops summary (read-only, this pack) ---------------- */
  const dropStatus = dropStatusQuery.data;
  const dropSchedules = dropStatus?.schedules ?? [];
  const dropKillSwitch = dropStatus?.control?.kill_switch === true;
  const packSchedules = dropSchedules.filter((sc) => sc.pack_id === packId);


  /* ---------------- Pack lifecycle: exactly one primary action ---------------- */
  const distStatusFor = (groupId: string) =>
    distTargets.find((t) => t.group_connection_id === groupId)?.status ?? null;
  const newTargetIds = selectedGroupIds.filter((id) => !distStatusFor(id));
  const failedTargetIds = selectedGroupIds.filter((id) => distStatusFor(id) === "failed");
  const deliveredTargetIds = selectedGroupIds.filter((id) => {
    const st = distStatusFor(id);
    return st === "assigned" || st === "announced";
  });
  const unpublishedReviewedIds = reviewedStickerIds.filter(
    (id) => tgStickers[id]?.status !== "published",
  );
  const lifecycleMode: "publish" | "update" | "add" | "retry" | "attention" | "current" =
    !telegramSetExists
      ? "publish"
      : unpublishedReviewedIds.length > 0
        ? "update"
        : newTargetIds.length > 0
          ? "add"
          : failedTargetIds.length > 0
            ? "retry"
            : tgPublishedCount < totalConcepts
              ? "attention"
              : "current";
  const lifecycleBusy = publishing || distributing;
  const lifecycleEnabled =
    lifecycleMode === "publish" || lifecycleMode === "update"
      ? canPublish
      : lifecycleMode === "add" || lifecycleMode === "retry"
        ? canDistribute
        : false;
  const lifecycleLabel =
    lifecycleMode === "publish"
      ? "Publish pack & send"
      : lifecycleMode === "update"
        ? `Publish ${unpublishedReviewedIds.length} sticker update${unpublishedReviewedIds.length === 1 ? "" : "s"}`
        : lifecycleMode === "add"
          ? `Add to ${newTargetIds.length} New Communit${newTargetIds.length === 1 ? "y" : "ies"}`
          : lifecycleMode === "retry"
            ? `Retry ${failedTargetIds.length} failed community send${failedTargetIds.length === 1 ? "" : "s"}`
            : lifecycleMode === "attention"
              ? "Finish Review for Remaining Stickers"
              : "Pack is up to date";
  const runLifecycleAction = () => {
    if (lifecycleMode === "publish") {
      setConfirmPublish(true);
      return;
    }
    if (lifecycleMode === "update") {
      // Adds only the not-yet-published stickers, then reaches only the
      // communities that still need this pack.
      void doPublish([...newTargetIds, ...failedTargetIds]);
      return;
    }
    if (lifecycleMode === "add") void doDistribute(newTargetIds);
    if (lifecycleMode === "retry") void doDistribute(failedTargetIds);
  };

  /* -------- Quality & Release orientation (presentation-derived, no new queries) -------- */
  const totalStickers = draft.concepts.length;
  const qualityPathState = checksRunning ? "Checking" : exportReady ? "Ready" : "Needs review";
  const telegramPathState = allPublished
    ? "Live"
    : partiallyPublished || telegramSetExists
      ? "Partly published"
      : "Not published";
  const communityPathState =
    telegramGroup.connectedGroupCount === 0
      ? "No community"
      : selectedGroupIds.length === 0
        ? "Select targets"
        : !groupsSelectedAndReady
          ? "Needs setup"
          : `${selectedGroupIds.length} selected`;
  const dropsPathState = dropStatusQuery.isPending
    ? "Checking"
    : dropStatusQuery.isError
      ? "Unavailable"
      : dropKillSwitch && packSchedules.length > 0
        ? "Emergency pause"
        : packSchedules.length === 0
          ? "Not configured"
          : "Configured";
  const releasePath: { label: string; state: string }[] = [
    { label: "1 Quality checks", state: qualityPathState },
    { label: "2 Export", state: "Optional" },
    { label: "3 Telegram pack", state: telegramPathState },
    { label: "4 Communities", state: communityPathState },
    { label: "5 Sticker Drops", state: dropsPathState },
  ];

  const releaseAdvice: {
    title: string;
    body: string;
    cta: null | "sticker-studio" | "telegram" | "drops" | "lifecycle";
  } = checksRunning
    ? {
        title: "Quality checks are running",
        body: "Transparency and Telegram cutout checks are still finishing. The next step appears once they complete.",
        cta: null,
      }
    : !exportReady
      ? {
          title: "Finish quality review",
          body:
            attentionCount > 0
              ? `${attentionCount} sticker${attentionCount === 1 ? "" : "s"} need attention. Fix or regenerate them in Sticker Studio, then come back.`
              : `${exportableCount} of ${totalStickers} stickers pass every check. Finish the remaining ones in Sticker Studio before release.`,
          cta: "sticker-studio",
        }
      : !telegram.botConfigured || !telegram.ownerConnected
        ? {
            title: "Finish Telegram setup",
            body: "Telegram is not fully connected yet, so this pack cannot be published. Complete setup in Community Command.",
            cta: "telegram",
          }
        : telegramGroup.connectedGroupCount === 0
          ? {
              title: "Connect a community",
              body: "Connect at least one Telegram community in Community Command to release this pack.",
              cta: "telegram",
            }
          : selectedGroupIds.length === 0
            ? {
                title: "Choose community targets",
                body: "Select at least one connected community below to receive this pack.",
                cta: null,
              }
            : !groupsSelectedAndReady
              ? {
                  title: "Fix community setup",
                  body: "One of the selected communities is not ready. Review its setup in Community Command.",
                  cta: "telegram",
                }
              : lifecycleMode === "attention"
                ? {
                    title: "Finish quality review",
                    body: "Some stickers are still not published because they have not passed review. Finish them in Sticker Studio.",
                    cta: "sticker-studio",
                  }
                : lifecycleMode !== "current"
                  ? {
                      title: "Release this pack",
                      body: `The recommended action is: ${lifecycleLabel}.`,
                      cta: "lifecycle",
                    }
                  : dropStatusQuery.isPending
                    ? {
                        title: "Checking Sticker Drops",
                        body: "Sticker Drops status is still loading for this pack.",
                        cta: null,
                      }
                    : dropStatusQuery.isError
                      ? {
                          title: "Sticker Drops status unavailable",
                          body: "Sticker Drops status could not be loaded right now. Open Sticker Drops to inspect it safely.",
                          cta: "drops",
                        }
                      : dropKillSwitch && packSchedules.length > 0
                        ? {
                            title: "Sticker Drops emergency pause",
                            body: "Automation is paused by the emergency stop. Review it in Sticker Drops before relying on scheduled posts.",
                            cta: "drops",
                          }
                        : packSchedules.length === 0
                          ? {
                              title: "Set up Sticker Drops",
                              body: "Release is complete. Schedule Sticker Drops so your community keeps seeing this pack.",
                              cta: "drops",
                            }
                          : {
                              title: "Release complete",
                              body: "This pack is published, delivered and has Sticker Drops configured. Manage them any time.",
                              cta: "drops",
                            };



  const shortNamePreview = packId
    ? previewShortName(draft.packName, packId, telegram.botUsername)
    : null;

  /**
   * Batch distribution of the ALREADY published sticker set to the selected
   * connected groups. Never creates or re-creates a Telegram sticker set.
   */
  const doDistribute = async (groupIds: string[] = selectedGroupIds) => {
    if (!packId || !workspaceId || groupIds.length === 0) return;
    setDistributing(true);
    setDistError(null);
    try {
      const result = await distributePackToGroups({
        workspaceId,
        packId,
        groupConnectionIds: groupIds,
      });
      setDistResult(result);
      await loadTelegramState(packId);
      await loadDistribution(packId);
      if (result.status === "complete") {
        toast.success(
          `${result.total} communit${result.total === 1 ? "y" : "ies"} updated: ${result.assigned} official set, ${result.announced} announced.`,
        );
      } else if (result.status === "partial") {
        toast.warning(
          `${result.total - result.failed} of ${result.total} communities updated, ${result.failed} need retry.`,
        );
      } else {
        toast.error(
          "Sending the pack to the selected communities failed. The sticker set stays published.",
        );
      }
    } catch (err) {
      setDistError(telegramErrorMessage(err));
      toast.error(telegramErrorMessage(err));
    } finally {
      setDistributing(false);
    }
  };

  /**
   * `publishPack()` creates the set once and afterwards only adds stickers that
   * are not published yet. `distributeIds` controls exactly which communities
   * receive a follow-up distribution — already-successful ones are never
   * re-announced.
   */
  const doPublish = async (distributeIds: string[] = selectedGroupIds) => {
    if (!packId || !workspaceId) return;
    setPublishing(true);
    setTgError(null);
    try {
      const result = await publishPack({ workspaceId, packId, stickerIds: reviewedStickerIds });
      setPublishResult(result);
      await loadTelegramState(packId);
      if (result.status === "published") {
        toast.success(`Published ${result.published} of ${result.total} stickers to Telegram.`);
        // One publish, then at most one batch distribution to the communities
        // that actually need it.
        if (distributeIds.length > 0) await doDistribute(distributeIds);
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
    clearSelection();
    const result = await persist();
    if (!result) return;
    for (const concept of failedConcepts) {
      const stickerId = result.stickerIds[concept.id];
      if (!stickerId) continue;
      // Phase 4C: a replacement_failed sticker may still hold live Telegram
      // state — never retry a Telegram-locked sticker.
      if (isTelegramLocked(stickerId)) continue;
      // eslint-disable-next-line no-await-in-loop
      await runGeneration(concept.id, stickerId, result.packId);
      if (!aliveRef.current) return;
    }
  };

  /** Max sticker pipelines running at once for a confirmed selected batch. */
  const SELECTED_BATCH_CONCURRENCY = 2;

  /**
   * Sticker Studio selective generation. One confirmed batch, one save, then the
   * existing proven per-sticker runtime is re-used by at most
   * SELECTED_BATCH_CONCURRENCY async workers pulling from a shared cursor in
   * board order. Admission is guarded by the live pollingRef, never only by a
   * stale render snapshot. No automatic retries.
   */
  const generateSelected = async () => {
    setConfirmSelectedBatch(false);
    const batch = draft.concepts.filter(
      (c) => selectedForGeneration.includes(c.id) && bulkSelectable(c.id),
    );
    if (batch.length === 0) {
      clearSelection();
      toast.info("Those stickers are no longer eligible — nothing was generated.");
      return;
    }
    const result = await persist();
    if (!result) return;

    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (!aliveRef.current) return;
        const index = cursor;
        cursor += 1;
        const concept = batch[index];
        if (!concept) return;
        const stickerId = result.stickerIds[concept.id];
        if (!stickerId) {
          setSelectedForGeneration((prev) => prev.filter((id) => id !== concept.id));
          continue;
        }
        // Live re-check: skip anything ready, previewed, locked or in flight.
        if (
          pollingRef.current.has(stickerId) ||
          stages[stickerId] === "ready" ||
          previews[stickerId] ||
          isTelegramLocked(stickerId) ||
          busy(stageFor(concept.id))
        ) {
          setSelectedForGeneration((prev) => prev.filter((id) => id !== concept.id));
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await runGeneration(concept.id, stickerId, result.packId);
        setSelectedForGeneration((prev) => prev.filter((id) => id !== concept.id));
      }
    };

    const workerCount = Math.min(SELECTED_BATCH_CONCURRENCY, batch.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    clearSelection();
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
    <div className="flex flex-col gap-6 pb-28 sm:gap-8 sm:pb-0">
      <PageHeader
        eyebrow="Sticker Lab"
        title="New Sticker Pack"
        description={`Creating for ${projectName}. This pack belongs to this project — sticker generation uses this project's Brand Kit when one is saved, plus the selected or available project reference assets, and you choose which of this project's Telegram communities receive it after review. AI generation runs server-side and only when you start it.`}
        status={draft.packId ? `Saved to ${projectName}` : "Draft"}
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

      <StepGuide step={step} />

      {step === 1 ? (
        <StepCard
          title="Character & Brand"
          hint="Blueprint, part 1. Character Lock lives here. References are stored privately in this project's Asset Vault, and generation uses this project's Brand Kit when one is saved, plus the selected or available project reference assets."
        >
          <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
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
                Supabase and are recorded in this project’s Asset Vault. Previews use short-lived signed
                URLs; nothing is public.
              </Notice>
            </div>
          </div>

          <div className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-foreground">
                Reuse existing project references
              </h3>
              <span className="text-xs text-muted-foreground">
                {draft.referenceAssetIds.length} of {MAX_REFERENCES} selected
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Mascots, reference images and logos already in your Asset Vault. Explicitly selected
              references always win. If none are selected, an enabled Character Lock’s canonical
              references are tried next, then the server picks the best available reference
              automatically.
            </p>
            {referencesQuery.isLoading ? (
              <p className="mt-4 text-xs text-muted-foreground">Loading references…</p>
            ) : (referencesQuery.data?.assets.length ?? 0) === 0 ? (
              <p className="mt-4 text-xs text-muted-foreground">
                No mascot, reference or logo assets yet. Upload one above or from the Asset Vault.
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
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
                        <span className="mt-2 flex items-center justify-between gap-1">
                          <span className="min-w-0 truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                            {asset.asset_type.replace("_", " ")}
                          </span>
                          {selected ? (
                            <Check className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-8 rounded-lg border border-border/70 bg-surface-raised/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-foreground">Character Lock</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Canonical character identity from this project’s Brand Kit.
                  </p>
                </div>
              </div>
              {characterLockQuery.isLoading ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : brandLockActive ? (
                <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-gold">
                  Character Lock active
                </span>
              ) : null}
            </div>

            {characterLockQuery.isError ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p role="alert" className="text-xs text-signal">
                  The Brand Kit Character Lock could not be loaded, so its status is unknown right
                  now.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  onClick={() => void characterLockQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : characterLockQuery.isLoading ? null : !brandLockActive ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  No Character Lock is active for this project yet.
                </p>
                <Button asChild variant="outline" size="sm" className="min-h-10">
                  <Link to="/brand-kit">Set up in Brand Kit</Link>
                </Button>
              </div>
            ) : (
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 [&>*]:min-w-0">
                <div>
                  <dt className="uppercase tracking-[0.12em] text-muted-foreground">Subject</dt>
                  <dd className="mt-0.5 text-foreground [overflow-wrap:anywhere]">
                    {brandLock!.subjectName || "Not named"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-muted-foreground">
                    Protected traits
                  </dt>
                  <dd className="mt-0.5 text-foreground [overflow-wrap:anywhere]">
                    {brandLock!.protectedTraits.join(", ") || "None listed"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-muted-foreground">
                    Wardrobe &amp; accessories
                  </dt>
                  <dd className="mt-0.5 text-foreground [overflow-wrap:anywhere]">
                    {brandLock!.wardrobeAccessories.join(", ") || "None listed"}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.12em] text-muted-foreground">
                    Never change
                  </dt>
                  <dd className="mt-0.5 text-foreground [overflow-wrap:anywhere]">
                    {brandLock!.negativeConstraints.join(", ") || "None listed"}
                  </dd>
                </div>
              </dl>
            )}

            <label className="mt-4 flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={blueprint.useBrandCharacterLock}
                onCheckedChange={(v) => toggleUseCharacterLock(v === true)}
                disabled={!brandLockActive && !packLockSnapshot}
                className="mt-0.5"
                aria-describedby="character-lock-help"
              />
              <span className="min-w-0 text-xs">
                <span className="font-medium text-foreground">
                  Use Brand Kit Character Lock for this pack
                </span>
                <span id="character-lock-help" className="mt-1 block text-muted-foreground">
                  Saved with this pack and used by V2 generation after the pack is saved. Its
                  canonical references are only a fallback for generation when no explicit
                  references are selected.
                </span>
              </span>
            </label>

            {packLockSnapshot && hasCharacterLockContent(packLockSnapshot) ? (
              <p className="mt-2 text-xs text-muted-foreground">
                This pack keeps its own saved snapshot
                {packLockSnapshot.subjectName ? ` of “${packLockSnapshot.subjectName}”` : ""}. Later
                Brand Kit edits do not overwrite it.
              </p>
            ) : null}
          </div>
        </StepCard>

      ) : null}

      {step === 2 ? (
        <StepCard
          title="Creative Direction"
          hint="Blueprint, part 2. Name the pack and set the creative rules the AI must follow. Saved to this project’s sticker packs."
        >

          <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
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

            <section className="md:col-span-2 rounded-lg border border-border bg-background/40 p-4">
              <h3 className="text-sm font-semibold text-foreground">Creative Direction</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The pack-level creative source of truth for Sticker Lab V2. Saved with this pack and
                used by V2 generation after you save. On conflict, Character Lock identity and the
                explicit concept and text rules take priority.
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
                <div>
                  <Label htmlFor="cd-purpose">Purpose</Label>
                  <Input
                    id="cd-purpose"
                    className="mt-2 min-h-11"
                    placeholder="Community reactions, launch hype, trading reactions, moderation…"
                    value={direction.purpose}
                    onChange={(e) => updateDirection({ purpose: e.target.value })}
                  />
                </div>

                <div>
                  <Label htmlFor="cd-audience">Audience</Label>
                  <Input
                    id="cd-audience"
                    className="mt-2 min-h-11"
                    placeholder="Who is this pack for?"
                    value={direction.audience}
                    onChange={(e) => updateDirection({ audience: e.target.value })}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label htmlFor="cd-tone">Tone keywords</Label>
                  <Textarea
                    id="cd-tone"
                    className="mt-2 min-h-20"
                    placeholder="Comma or line separated — e.g. bold, playful, deadpan"
                    defaultValue={direction.toneKeywords.join("\n")}
                    onBlur={(e) =>
                      updateDirection({ toneKeywords: parseDirectionList(e.currentTarget.value) })
                    }
                  />
                </div>

                <SegmentedChoice
                  legend="Humor level"
                  options={HUMOR_LEVELS}
                  label={humorLabel}
                  value={direction.humorLevel}
                  onSelect={(v) => updateDirection({ humorLevel: v })}
                />

                <SegmentedChoice
                  legend="Intensity"
                  options={INTENSITY_LEVELS}
                  label={intensityLabel}
                  value={direction.intensity}
                  onSelect={(v) => updateDirection({ intensity: v })}
                />

                <div className="md:col-span-2">
                  <Label htmlFor="cd-visual">Visual direction</Label>
                  <Textarea
                    id="cd-visual"
                    className="mt-2 min-h-24"
                    placeholder="Composition, framing, colour language, finish…"
                    value={direction.visualDirection}
                    onChange={(e) => updateDirection({ visualDirection: e.target.value })}
                  />
                </div>
              </div>

              <details className="mt-4 rounded-md border border-border bg-surface-raised p-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Text treatment & pack rules
                </summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
                  <SegmentedChoice
                    legend="Text preference"
                    options={TEXT_PREFERENCES}
                    label={textPreferenceLabel}
                    value={direction.textPreference}
                    onSelect={(v) => updateDirection({ textPreference: v })}
                  />

                  <div>
                    <Label htmlFor="cd-text-notes">Text notes</Label>
                    <Textarea
                      id="cd-text-notes"
                      className="mt-2 min-h-24"
                      placeholder="Casing, recurring phrases, placement, text treatment…"
                      value={direction.textNotes}
                      onChange={(e) => updateDirection({ textNotes: e.target.value })}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <Label htmlFor="cd-rules">Pack-specific rules</Label>
                    <Textarea
                      id="cd-rules"
                      className="mt-2 min-h-24"
                      placeholder="One per line — things this pack must always or never do"
                      defaultValue={direction.packRules.join("\n")}
                      onBlur={(e) =>
                        updateDirection({ packRules: parseDirectionList(e.currentTarget.value) })
                      }
                    />
                  </div>
                </div>
              </details>
            </section>
          </div>

        </StepCard>
      ) : null}

      {step === 3 ? (
        <StepCard
          title="Concept Studio"
          hint="Lock the ideas you want to keep, reorder or duplicate concepts, and use AI only where you choose. AI suggestions are optional and text-only, and may use text-model credits after confirmation; they do not start image generation. Finalise concepts before paid image generation in Sticker Studio."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                onClick={() =>
                  mutateConcepts(
                    draft.concepts.map((c, i) =>
                      c.locked
                        ? c
                        : { ...starterConcepts(draft.theme, draft.size)[i]!, id: c.id },
                    ),
                    draft.concepts.filter((c) => !c.locked).map((c) => c.id),
                  )
                }
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset unlocked
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={suggesting || !conceptsConfigured || unlockedConcepts.length === 0}
                onClick={() => setConfirmSuggest("board")}
              >
                {suggesting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="size-4" aria-hidden="true" />
                )}
                Suggest unlocked concepts
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                disabled={suggesting || !conceptsConfigured || selectedConcepts.length === 0}
                onClick={() => setConfirmSuggest("alternatives")}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Alternatives for selected ({selectedConcepts.length})
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
            concepts used ·{" "}
            <span className="font-semibold text-foreground">
              {draft.concepts.length - unlockedConcepts.length} locked
            </span>
            . Locked concepts are never replaced by AI and stay editable by you.
          </p>

          {!conceptsConfigured && !conceptConfigQuery.isLoading ? (
            <p className="mb-4 text-xs text-muted-foreground">
              AI concept suggestions are unavailable right now. Starter concepts and manual editing
              still work exactly as before.
            </p>
          ) : null}

          {conceptError ? (
            <div className="mb-4">
              <Notice tone="warn">
                {conceptError} Your current concepts were not changed.
              </Notice>
            </div>
          ) : null}

          {pendingPreviewItems.length ? (
            <section className="cartel-panel mb-5 rounded-lg p-3 sm:p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {preview?.mode === "alternatives"
                    ? "AI alternatives for selected concepts"
                    : "AI suggestions for unlocked concepts"}
                </h3>
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {pendingPreviewItems.length} ideas · not applied yet
                </span>
              </header>
              <p className="mt-1 text-xs text-muted-foreground">
                Nothing below is saved or generated. Each suggestion replaces one specific concept
                in place, keeping its position. Locked concepts are never touched.
              </p>
              <ol className="mt-3 space-y-2">
                {pendingPreviewItems.map((item) => {
                  const target = conceptAt(item.targetId);
                  return (
                    <li
                      key={item.targetId}
                      className="min-w-0 rounded-md border border-border/60 p-2.5"
                    >
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        Replaces: {target ? target.label || "Untitled concept" : "removed concept"}
                      </p>
                      <p className="mt-1 break-words text-sm font-medium text-foreground">
                        {item.suggestion.emoji} {item.suggestion.label}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {item.suggestion.action}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 min-h-10"
                        disabled={!target || target.locked}
                        onClick={() => {
                          if (draft.packId) {
                            setPendingApplyTargetIds([item.targetId]);
                            setConfirmApplySuggestions(true);
                          } else {
                            applyPreviewItems([item.targetId]);
                          }
                        }}
                      >
                        <Check className="size-4" aria-hidden="true" />
                        Use this one
                      </Button>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="min-h-10"
                  onClick={() => {
                    const ids = pendingPreviewItems.map((item) => item.targetId);
                    if (draft.packId) {
                      setPendingApplyTargetIds(ids);
                      setConfirmApplySuggestions(true);
                    } else applyPreviewItems(ids);
                  }}
                >
                  <Check className="size-4" aria-hidden="true" />
                  Use all suggestions
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={suggesting}
                  onClick={() => {
                    const mode = preview?.mode ?? "board";
                    setRefreshTargetIds(
                      mode === "alternatives"
                        ? pendingPreviewItems.map((item) => item.targetId)
                        : null,
                    );
                    setConfirmSuggest(mode);
                  }}
                >
                  <Sparkles className="size-4" aria-hidden="true" />
                  Suggest another set
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 text-muted-foreground"
                  onClick={() => {
                    setPreview(null);
                    setConceptError(null);
                  }}
                >
                  <X className="size-4" aria-hidden="true" />
                  Discard suggestions
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Review and edit before saving or generating.
              </p>
            </section>
          ) : null}


          <ul className="grid gap-2 sm:gap-3 xl:grid-cols-2 [&>*]:min-w-0">
            {draft.concepts.map((c, i) => (
              <li key={c.id}>

                <details
                  ref={(el) => {
                    if (el && !el.dataset["initOpen"]) {
                      el.dataset["initOpen"] = "1";
                      el.open = i === 0;
                    }
                  }}
                  className="cartel-panel group rounded-lg [&[open]>summary]:border-b [&[open]>summary]:border-border/60"
                >
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 p-3 sm:p-4">
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {c.emoji} {c.label || "Untitled concept"}
                      </span>
                      {c.action ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.action}
                        </span>
                      ) : null}
                    </span>
                    {c.locked ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/40 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-gold">
                        <Lock className="size-3" aria-hidden="true" />
                        Locked
                      </span>
                    ) : null}
                    <span className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted-foreground group-open:hidden">
                      Edit
                    </span>
                  </summary>
                  <div className="space-y-3 p-3 sm:p-4">
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
                    <div className="flex flex-wrap items-end justify-between gap-3">
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
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="min-h-10 text-muted-foreground hover:text-signal"
                        onClick={() => removeConcept(c.id)}
                        aria-label={`Remove concept ${i + 1}`}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        Remove
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        onClick={() => toggleConceptLock(c.id)}
                        aria-pressed={c.locked ? "true" : "false"}
                        aria-label={
                          c.locked ? `Unlock concept ${i + 1}` : `Lock concept ${i + 1}`
                        }
                      >
                        {c.locked ? (
                          <LockOpen className="size-4" aria-hidden="true" />
                        ) : (
                          <Lock className="size-4" aria-hidden="true" />
                        )}
                        {c.locked ? "Unlock" : "Lock"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        disabled={i === 0}
                        onClick={() => moveConcept(i, -1)}
                        aria-label={`Move concept ${i + 1} up`}
                      >
                        <ArrowUp className="size-4" aria-hidden="true" />
                        Up
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        disabled={i === draft.concepts.length - 1}
                        onClick={() => moveConcept(i, 1)}
                        aria-label={`Move concept ${i + 1} down`}
                      >
                        <ArrowDown className="size-4" aria-hidden="true" />
                        Down
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-10"
                        disabled={draft.concepts.length >= draft.size}
                        onClick={() => duplicateConcept(c.id)}
                        aria-label={`Duplicate concept ${i + 1}`}
                      >
                        <Copy className="size-4" aria-hidden="true" />
                        Duplicate
                      </Button>
                      <label className="ml-auto flex min-h-10 items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={selectedForAlternatives.includes(c.id)}
                          disabled={c.locked}
                          onCheckedChange={(checked) =>
                            setSelectedForAlternatives((s) =>
                              checked === true
                                ? s.includes(c.id)
                                  ? s
                                  : [...s, c.id]
                                : s.filter((x) => x !== c.id),
                            )
                          }
                          aria-label={`Select concept ${i + 1} for AI alternatives`}
                        />
                        Select for AI alternative
                      </label>
                    </div>

                  </div>
                </details>
              </li>
            ))}
          </ul>

          <section className="cartel-panel mt-6 rounded-lg p-3 sm:p-4">
            <h3 className="text-sm font-semibold text-foreground">Concept board status</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {draft.conceptBoardApproved
                ? "You marked this concept board ready. Any concept edit clears this again."
                : "Marking the board ready is an editor-side checkpoint only. It is not saved and it does not generate or publish anything."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {draft.conceptBoardApproved ? (
                <span className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-pepe">
                  <CircleCheck className="size-4" aria-hidden="true" />
                  Concept board marked ready
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={!boardReadyEligible || pendingPreviewItems.length > 0}
                  onClick={() => update({ conceptBoardApproved: true })}
                >
                  <Check className="size-4" aria-hidden="true" />
                  Mark concept board ready
                </Button>
              )}
              {!draft.conceptBoardApproved && !boardReadyEligible ? (
                <span className="text-xs text-muted-foreground">
                  Fill every label and action, and use all {draft.size} concept slots first.
                </span>
              ) : null}
              {!draft.conceptBoardApproved && boardReadyEligible && pendingPreviewItems.length ? (
                <span className="text-xs text-muted-foreground">
                  Apply or discard the pending AI suggestions first.
                </span>
              ) : null}
            </div>
          </section>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={saving}
              onClick={() => void persist()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save pack to project
            </Button>
            {draft.packId ? (
              <span className="text-xs text-pepe">Pack saved. Retries reuse the same rows.</span>
            ) : null}
          </div>

          <AlertDialog
            open={confirmSuggest !== null}
            onOpenChange={(open) => {
              if (!open) {
                setConfirmSuggest(null);
                setRefreshTargetIds(null);
              }
            }}
          >
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>Ask AI for concept ideas?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-left">
                    <p>This uses Kie language-model credits (tokens) on your account.</p>
                    <p>
                      It generates <strong>concept ideas only</strong> — text labels, actions and
                      emoji.
                    </p>
                    <p>
                      It does <strong>not</strong> generate sticker images and does not start the
                      two-task image pipeline.
                    </p>
                    <p>
                      {confirmSuggest === "alternatives"
                        ? `This asks for ${(refreshTargetIds ?? selectedConcepts.map((c) => c.id)).length} alternative${(refreshTargetIds ?? selectedConcepts.map((c) => c.id)).length === 1 ? "" : "s"} for the concepts you selected.`
                        : `This asks for ${unlockedConcepts.length} idea${unlockedConcepts.length === 1 ? "" : "s"} for your unlocked concepts only.`}{" "}
                      Locked concepts are never sent for replacement.
                    </p>
                    <p>
                      Your current concepts stay untouched unless you explicitly apply the
                      suggestions.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const mode = confirmSuggest ?? "board";
                    const ids = refreshTargetIds;
                    setConfirmSuggest(null);
                    setRefreshTargetIds(null);
                    void runConceptSuggestion(mode, ids);
                  }}
                >
                  Suggest concepts
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={confirmApplySuggestions}
            onOpenChange={(open) => {
              setConfirmApplySuggestions(open);
              if (!open) setPendingApplyTargetIds(null);
            }}
          >
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {(pendingApplyTargetIds?.length ?? 0) === 1
                    ? "Replace this concept in this saved pack?"
                    : "Replace these concepts in this saved pack?"}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-left">
                    <p>
                      Applying changes only your local draft right now. Nothing is saved and no
                      generated or published sticker is touched.
                    </p>
                    <p>
                      However, this pack is already saved: a later <strong>Save</strong> will update
                      the stored concept rows to match.
                    </p>
                    <p>
                      {(pendingApplyTargetIds?.length ?? 0) === 1
                        ? "Only this one unlocked concept changes. Keyword metadata is cleared for that concept only."
                        : "Only unlocked, targeted concepts change. Keyword metadata is cleared for those concepts only."}
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep current concepts</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const ids =
                      pendingApplyTargetIds ?? pendingPreviewItems.map((item) => item.targetId);
                    applyPreviewItems(ids);
                  }}
                >
                  {(pendingApplyTargetIds?.length ?? 0) === 1
                    ? "Use this concept"
                    : "Use these concepts"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

        </StepCard>
      ) : null}


      {step === 4 ? (
        <StepCard
          title="Sticker Studio"
          hint="Generate one test sticker, pick specific stickers, or generate all remaining. Each generated sticker runs image generation, background removal and a server-side transparency check. Successful generations are kept in Version History. Anything marked “Live on Telegram” cannot be regenerated — it uses Candidate → Review → Replace instead, so the live sticker keeps working until you approve a replacement. Motion Studio is attached to each approved static and does not replace this pack flow."
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

          {/* Pipeline detail is secondary on mobile, always visible on desktop. */}
          <details className="mt-6 rounded-md border border-border bg-background/40 p-3 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Generation pipeline
            </summary>
            <Pipeline />
          </details>
          <div className="hidden lg:block">
            <Pipeline />
          </div>


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
                      clearSelection();
                      // Preserve original meaning: the first concept is the test sticker.
                      const first = draft.concepts[0];
                      if (!first) return;
                      if (conceptTelegramLocked(first.id)) {
                        toast.message("Live on Telegram", {
                          description: TELEGRAM_LOCK_MESSAGE,
                        });
                        return;
                      }
                      void generateOne(first.id);
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

          {/* Sticker Studio selection toolbar — editor-only, no provider calls. */}
          {configured && selectableIds.length > 0 ? (
            <div className="cartel-panel mt-6 rounded-lg p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Sticker Studio selection
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedCount} selected · {selectableIds.length} can be selected
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    disabled={anyBusy || saving || selectedCount === selectableIds.length}
                    onClick={() => setSelectedForGeneration(selectableIds)}
                  >
                    Select all ungenerated
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-10"
                    disabled={selectedCount === 0}
                    onClick={clearSelection}
                  >
                    Clear selection
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-10"
                    disabled={selectedCount === 0 || !configured || anyBusy || saving}
                    onClick={() => setConfirmSelectedBatch(true)}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    Generate selected ({selectedCount})
                  </Button>
                </div>
              </div>
            </div>
          ) : null}


          <ul className="mt-6 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0">
            {draft.concepts.map((c, index) => {
              const stage = stageFor(c.id);
              const stickerId = stickerIdFor(c.id);
              const preview = stickerId ? previews[stickerId] : undefined;
              const failure = stickerId ? failures[stickerId] : undefined;
              const note = stickerId ? notes[stickerId] : undefined;
              const locked = conceptTelegramLocked(c.id);
              const candStage = candidateStageFor(stickerId);
              const candFailure = stickerId ? candidateFailures[stickerId] : undefined;
              const stickerVersions = stickerId ? (versionsBySticker[stickerId] ?? []) : [];
              /**
               * Newest candidate history row that is NOT the current image.
               * Leaving it alone is equivalent to rejecting it.
               */
              const pendingCandidate =
                locked && !isCandidateBusy(candStage)
                  ? (stickerVersions.find(
                      (v) =>
                        isCandidateVersionOrigin(v.origin) &&
                        !(!!v.storagePath && v.storagePath === preview?.storagePath),
                    ) ?? null)
                  : null;
              /**
               * A/B/C round state and the newest durable take per label.
               * Review-only: none of this changes the current image.
               *
               * The takes themselves always come from durable `sticker_versions`
               * rows. Local round state only identifies WHICH group is being
               * looked at while a round is in flight in this tab; after a
               * refresh that state is empty and the group is derived from the
               * newest durable variation row instead. No client-only winner is
               * invented or persisted anywhere.
               */
              const varRound = variationRoundFor(stickerId);
              const variationVersions = stickerVersions.filter((v) =>
                isVariationVersionOrigin(v.origin),
              );
              const latestVariationGroupId =
                varRound.groupId ?? variationVersions[0]?.variationGroupId ?? null;
              const variationBusy = isVariationBusy(varRound.stage);
              const candidateBusy = isCandidateBusy(candStage);
              const variationTakes = (["A", "B", "C"] as const).map((label) => {
                const version =
                  variationVersions.find(
                    (v) =>
                      v.variationLabel === label &&
                      (!latestVariationGroupId || v.variationGroupId === latestVariationGroupId),
                  ) ?? null;
                return {
                  label,
                  version,
                  /** Durable comparison against the current image only. */
                  isCurrent:
                    !!version?.storagePath && version.storagePath === preview?.storagePath,
                };
              });
              const hasVariationTakes = variationTakes.some((t) => t.version);
              return (
                <li key={c.id} className="cartel-panel rounded-lg p-2.5 sm:p-4">
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
                  {stickerId && (versionsBySticker[stickerId]?.length ?? 0) > 0 ? (
                    <details className="mt-3 rounded-md border border-border bg-background/40 p-2">
                      <summary className="flex min-h-9 cursor-pointer list-none items-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Version history ({versionsBySticker[stickerId]!.length})
                      </summary>
                      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                        Previous successful images are kept for this sticker. You can make an
                        earlier version current again without losing history.
                      </p>
                      <ul className="mt-2 space-y-2">
                        {versionsBySticker[stickerId]!.map((v) => {
                          const isCurrent =
                            !!v.storagePath && v.storagePath === preview?.storagePath;
                          // Any in-flight billable work for this sticker keeps
                          // the pointer controls closed until it settles.
                          const restoreDisabled =
                            busy(stage) ||
                            restoringStickerId !== null ||
                            variationBusy ||
                            candidateBusy ||
                            v.unavailable;
                          return (
                            <li key={v.id} className="flex min-w-0 items-center gap-2">
                              <span
                                className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border"
                                style={CHECKERBOARD}
                              >
                                {v.previewUrl ? (
                                  <img
                                    src={v.previewUrl}
                                    alt={`${c.label} version ${v.versionNumber}`}
                                    className="max-h-full max-w-full object-contain"
                                  />
                                ) : null}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-[11px] text-foreground">
                                    Version {v.versionNumber}
                                  </span>
                                  {isCandidateVersionOrigin(v.origin) ? (
                                    <StatusBadge tone="gold">Candidate</StatusBadge>
                                  ) : null}
                                  {isVariationVersionOrigin(v.origin) ? (
                                    <StatusBadge tone="gold">
                                      Variation {v.variationLabel ?? ""}
                                    </StatusBadge>
                                  ) : null}
                                </span>
                                {v.unavailable ? (
                                  <span className="block truncate text-[10px] text-muted-foreground">
                                    Image unavailable
                                  </span>
                                ) : null}
                              </span>
                              {isCurrent ? (
                                <StatusBadge tone="green">Current</StatusBadge>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 shrink-0 text-[11px]"
                                  disabled={restoreDisabled}
                                  onClick={() =>
                                    setRestoreTarget({
                                      stickerId,
                                      versionId: v.id,
                                      versionNumber: v.versionNumber,
                                      label: c.label,
                                    })
                                  }
                                >
                                  {restoringStickerId === stickerId ? "Working…" : "Set current"}
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ul>

                    </details>
                  ) : null}

                  {/* Phase 4D.2 candidate review — compare only, no mutation. */}
                  {pendingCandidate && stickerId ? (
                    <div className="mt-3 rounded-md border border-gold/40 bg-background/40 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gold">
                          Candidate ready
                        </p>
                        <StatusBadge tone="gold">
                          Version {pendingCandidate.versionNumber}
                        </StatusBadge>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            Current live
                          </p>
                          <div
                            className="mt-1 flex aspect-square items-center justify-center overflow-hidden rounded border border-border"
                            style={CHECKERBOARD}
                          >
                            {preview ? (
                              <img
                                src={preview.url}
                                alt={`${c.label} current live sticker`}
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : (
                              <span className="px-2 text-center text-[10px] text-muted-foreground">
                                No preview
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            Candidate
                          </p>
                          <div
                            className="mt-1 flex aspect-square items-center justify-center overflow-hidden rounded border border-border"
                            style={CHECKERBOARD}
                          >
                            {pendingCandidate.previewUrl ? (
                              <img
                                src={pendingCandidate.previewUrl}
                                alt={`${c.label} candidate version ${pendingCandidate.versionNumber}`}
                                className="max-h-full max-w-full object-contain"
                              />
                            ) : (
                              <span className="px-2 text-center text-[10px] text-muted-foreground">
                                Image unavailable
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                        Telegram still uses Current live until you approve the candidate.
                      </p>
                      {pendingCandidate.unavailable ? (
                        <p className="mt-2 text-[11px] text-signal">
                          This candidate image is no longer available, so it cannot replace the
                          live sticker. Generate another candidate to try again.
                        </p>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          className="mt-2 min-h-10 w-full"
                          disabled={
                            busy(stage) ||
                            restoringStickerId !== null ||
                            candidateBusy ||
                            variationBusy
                          }
                          onClick={() =>
                            setRestoreTarget({
                              stickerId,
                              versionId: pendingCandidate.id,
                              versionNumber: pendingCandidate.versionNumber,
                              label: c.label,
                            })
                          }
                        >
                          {restoringStickerId === stickerId
                            ? "Working…"
                            : "Replace live sticker"}
                        </Button>
                      )}
                    </div>
                  ) : null}

                  {/* A/B/C variations — review only. The current image, sticker
                      status and any live Telegram set are never touched. */}
                  {stickerId && preview ? (
                    <div className="mt-3 rounded-md border border-border bg-background/40 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          A/B/C variations
                        </p>
                        {varRound.stage !== "idle" ? (
                          <StatusBadge
                            tone={
                              isVariationBusy(varRound.stage)
                                ? "gold"
                                : varRound.stage === "done"
                                  ? "green"
                                  : varRound.stage === "cancelled"
                                    ? "muted"
                                    : "red"
                            }
                          >
                            {VARIATION_STAGE_LABEL[varRound.stage]}
                            {varRound.currentLabel ? ` ${varRound.currentLabel}` : ""}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        Three deliberate takes of this sticker, generated one after another. They
                        are saved to Version history for review only — nothing replaces the current
                        image until you set a version as current.
                      </p>
                      {/* Dedicated comparison: Current + Take A + Take B + Take C.
                          Every tile is either a durable image or an explicit
                          "Not generated" / "Unavailable" statement. */}
                      <ul className="mt-2 grid grid-cols-2 gap-2">
                        <li className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              Current
                            </span>
                            <StatusBadge tone="green">Current</StatusBadge>
                          </span>
                          <div
                            className="mt-1 flex aspect-square items-center justify-center overflow-hidden rounded border border-border"
                            style={CHECKERBOARD}
                          >
                            <img
                              src={preview.url}
                              alt={`${c.label} current image`}
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        </li>
                        {variationTakes.map((take) => (
                          <li key={take.label} className="min-w-0">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                Take {take.label}
                              </span>
                              {take.isCurrent ? (
                                <StatusBadge tone="green">Current</StatusBadge>
                              ) : null}
                            </span>
                            <div
                              className="mt-1 flex aspect-square items-center justify-center overflow-hidden rounded border border-border"
                              style={CHECKERBOARD}
                            >
                              {take.version?.previewUrl ? (
                                <img
                                  src={take.version.previewUrl}
                                  alt={`${c.label} variation ${take.label}`}
                                  className="max-h-full max-w-full object-contain"
                                />
                              ) : varRound.currentLabel === take.label ? (
                                <Loader2
                                  className="size-4 animate-spin text-gold"
                                  aria-hidden="true"
                                />
                              ) : (
                                <span className="px-1 text-center text-[9px] text-muted-foreground">
                                  {take.version ? "Unavailable" : "Not generated"}
                                </span>
                              )}
                            </div>
                            {take.version && !take.version.unavailable && !take.isCurrent ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-1 h-8 w-full text-[10px]"
                                disabled={
                                  busy(stage) ||
                                  restoringStickerId !== null ||
                                  variationBusy ||
                                  candidateBusy
                                }
                                onClick={() =>
                                  setRestoreTarget({
                                    stickerId,
                                    versionId: take.version!.id,
                                    versionNumber: take.version!.versionNumber,
                                    label: c.label,
                                  })
                                }
                              >
                                Use {take.label}
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {locked ? (
                        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                          This sticker is live on Telegram. Choosing a take opens the existing
                          Telegram replacement confirmation — nothing changes immediately, and the
                          live sticker keeps working until you confirm.
                        </p>
                      ) : null}
                      {varRound.failure && !variationBusy ? (
                        <p className="mt-2 text-[11px] text-signal">
                          {varRound.failure.title}. {varRound.failure.body}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="min-h-10 flex-1"
                          disabled={
                            !configured ||
                            saving ||
                            busy(stage) ||
                            isCandidateBusy(candStage) ||
                            isVariationBusy(varRound.stage) ||
                            restoringStickerId !== null
                          }
                          onClick={() => setVariationConfirm({ stickerId, label: c.label })}
                        >
                          {isVariationBusy(varRound.stage) ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          {isVariationBusy(varRound.stage)
                            ? VARIATION_STAGE_LABEL[varRound.stage]
                            : hasVariationTakes
                              ? "Run new A/B/C round"
                              : "Generate A/B/C variations"}
                        </Button>
                        {isVariationBusy(varRound.stage) ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="min-h-10"
                            onClick={() => cancelVariationRound(stickerId)}
                          >
                            Stop after this take
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* Motion Studio — read-only surface attached to the approved
                      static. No generation, provider or Telegram behaviour. */}
                  {stickerId && preview ? (
                    <MotionStudioPanel
                      state={motionBySticker[stickerId]}
                      loading={motionQuery.isPending || motionQuery.isFetching}
                      error={motionQuery.isError}
                    />
                  ) : null}



                  {/* Batch selection: never offered for a sticker that already
                      has a usable image — those use Regenerate explicitly. */}
                  <label
                    className={`mt-3 flex min-h-10 items-center gap-2 text-[11px] ${
                      bulkSelectable(c.id)
                        ? "cursor-pointer text-muted-foreground"
                        : "cursor-not-allowed text-muted-foreground/60"
                    }`}
                    title={
                      bulkSelectable(c.id)
                        ? undefined
                        : conceptTelegramLocked(c.id)
                          ? "This sticker is live on Telegram."
                          : busy(stage)
                            ? "This sticker is currently running."
                            : "Use Regenerate for an existing sticker."
                    }
                  >
                    <Checkbox
                      checked={selectedForGeneration.includes(c.id) && bulkSelectable(c.id)}
                      disabled={!configured || !bulkSelectable(c.id) || saving}
                      onCheckedChange={(v) => toggleSelected(c.id, v === true)}
                      aria-label={`Select ${c.label} for batch generation`}
                    />
                    <span className="truncate">Select for batch</span>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {locked ? (
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone="green">Live on Telegram</StatusBadge>
                          {candStage !== "idle" ? (
                            <StatusBadge tone={isCandidateBusy(candStage) ? "gold" : candStage === "ready" ? "green" : "red"}>
                              {CANDIDATE_STAGE_LABEL[candStage]}
                            </StatusBadge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Regeneration is locked so CARTEL HQ stays synchronized with the live
                          Telegram set. Generate a candidate instead: the live sticker keeps
                          working while you review the new image, and nothing is replaced until
                          you approve it.
                        </p>
                        {candFailure && !isCandidateBusy(candStage) ? (
                          <p className="mt-2 text-[11px] text-signal">
                            {candFailure.title}. {candFailure.body}
                          </p>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2 min-h-10 w-full"
                          disabled={
                            !configured ||
                            saving ||
                            !stickerId ||
                            candidateBusy ||
                            variationBusy ||
                            restoringStickerId !== null
                          }
                          onClick={() =>
                            stickerId
                              ? setCandidateConfirm({ stickerId, label: c.label })
                              : undefined
                          }
                        >
                          {isCandidateBusy(candStage) ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          {isCandidateBusy(candStage)
                            ? CANDIDATE_STAGE_LABEL[candStage]
                            : pendingCandidate
                              ? "Generate another candidate"
                              : "Generate candidate"}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant={preview ? "outline" : "default"}
                        className="min-h-10 flex-1"
                        disabled={!configured || busy(stage) || saving || variationBusy}
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
                    )}
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

          <AlertDialog open={confirmSelectedBatch} onOpenChange={setConfirmSelectedBatch}>
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Generate {selectedCount} selected{" "}
                  {selectedCount === 1 ? "sticker" : "stickers"}?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      {selectedCount === 1
                        ? "1 sticker is selected."
                        : `${selectedCount} stickers are selected.`}{" "}
                      Each sticker uses TWO Kie provider tasks — image generation plus background
                      removal — so this run is{" "}
                      <strong>
                        {selectedCount * 2} provider {selectedCount * 2 === 1 ? "task" : "tasks"}
                      </strong>{" "}
                      in total and consumes Kie credits on your account.
                    </p>
                    <p>
                      The selection runs up to 2 stickers at a time, admitted in board order. Ready
                      stickers and any sticker that still has a valid existing image are excluded
                      from this batch. There are no automatic retries, and nothing happens until you
                      confirm.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void generateSelected()}>
                  Generate {selectedCount * 2} tasks
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Phase 4D.2 — the ONLY path that can call start_candidate. */}
          <AlertDialog
            open={!!candidateConfirm}
            onOpenChange={(open) => {
              if (!open) setCandidateConfirm(null);
            }}
          >
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Generate a candidate for {candidateConfirm?.label}?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      This uses exactly <strong>2 Kie provider tasks</strong> — image generation
                      plus background removal — and consumes Kie credits on your account.
                    </p>
                    <p>
                      Your current CARTEL HQ image and the live Telegram sticker stay exactly as
                      they are while the candidate runs.
                    </p>
                    <p>
                      On success the candidate appears in Version history for review. Nothing is
                      replaced automatically, and there are no automatic retries.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const target = candidateConfirm;
                    setCandidateConfirm(null);
                    if (target && draft.packId) {
                      void startCandidate(draft.packId, target.stickerId);
                    }
                  }}
                >
                  Generate candidate (2 tasks)
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* The ONLY path that can start a billable A/B/C round. */}
          <AlertDialog
            open={!!variationConfirm}
            onOpenChange={(open) => {
              if (!open) setVariationConfirm(null);
            }}
          >
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
              <AlertDialogTitle>
                Generate A/B/C variations for {variationConfirm?.label}?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    This runs three takes one after another and uses up to{" "}
                    <strong>6 Kie provider tasks</strong> — image generation plus background
                    removal for each take — consuming Kie credits on your account.
                  </p>
                  <p>
                    Your current image, this sticker&apos;s status and any live Telegram set stay
                    exactly as they are. Each finished take is saved to Version history for review
                    only.
                  </p>
                  <p>
                    The round stops immediately if a take fails, and there are no automatic
                    retries. You can stop after the take that is already running.
                  </p>
                </div>
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const target = variationConfirm;
                    setVariationConfirm(null);
                    if (target && draft.packId) {
                      void startVariationRound(draft.packId, target.stickerId);
                    }
                  }}
                >
                  Generate A/B/C (up to 6 tasks)
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>


          {/* Phase 4B — first confirmation. No Telegram call happens here. */}
          <AlertDialog
            open={!!restoreTarget}
            onOpenChange={(open) => {
              if (!open) setRestoreTarget(null);
            }}
          >
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Make version {restoreTarget?.versionNumber} the current image?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      This changes the current image for{" "}
                      <strong>{restoreTarget?.label}</strong> to the selected historical version.
                      No image is generated and no Kie credits are used. The version you are
                      replacing stays in history.
                    </p>
                    <p>
                      If CARTEL HQ detects that this sticker is already live on Telegram, nothing
                      will be changed until you confirm a second time.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const target = restoreTarget;
                    if (target) void confirmRestore(target);
                  }}
                >
                  Set as current
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Phase 4B — second confirmation, required before any Telegram edit. */}
          <AlertDialog
            open={!!restoreTelegramTarget}
            onOpenChange={(open) => {
              if (!open) setRestoreTelegramTarget(null);
            }}
          >
            <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>Replace the live Telegram sticker?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      <strong>{restoreTelegramTarget?.label}</strong> is already live on Telegram.
                      Confirming replaces the live sticker in the existing Telegram set in place.
                    </p>
                    <p>
                      The pack and set link stay the same, no new sticker is added, no new set is
                      created, and no Kie credits are used. The previous version remains in
                      history.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const target = restoreTelegramTarget;
                    if (target) void confirmTelegramRestore(target);
                  }}
                >
                  Replace on Telegram
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </StepCard>

      ) : null}

      {step === 5 ? (
        <StepCard
          title="Quality & Release"
          hint="In order: quality checks → export (optional) → Telegram pack → communities → Sticker Drops."
        >
          <ol
            className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0"
            aria-label="Release path"
          >
            {releasePath.map((s) => (
              <li
                key={s.label}
                className="rounded-md border border-border bg-background/40 px-3 py-2"
              >
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {s.label}
                </p>
                <p className="mt-1 truncate text-xs font-semibold text-foreground">{s.state}</p>
              </li>
            ))}
          </ol>



          <section className="cartel-panel mb-6 rounded-lg p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Pack readiness
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {exportableCount} of {draft.concepts.length} stickers ready
                </p>
                <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                  This pack belongs to {projectName}. Sticker generation uses this project&apos;s
                  Brand Kit when one is saved, plus the selected or available project reference
                  assets. Ready stickers can be published as one Telegram sticker set.
                </p>
              </div>
              <StatusBadge
                tone={attentionCount > 0 ? "red" : exportReady ? "green" : "gold"}
              >
                {attentionCount > 0
                  ? `${attentionCount} need attention`
                  : exportReady
                    ? "Ready to publish"
                    : checksRunning || activeCount > 0
                      ? "Checks in progress"
                      : "Not ready yet"}
              </StatusBadge>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
              <SummaryStat
                label="Generated"
                value={`${generatedCount}/${totalStickers}`}
                tone={allReady && totalStickers > 0 ? "green" : "muted"}
              />
              <SummaryStat
                label="Server transparency"
                value={`${transparentCount}/${totalStickers}`}
                tone={transparentCount === totalStickers && totalStickers > 0 ? "green" : "muted"}
              />
              <SummaryStat
                label="Browser alpha"
                value={`${browserVerifiedCount}/${totalStickers}`}
                tone={
                  browserVerifiedCount === totalStickers && totalStickers > 0 ? "green" : "muted"
                }
              />
              <SummaryStat
                label="Telegram cutout"
                value={`${cutoutVerifiedCount}/${totalStickers}`}
                tone={cutoutVerifiedCount === totalStickers && totalStickers > 0 ? "green" : "muted"}
              />
              <SummaryStat
                label="Release ready"
                value={`${exportableCount}/${totalStickers}`}
                tone={
                  exportReady && exportableCount > 0
                    ? "green"
                    : attentionCount > 0
                      ? "red"
                      : "muted"
                }
              />
            </div>


            <div
              className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/40 p-3"
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
                    className="h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-border"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full bg-gold transition-all duration-300"
                      style={{
                        width: `${Math.round(
                          ((checkProgress?.done ?? 0) / Math.max(1, checkProgress?.total ?? 1)) *
                            100,
                        )}%`,
                      }}
                    />
                  </span>
                </>
              ) : (
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Review re-checks every finished sticker in your browser for a real alpha channel
                  and analyses it for an edge-connected light halo.
                  {browserFailedCount > 0 ? ` ${browserFailedCount} need attention.` : ""}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={checksRunning}
                  onClick={() => void runClientVerification(true)}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Re-check transparency &amp; cutout
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10"
                  onClick={refreshStatus}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Refresh status
                </Button>
              </div>
            </div>
          </section>

          <section className="cartel-panel mb-6 rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              What to do now
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">{releaseAdvice.title}</p>
            <p className="mt-1 max-w-prose text-xs text-muted-foreground">{releaseAdvice.body}</p>
            {releaseAdvice.cta === "sticker-studio" ? (
              <Button
                type="button"
                variant="outline"
                className="mt-3 min-h-11"
                onClick={() => setStep(4)}
              >
                Open Sticker Studio
              </Button>
            ) : releaseAdvice.cta === "telegram" ? (
              <Button asChild variant="outline" className="mt-3 min-h-11">
                <Link to="/telegram">Open Community Command</Link>
              </Button>
            ) : releaseAdvice.cta === "drops" ? (
              <Button asChild variant="outline" className="mt-3 min-h-11">
                <Link to="/distribution" search={packId ? { pack: packId } : {}}>
                  Manage Sticker Drops
                </Link>
              </Button>
            ) : releaseAdvice.cta === "lifecycle" ? (
              <Button
                type="button"
                className="mt-3 min-h-11"
                disabled={!lifecycleEnabled || lifecycleBusy}
                onClick={runLifecycleAction}
              >
                {lifecycleBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                {lifecycleLabel}
              </Button>
            ) : null}
          </section>



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




          <ul className="grid gap-2 sm:gap-3 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
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

                  <details className="mt-3 rounded-md border border-border/60 bg-background/30 p-2">
                    <summary className="min-h-9 cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Emoji &amp; search keywords
                    </summary>
                    <div className="mt-2 grid grid-cols-[5rem_1fr] gap-2 [&>*]:min-w-0">
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
                  </details>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10"
              disabled={saving}
              onClick={() => void persist()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save emoji &amp; keywords
            </Button>
            <p className="text-xs text-muted-foreground">
              Emoji and search keywords are Telegram metadata for this pack — optional to adjust
              before publishing.
            </p>
          </div>


          <Card className="cartel-panel mt-6">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Community targets</CardTitle>
              <StatusBadge
                tone={
                  telegramGroup.connectedGroupCount === 0
                    ? "muted"
                    : groupsSelectedAndReady
                      ? "green"
                      : "gold"
                }
              >
                {selectedGroupIds.length} of {telegramGroup.connectedGroupCount} selected
              </StatusBadge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Choose which Telegram communities connected to {projectName} receive this pack.
                Selecting several communities does not create several packs or several Telegram
                sticker sets — one sticker set is created for this pack and shared with each
                selected community. Connecting, reconnecting and onboarding communities happens in
                Community Command.
              </p>

              {!telegram.botConfigured || !telegram.ownerConnected ? (
                <div className="space-y-2 rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
                  <p>
                    {telegram.botConfigured
                      ? "Your Telegram identity is not verified yet."
                      : "The Telegram service is not available yet."}
                  </p>
                  <Button asChild size="sm" variant="outline" className="min-h-10">
                    <Link to="/telegram">Open Community Command</Link>
                  </Button>
                </div>
              ) : telegramGroup.groupQuery.isPending && telegramGroup.groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">Loading communities…</p>
              ) : telegramGroup.groupQuery.isError && telegramGroup.groups.length === 0 ? (
                <div className="space-y-2 rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
                  <p>Your communities could not be loaded right now.</p>
                  <Button asChild size="sm" variant="outline" className="min-h-10">
                    <Link to="/telegram">Open Community Command</Link>
                  </Button>
                </div>
              ) : telegramGroup.connectedGroupCount === 0 ? (
                <div className="space-y-2 rounded-md border border-border/70 bg-surface-raised/50 p-3 text-xs text-muted-foreground">
                  <p>No Telegram community is connected to this project yet.</p>
                  <Button asChild size="sm" variant="outline" className="min-h-10">
                    <Link to="/telegram">Open Community Command</Link>
                  </Button>
                </div>
              ) : (
                <>
                  <ul className="space-y-2">
                    {telegramGroup.readiness.map((r) => {
                      const id = r.group.id;
                      const checked = selectedGroupIds.includes(id);
                      const stateLabel = r.ready
                        ? "Ready"
                        : r.botRemoved
                          ? "Reconnect required"
                          : "Needs setup";
                      return (
                        <li
                          key={id}
                          className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border/60 bg-background/40 p-3"
                        >
                          <Checkbox
                            id={`target-${id}`}
                            checked={checked}
                            onCheckedChange={() => telegramGroup.toggleGroup(id)}
                          />
                          <Label
                            htmlFor={`target-${id}`}
                            className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium text-foreground"
                          >
                            {r.group.title}
                          </Label>
                          <StatusBadge tone={r.ready ? "green" : "red"}>{stateLabel}</StatusBadge>
                          {!r.ready ? (
                            <Button asChild size="sm" variant="ghost" className="min-h-9">
                              <Link to="/telegram">Fix in Community Command</Link>
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-10"
                      onClick={telegramGroup.selectAllGroups}
                      disabled={
                        selectedGroupIds.length ===
                        Math.min(telegramGroup.groups.length, MAX_DISTRIBUTION_TARGETS)
                      }
                    >
                      {telegramGroup.groups.length > MAX_DISTRIBUTION_TARGETS
                        ? `Select first ${MAX_DISTRIBUTION_TARGETS}`
                        : "Select all"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-10"
                      onClick={telegramGroup.clearGroupSelection}
                      disabled={selectedGroupIds.length === 0}
                    >
                      Clear selection
                    </Button>
                    <Button asChild size="sm" variant="ghost" className="min-h-10">
                      <Link to="/telegram">Open Community Command</Link>
                    </Button>
                  </div>

                  {telegramGroup.groups.length > MAX_DISTRIBUTION_TARGETS ? (
                    <p className="text-xs text-muted-foreground">
                      One send covers up to {MAX_DISTRIBUTION_TARGETS} communities. Run it again for
                      the rest.
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>


          <Card className="cartel-panel mt-6">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Publish &amp; send to communities</CardTitle>
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
                  <StatusBadge tone="green">Telegram verified</StatusBadge>
                ) : (
                  <StatusBadge tone="red">Connect a Telegram community</StatusBadge>
                )}
                {telegramGroup.connectedGroupCount === 0 ? (
                  <StatusBadge tone="red">No community connected</StatusBadge>
                ) : selectedGroupIds.length === 0 ? (
                  <StatusBadge tone="red">No community selected</StatusBadge>
                ) : groupsSelectedAndReady ? (
                  <StatusBadge tone="green">
                    {selectedGroupIds.length} of {telegramGroup.connectedGroupCount} communit
                    {telegramGroup.connectedGroupCount === 1 ? "y" : "ies"} selected
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="red">A selected community is not verified</StatusBadge>
                )}

                <StatusBadge tone={exportableCount > 0 ? "gold" : "muted"}>
                  {exportableCount} export-ready
                </StatusBadge>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
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

              <details className="rounded-md border border-border/70 bg-background/40 p-3">
                <summary className="min-h-9 cursor-pointer text-xs font-semibold text-muted-foreground">
                  Telegram set naming
                </summary>
                <p className="mt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  Short name preview:{" "}
                  <span className="font-mono text-foreground">
                    {tgPack?.telegram_set_name ??
                      shortNamePreview ??
                      "available once the bot is configured"}
                  </span>
                  . The authoritative set name is decided by the server at publish time. Stickers
                  without an emoji fall back to 🐸.
                </p>
              </details>


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

              {telegramGroup.groups.length > 0 ? (
                <ul className="space-y-2 text-xs">
                  {/* Every connected community is listed for THIS pack. Durable
                      per-group rows are authoritative; the most recent run only
                      fills in before the persisted state has loaded. */}
                  {telegramGroup.groups.map((g) => {
                    const persisted = distTargets.find((t) => t.group_connection_id === g.id);
                    const live = distResult?.results.find((r) => r.groupConnectionId === g.id);
                    const status = persisted?.status ?? live?.status ?? null;
                    const detail = persisted?.last_error ?? live?.message ?? live?.reason ?? null;
                    const isSelected = selectedGroupIds.includes(g.id);
                    return (
                      <li
                        key={g.id}
                        className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {g.title}
                        </span>
                        <StatusBadge
                          tone={
                            status === "assigned"
                              ? "green"
                              : status === "announced"
                                ? "gold"
                                : status === "failed"
                                  ? "red"
                                  : "muted"
                          }
                        >
                          {status === "assigned"
                            ? "Official set"
                            : status === "announced"
                              ? "Pack announced"
                              : status === "failed"
                                ? "Needs retry"
                                : status
                                  ? status
                                  : "Not added yet"}
                        </StatusBadge>
                        {isSelected ? (
                          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            selected
                          </span>
                        ) : null}
                        {detail ? (
                          <span className="w-full text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                            {detail}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {distError ? (
                <p className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
                  Sticker set stays published — community delivery needs attention. {distError}
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
                <details className="rounded-md border border-border/70 bg-background/40 p-3">
                  <summary className="min-h-9 cursor-pointer text-xs font-semibold text-muted-foreground">
                    Per-sticker Telegram status
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs">
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
                </details>
              ) : null}


              <p className="min-w-0 rounded-md border border-border/70 bg-surface-raised/50 p-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {lifecycleMode === "publish"
                  ? "This pack has not been published to Telegram yet. Publishing creates one sticker set and sends it to the communities you selected."
                  : lifecycleMode === "update"
                    ? `${unpublishedReviewedIds.length} reviewed sticker${unpublishedReviewedIds.length === 1 ? "" : "s"} are not on the existing Telegram set yet. Publishing adds them — the set is never recreated.`
                    : lifecycleMode === "add"
                      ? `The set is live in ${deliveredTargetIds.length} communit${deliveredTargetIds.length === 1 ? "y" : "ies"}. ${newTargetIds.length} newly selected communit${newTargetIds.length === 1 ? "y has" : "ies have"} not received it yet.`
                      : lifecycleMode === "retry"
                        ? `Every sticker is published. ${failedTargetIds.length} communit${failedTargetIds.length === 1 ? "y" : "ies"} failed community send and can be retried safely.`
                        : lifecycleMode === "attention"
                          ? `${totalConcepts - tgPublishedCount} sticker${totalConcepts - tgPublishedCount === 1 ? " is" : "s are"} still not published. Finish Review so they pass the transparency and cutout checks, then publish the update.`
                          : `Everything is current: all reviewed stickers are published and all ${deliveredTargetIds.length} selected communit${deliveredTargetIds.length === 1 ? "y has" : "ies have"} the pack.`}
              </p>

              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  className="min-h-11 flex-1 sm:flex-none"
                  disabled={!lifecycleEnabled || lifecycleBusy}
                  onClick={runLifecycleAction}
                >
                  {lifecycleBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-4" aria-hidden="true" />
                  )}
                  {lifecycleLabel}
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
                  Send test sticker to community
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
                One Telegram sticker set is created for this pack and then sent to the groups
                you selected — connecting more groups later lets you send the same set again
                without recreating it. The test sends a <strong>native Telegram sticker</strong> into
                a single selected group, not an image file, and works for any verified connected
                group — basic group or supergroup. Telegram’s{" "}
                <strong>official group sticker set</strong> is separate and optional — it only
                exists for eligible supergroups; otherwise CARTEL HQ posts the pack link in the
                community instead.
              </p>
              {!canPublish && !publishing && !allPublished ? (
                <p className="text-xs text-muted-foreground">
                  Publishing needs: an available Telegram service, a connected Telegram community
                  (connect it in Community Command), at least one selected and verified group or supergroup (bot admin + Change Group Info), at
                  least one export-ready sticker, and all browser/cutout checks finished.
                </p>

              ) : null}

            </CardContent>
          </Card>


          <details className="mt-6 rounded-md border border-border bg-background/40 p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Download className="mr-2 inline size-3.5" aria-hidden="true" />
              Export / backup ({exportableCount})
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                {checksRunning
                  ? "Export is paused until the browser transparency and cutout checks finish."
                  : "Exports are transparent PNGs downloaded straight to this device. Nothing is uploaded or published."}
              </p>
              <Button
                type="button"
                variant="outline"
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
              {omittedLabels.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  The ZIP will contain {exportableCount} sticker
                  {exportableCount === 1 ? "" : "s"}. Not included ({omittedLabels.length}):{" "}
                  {omittedLabels.join(", ")}.
                </p>
              ) : null}
            </div>
          </details>

          <details className="mt-3 rounded-md border border-border bg-background/40 p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Advanced details
            </summary>
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-xs font-semibold text-pepe">
                  How Telegram cutout verification works
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  The checkerboard behind each preview marks the pixels that are actually
                  transparent. Some image viewers display transparent areas as white or black — that
                  is the viewer compositing the image, not a background baked into the file.
                  Telegram places the transparent sticker directly over the chat background, so no
                  rectangular background appears. A transparent canvas alone is not enough, though:
                  some generations bake a thick white or cream contour around the artwork. Before
                  export, CARTEL HQ removes only the light halo that is connected to the transparent
                  outside edge — internal whites such as shirts, teeth, eyes, highlights and
                  lettering interiors are always preserved, and if the halo looks unexpectedly large
                  the sticker is flagged for manual review instead of being cleaned. Cleanup happens
                  in your browser on the exported copy only; the stored original is never modified.
                </p>
              </div>
              {historyRows.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <FileArchive className="mr-2 inline size-3.5" aria-hidden="true" />
                    Generation history ({historyRows.length})
                  </p>
                  <ul className="mt-2 space-y-2">
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
                          <span className="text-muted-foreground">
                            · last failure: {row.lastFailure}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>

          {allPublished || packSchedules.length > 0 ? (
            <Card className="cartel-panel mt-6">
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">Next step — Sticker Drops</CardTitle>
                <StatusBadge tone={packSchedules.length > 0 ? "green" : "muted"}>
                  {packSchedules.length > 0 ? `${packSchedules.length} scheduled` : "No schedule"}
                </StatusBadge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  Sending a pack here is a one-time delivery. Sticker Drops schedules recurring,
                  capped posting of this pack into the Telegram communities connected to{" "}
                  {projectName}.
                </p>
                {dropKillSwitch ? (
                  <p className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
                    Project emergency pause is on — no automated drops are running.
                  </p>
                ) : null}
                <Button asChild variant="outline" size="sm" className="min-h-10">
                  <Link to="/distribution" search={packId ? { pack: packId } : {}}>
                    Manage Sticker Drops
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}



          <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Publish this pack to Telegram?</AlertDialogTitle>
                <AlertDialogDescription>
                  <strong>One</strong> Telegram sticker set will be created for this pack, using
                  the Telegram identity verified during community connection.{" "}
                  {reviewedStickerIds.length} reviewed sticker
                  {reviewedStickerIds.length === 1 ? "" : "s"} will be uploaded. Telegram
                  sticker-set ownership cannot be transferred later.
                  <br />
                  <br />
                  {selectedGroupIds.length === 0 ? (
                    <>
                      No connected group is selected. Select at least one group above before
                      publishing and sending to communities.
                    </>
                  ) : (
                    <>
                      After the set is created it will be sent once to the{" "}
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
                    void doPublish(selectedGroupIds);
                  }}
                >
                  Publish &amp; send
                </AlertDialogAction>

              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </StepCard>
      ) : null}

      <nav
        aria-label="Builder navigation"
        className="hidden flex-col-reverse gap-3 border-t border-border pt-6 sm:flex sm:flex-row sm:items-center sm:justify-between"
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

      {/* Mobile workflow bar — reuses the same goBack / goNext handlers. */}
      <StickyActionBar
        desktop="hidden"
        className="sm:hidden"
        start={
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
        }
        end={
          step < BUILDER_STEPS.length ? (
            <Button type="button" className="min-h-11" onClick={goNext}>
              Continue
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/sticker-lab">Finish</Link>
            </Button>
          )
        }
      />
    </div>
  );
}




