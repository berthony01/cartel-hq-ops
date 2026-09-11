import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Lock, Sparkles } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { formatBytes } from "@/lib/media";
import {
  MOTION_SAFETY_NOTE,
  currentMotionVersion,
  sourceIsCurrentStatic,
  type MotionMode,
  type StickerMotionState,
  type StickerMotionVersion,
} from "@/lib/sticker-motion";
import {
  MAX_MOTION_INSTRUCTION_LENGTH,
  MOTION_PRESET_LABELS,
  STICKER_MOTION_PRESETS,
  type StickerMotionAiConfig,
  type StickerMotionPreset,
} from "@/lib/sticker-motion-ai";
import {
  MOTION_STAGE_LABEL,
  isMotionBusy,
  type MotionRun,
} from "@/hooks/useStickerMotionGenerationRuntime";
import {
  TELEGRAM_PREP_STAGE_LABEL,
  isTelegramPrepBusy,
  type TelegramPrepRun,
} from "@/hooks/useStickerMotionTelegramRuntime";
import type { StickerMotionTelegramConfig } from "@/lib/sticker-motion-telegram";


/**
 * Motion Studio for one Step 4 sticker card.
 *
 * The only billable path is Generate motion → explicit confirmation dialog →
 * `onGenerate`. Approving a Current Motion is non-billable and never changes
 * the static release, `release_variant` or Telegram.
 *
 * P2-C3 is a PRESENTATION-ONLY pass: featured preview, truthful progress
 * feedback (no fabricated percentages), progressive disclosure and premium
 * hierarchy. Every guard, confirmation and callback below is unchanged.
 */

const MODE_COPY: Array<{ mode: MotionMode; title: string; description: string }> = [
  {
    mode: "quick",
    title: "Quick Motion",
    description: "Choose a preset motion.",
  },
  {
    mode: "ai",
    title: "AI Motion",
    description: "Let CARTEL HQ animate it intelligently.",
  },
  {
    mode: "custom",
    title: "Custom Motion",
    description: "Describe exactly how it should move.",
  },
];

/** Longer explanations stay as secondary guidance, never inside the cards. */
const MODE_DETAIL: Record<MotionMode, string> = {
  quick: "Pick one preset movement below. Nothing runs until you confirm.",
  ai: "CARTEL HQ derives the movement from this sticker's own concept plus your Creative Blueprint and Character Lock. It does not call a separate concept model.",
  custom: "Write the movement yourself. Be specific about pacing and what stays still.",
};

const MODE_LABEL: Record<MotionMode, string> = {
  quick: "Quick",
  ai: "AI",
  custom: "Custom",
};

/** Real stage-based milestones for Telegram preparation. */
const PREP_MILESTONES = [
  "Current Motion approved",
  "Removing background",
  "Normalizing for Telegram",
  "Ready",
];

function versionSummary(version: StickerMotionVersion): string {
  if (version.motionMode === "quick" && version.motionPreset) {
    return MOTION_PRESET_LABELS[version.motionPreset as StickerMotionPreset] ?? version.motionPreset;
  }
  const instruction = (version.motionInstruction ?? "").trim();
  if (!instruction) return "";
  return instruction.length > 140 ? `${instruction.slice(0, 140)}…` : instruction;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Truthful indeterminate activity bar — never a fabricated percentage. */
function IndeterminateBar() {
  return (
    <div
      role="progressbar"
      aria-label="Work in progress"
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gold/15"
    >
      <div className="h-full w-1/2 animate-pulse rounded-full bg-gold/70" />
    </div>
  );
}

export function MotionStudioPanel({
  stickerId,
  stickerLabel,
  state,
  loading,
  error,
  run,
  config,
  configLoading,
  configError,
  approvingVersionId,
  approveError,
  telegramRun,
  telegramConfig,
  telegramConfigLoading,
  telegramConfigError,
  telegramPublished,
  releasingMotion,
  releaseError,
  staticPreviewUrl,
  onGenerate,

  onSetCurrentMotion,
  onPrepareTelegram,
  onRetryNormalization,
  onReleaseMotion,

}: {
  stickerId: string;
  stickerLabel: string;
  state: StickerMotionState | undefined;
  loading: boolean;
  error: boolean;
  run: MotionRun;
  config: StickerMotionAiConfig | undefined;
  configLoading: boolean;
  configError: boolean;
  approvingVersionId: string | null;
  approveError: string | null;
  /** Phase C2 — Telegram preparation run state for THIS sticker. */
  telegramRun: TelegramPrepRun;
  telegramConfig: StickerMotionTelegramConfig | undefined;
  telegramConfigLoading: boolean;
  telegramConfigError: boolean;
  /** Durable Telegram footprint for THIS sticker (already live in a set). */
  telegramPublished: boolean;
  releasingMotion: boolean;
  releaseError: string | null;
  /** Presentation-only signed URL for the current static source. */
  staticPreviewUrl?: string | null;
  /** BILLABLE — only ever called from the confirmation dialog below. */

  onGenerate: (input: {
    stickerId: string;
    motionMode: MotionMode;
    motionPreset?: StickerMotionPreset;
    motionInstruction?: string;
  }) => void;
  /** Non-billable Current Motion approval. */
  onSetCurrentMotion: (input: { stickerId: string; motionVersionId: string }) => void;
  /** MAY BE BILLABLE — only ever called from the Telegram confirmation dialog. */
  onPrepareTelegram: (input: { stickerId: string; motionVersionId: string }) => void;
  /**
   * MAY BE BILLABLE — exactly one normalization job. Only ever called from the
   * normalization-retry confirmation dialog below.
   */
  onRetryNormalization?: ((input: { stickerId: string }) => void) | undefined;

  /** REAL Telegram change — only ever called from the release confirmation dialog. */
  onReleaseMotion: (input: { stickerId: string; motionVersionId: string }) => void;
}) {

  const [mode, setMode] = useState<MotionMode>("quick");
  const [preset, setPreset] = useState<StickerMotionPreset | null>(null);
  const [instruction, setInstruction] = useState("");
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [approveTarget, setApproveTarget] = useState<StickerMotionVersion | null>(null);
  const [confirmTelegramPrep, setConfirmTelegramPrep] = useState(false);
  const [confirmNormalizationRetry, setConfirmNormalizationRetry] = useState(false);
  const [confirmMotionRelease, setConfirmMotionRelease] = useState(false);
  /** Presentation-only: reopen the creation controls after Step 1 completes. */
  const [showCreateControls, setShowCreateControls] = useState(false);



  const current = currentMotionVersion(state);
  const known = !error && !loading && !!state;
  const busy = isMotionBusy(run.stage);

  // Unknown must stay unknown: a failed probe never claims "not configured".
  const providerUnknown = configError || (configLoading && !config);
  const providerBlocked = providerUnknown || config?.configured !== true;

  // ---- Phase C2 Telegram preparation (media formatting only, never publishing)
  const telegramBusy = isTelegramPrepBusy(telegramRun.stage);
  const telegramProviderUnknown =
    telegramConfigError || (telegramConfigLoading && !telegramConfig);
  const telegramProviderBlocked =
    telegramProviderUnknown || telegramConfig?.configured !== true;
  const currentIsTelegramReady = !!current?.telegramAssetId;
  const currentFromCurrentStatic = current
    ? sourceIsCurrentStatic(current, state?.currentStaticAssetId)
    : false;
  const canPrepareTelegram =
    !!current && currentFromCurrentStatic && !currentIsTelegramReady;
  const prepareDisabled =
    telegramBusy || telegramProviderBlocked || busy || approvingVersionId !== null;

  // ---- R3 normalization-only recovery eligibility (client gate only; the
  // server independently re-validates the durable failure code and lineage).
  const canRetryNormalization =
    !!onRetryNormalization &&
    !!telegramRun.retryableNormalizationJobId &&
    !telegramBusy &&
    !currentIsTelegramReady &&
    canPrepareTelegram;
  const retryNormalizationDisabled =
    prepareDisabled || telegramRun.retryingNormalization === true;


  // ---- Phase C3 motion release (real Telegram replacement, no provider work)
  const anyMotionIsLive = state?.releaseVariant === "motion";
  const currentMotionIsLive =
    anyMotionIsLive && !!current && state?.releasedMotionVersionId === current.id;
  const canShowRelease =
    !!current &&
    currentIsTelegramReady &&
    currentFromCurrentStatic &&
    telegramPublished &&
    !currentMotionIsLive;

  const releaseDisabled =
    releasingMotion || busy || telegramBusy || approvingVersionId !== null;




  const requirementsMet =
    mode === "quick"
      ? preset !== null
      : mode === "custom"
        ? instruction.trim().length > 0
        : true;

  const generateDisabled = busy || providerBlocked || !requirementsMet || approvingVersionId !== null;

  const model = config?.model ?? "the configured motion model";
  const durationSeconds = config?.durationSeconds ?? 5;

  const versions = state?.versions ?? [];
  const newestEligibleVersion = versions.reduce<StickerMotionVersion | null>((newest, version) => {
    if (
      !version.motionAssetId ||
      !sourceIsCurrentStatic(version, state?.currentStaticAssetId) ||
      version.id === state?.currentMotionVersionId
    ) {
      return newest;
    }
    return !newest || version.versionNumber > newest.versionNumber ? version : newest;
  }, null);
  const createComplete = !!current && currentFromCurrentStatic;
  const prepareComplete = createComplete && currentIsTelegramReady;
  const releaseComplete = currentMotionIsLive;
  const activeStep = releaseComplete ? null : !createComplete ? 1 : !prepareComplete ? 2 : 3;
  const approvingPrimary =
    !!newestEligibleVersion && approvingVersionId === newestEligibleVersion.id;
  const approvePrimaryDisabled = busy || telegramBusy || approvingVersionId !== null;

  // ---------------------------------------------------------- release state
  const releaseStateLabel = currentMotionIsLive
    ? "Motion Live"
    : currentIsTelegramReady
      ? "Telegram Ready"
      : current
        ? "Motion Draft"
        : "Static Live";

  // ------------------------------------------------- featured motion preview
  /** Current Motion wins; otherwise the newest eligible generated take. */
  const featured = current ?? newestEligibleVersion;
  const featuredUsesTelegram = !!featured?.telegramPreviewUrl;
  const featuredSrc = featured
    ? (featured.telegramPreviewUrl ?? featured.previewUrl)
    : null;
  const featuredMime = featuredUsesTelegram ? featured?.telegramMimeType : featured?.mimeType;
  const featuredSize = featuredUsesTelegram
    ? featured?.telegramFileSizeBytes
    : featured?.fileSizeBytes;
  const featuredIsCurrent = !!featured && featured.id === state?.currentMotionVersionId;

  // ----------------------------------------- truthful operation status panel
  const activeOperation: {
    kind: "generate" | "prepare" | "retry" | "release";
    title: string;
    stageLabel: string;
    note: string;
  } | null = busy
    ? {
        kind: "generate",
        title: "Generating motion",
        stageLabel: MOTION_STAGE_LABEL[run.stage],
        note: "No automatic retry. Your static sticker, Current Motion and Telegram release stay unchanged.",
      }
    : telegramBusy
      ? {
          kind: "prepare",
          title: "Preparing for Telegram",
          stageLabel: TELEGRAM_PREP_STAGE_LABEL[telegramRun.stage],
          note: "Media preparation only. Nothing is published to Telegram in this step.",
        }
      : telegramRun.retryingNormalization === true
        ? {
            kind: "retry",
            title: "Retrying normalization",
            stageLabel: "Normalizing for Telegram",
            note: "Background removal is reused. Nothing is published to Telegram in this step.",
          }
        : releasingMotion
          ? {
              kind: "release",
              title: "Updating Telegram sticker pack",
              stageLabel: "Releasing motion",
              note: "Replacing this one sticker in place. No provider work starts.",
            }
          : null;

  const operationKind = activeOperation?.kind ?? null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!operationKind) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const id = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [operationKind]);

  /** Index of the milestone currently reached — derived from real stages only. */
  const prepMilestoneIndex =
    telegramRun.stage === "normalizing" || activeOperation?.kind === "retry"
      ? 2
      : telegramRun.stage === "background"
        ? 1
        : telegramRun.stage === "starting"
          ? 0
          : currentIsTelegramReady
            ? 3
            : 0;

  const createControlsOpen = activeStep === 1 || showCreateControls;

  const nextActionLabel = releaseComplete
    ? "Motion is live in the sticker pack"
    : activeStep === 1
      ? newestEligibleVersion && !busy
        ? "Step 1 of 3 · Set Current Motion"
        : "Step 1 of 3 · Generate motion"
      : activeStep === 2
        ? "Step 2 of 3 · Prepare for Telegram"
        : "Step 3 of 3 · Release to Pack";

  const workflowSteps = [
    {
      number: 1,
      title: "Create Motion",
      complete: createComplete,
      locked: false,
      lockedReason: "",
    },
    {
      number: 2,
      title: "Prepare for Telegram",
      complete: prepareComplete,
      locked: !createComplete,
      lockedReason: "Available after you set a Current Motion",
    },
    {
      number: 3,
      title: "Release to Pack",
      complete: releaseComplete,
      locked: !prepareComplete,
      lockedReason: "Available after Telegram preparation",
    },
  ];

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-gold/20 bg-surface-raised/30 shadow-[0_18px_48px_-32px_var(--gold)]">
      {/* --------------------------------------------- premium studio header */}
      <div className="sticky top-0 z-10 border-b border-border-subtle bg-background/90 px-3 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="type-eyebrow text-gold">Motion Studio</p>
            <p className="truncate text-sm font-semibold text-foreground">{stickerLabel}</p>
          </div>
          {error ? (
            <StatusBadge tone="muted">Status unavailable</StatusBadge>
          ) : known ? (
            <StatusBadge tone={releaseStateLabel === "Static Live" ? "muted" : "gold"}>
              {releaseStateLabel}
            </StatusBadge>
          ) : null}
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
          {releaseComplete ? (
            <CheckCircle2 className="size-3.5 text-pepe" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5 text-gold" aria-hidden="true" />
          )}
          {nextActionLabel}
        </p>
      </div>

      <div className="p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {currentMotionIsLive
            ? "The Current Motion is the live Telegram release for this sticker."
            : anyMotionIsLive
              ? "A different Motion version is the live Telegram release. This Current Motion stays separate until you explicitly release it."
              : "Animate the approved static without replacing it. Nothing reaches Telegram until you explicitly release motion."}
        </p>

        {error ? (
          <p className="mt-2 text-xs text-signal">Motion status unavailable</p>
        ) : !known ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading motion status…</p>
        ) : null}

        {/* -------------------------------------- progressive workflow steps */}
        <ol className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Motion workflow">
          {workflowSteps.map((step) => {
            const isCurrent = activeStep === step.number;
            const status = step.complete ? "Completed" : step.locked ? "Locked" : "Current";
            return (
              <li
                key={step.number}
                aria-current={isCurrent ? "step" : undefined}
                className={`rounded-md border px-3 py-2.5 transition ${
                  step.complete
                    ? "border-pepe/40 bg-pepe/5"
                    : isCurrent
                      ? "border-gold/80 bg-gold/10 shadow-[0_10px_30px_-24px_var(--gold)]"
                      : "border-border-subtle bg-surface-overlay/20 opacity-60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                    {step.complete ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-pepe" aria-hidden="true" />
                    ) : step.locked ? (
                      <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : null}
                    <span className="truncate">
                      {step.number}. {step.title}
                    </span>
                  </span>
                  <StatusBadge tone={step.complete ? "green" : isCurrent ? "gold" : "muted"}>
                    {status}
                  </StatusBadge>
                </div>
                {step.locked ? (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {step.lockedReason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* ------------------------------------ featured motion preview hero */}
        <section className="mt-3 rounded-md border border-border-subtle bg-background/50 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Motion preview
            </p>
            {featuredSrc ? (
              <StatusBadge tone={featuredUsesTelegram ? "green" : "gold"}>
                {featuredUsesTelegram ? "Telegram preview · background removed" : "Creative source"}
              </StatusBadge>
            ) : staticPreviewUrl ? (
              <StatusBadge tone="muted">Current static source</StatusBadge>
            ) : null}
          </div>

          <div
            className="mt-2 flex min-h-56 items-center justify-center rounded-md border border-border-subtle bg-[repeating-conic-gradient(var(--surface-overlay)_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-2"
          >
            {featuredSrc ? (
              <video
                key={featuredSrc}
                src={featuredSrc}
                controls
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                className="max-h-72 w-full rounded object-contain"
              />
            ) : staticPreviewUrl ? (
              <div className="px-4 py-6 text-center">
                <img
                  src={staticPreviewUrl}
                  alt={`${stickerLabel} current static source`}
                  className="mx-auto max-h-64 w-auto rounded object-contain shadow-sm"
                />
                <p className="mt-3 text-sm font-semibold text-foreground">Ready to animate</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Current static source. Generate motion to see the result here.
                </p>
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <Sparkles className="mx-auto size-6 text-gold/70" aria-hidden="true" />
                <p className="mt-2 text-sm font-semibold text-foreground">Ready to animate</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {featured
                    ? "Preview unavailable for this version."
                    : "Your approved static sticker is the source. Generate motion to see the result here."}
                </p>
              </div>
            )}
          </div>

          {featured ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Version {featured.versionNumber}
              {featuredIsCurrent ? " · Current Motion" : " · Awaiting approval"}
              {featuredMime ? ` · ${featuredMime}` : ""}
              {featuredSize != null ? ` · ${formatBytes(featuredSize)}` : ""}
            </p>
          ) : null}
        </section>

        {/* ------------------------------------- truthful operation status */}
        {activeOperation ? (
          <section
            aria-live="polite"
            className="mt-3 rounded-md border border-gold/40 bg-gold/5 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
                {activeOperation.title}
              </p>
              <span className="text-xs tabular-nums text-muted-foreground">
                Elapsed {formatElapsed(elapsedSeconds)}
              </span>
            </div>

            {activeOperation.kind === "prepare" || activeOperation.kind === "retry" ? (
              <ol className="mt-2 space-y-1">
                {PREP_MILESTONES.map((milestone, index) => {
                  const reached = index < prepMilestoneIndex;
                  const isNow = index === prepMilestoneIndex;
                  return (
                    <li
                      key={milestone}
                      className={`flex items-center gap-2 text-xs ${
                        isNow
                          ? "font-semibold text-foreground"
                          : reached
                            ? "text-muted-foreground"
                            : "text-muted-foreground/60"
                      }`}
                    >
                      {reached ? (
                        <CheckCircle2 className="size-3.5 text-pepe" aria-hidden="true" />
                      ) : isNow ? (
                        <Loader2 className="size-3.5 animate-spin text-gold" aria-hidden="true" />
                      ) : (
                        <span className="size-3.5 rounded-full border border-border-subtle" />
                      )}
                      {milestone}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{activeOperation.stageLabel}</p>
            )}

            <IndeterminateBar />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {activeOperation.note}
            </p>
          </section>
        ) : null}

        {/* ------------------------------------------------ Step 1: create */}
        <section className="mt-3 border-t border-border-subtle pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Step 1 · Create Motion
            </p>
            {createComplete ? <StatusBadge tone="green">Current Motion set</StatusBadge> : null}
          </div>

          {!createControlsOpen ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface-overlay/20 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {current
                  ? `Version ${current.versionNumber} approved as Current Motion.`
                  : "Completed."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11 text-xs"
                onClick={() => setShowCreateControls(true)}
              >
                Create another version
              </Button>
            </div>
          ) : (
            <>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {MODE_COPY.map((choice) => {
                  const active = mode === choice.mode;
                  return (
                    <li key={choice.mode} className="flex">
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={active}
                        onClick={() => setMode(choice.mode)}
                        className={`flex min-h-16 w-full flex-col justify-start rounded-md border p-2.5 text-left transition ${
                          active
                            ? "border-gold bg-gold/15 ring-1 ring-gold/50"
                            : "border-border-subtle bg-surface-overlay/20 hover:border-gold/40"
                        } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                          {choice.title}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {choice.description}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {MODE_DETAIL[mode]}
              </p>

              {mode === "quick" ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {STICKER_MOTION_PRESETS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      disabled={busy}
                      aria-pressed={preset === key}
                      onClick={() => setPreset(key)}
                      className={`min-h-11 rounded-full border px-3 text-xs font-medium transition ${
                        preset === key
                          ? "border-gold bg-gold/15 text-foreground ring-1 ring-gold/50"
                          : "border-border-subtle text-muted-foreground hover:text-foreground"
                      } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {MOTION_PRESET_LABELS[key]}
                    </button>
                  ))}
                </div>
              ) : null}

              {mode === "custom" ? (
                <div className="mt-2">
                  <Textarea
                    value={instruction}
                    disabled={busy}
                    maxLength={MAX_MOTION_INSTRUCTION_LENGTH}
                    rows={3}
                    placeholder="Describe the movement, e.g. slow confident nod while the smoke drifts upward."
                    onChange={(e) =>
                      setInstruction(e.target.value.slice(0, MAX_MOTION_INSTRUCTION_LENGTH))
                    }
                    className="text-sm"
                  />
                  <p className="mt-1 text-right text-xs text-muted-foreground">
                    {instruction.length}/{MAX_MOTION_INSTRUCTION_LENGTH}
                  </p>
                </div>
              ) : null}

              {providerUnknown ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Motion provider status is unknown right now. Use “Refresh status” to re-check —
                  nothing was lost.
                </p>
              ) : config?.configured !== true ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Motion provider unavailable. Motion generation stays disabled until it is
                  configured.
                </p>
              ) : null}
            </>
          )}

          {activeStep === 1 && newestEligibleVersion && !busy ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                className="min-h-11 w-full text-sm font-semibold"
                disabled={approvePrimaryDisabled}
                onClick={() => setApproveTarget(newestEligibleVersion)}
              >
                {approvingPrimary ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {approvingPrimary ? "Setting Current Motion…" : "Set Current Motion"}
              </Button>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Approve Version {newestEligibleVersion.versionNumber} from the current static image.
                This does not change Telegram and starts no provider work.
              </p>
            </div>
          ) : activeStep === 1 ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                className="min-h-11 w-full text-sm font-semibold"
                disabled={generateDisabled}
                onClick={() => setConfirmGenerate(true)}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {busy ? MOTION_STAGE_LABEL[run.stage] : "Generate motion"}
              </Button>
            </div>
          ) : createControlsOpen ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 w-full text-sm"
                disabled={generateDisabled}
                onClick={() => setConfirmGenerate(true)}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {busy ? MOTION_STAGE_LABEL[run.stage] : "Generate new version"}
              </Button>
            </div>
          ) : null}

          {run.failure && !busy ? (
            <p className="mt-2 text-xs text-signal">
              {run.failure.title}. {run.failure.body}
            </p>
          ) : null}
        </section>

        {/* --------------------------------- Phase C2 Telegram preparation */}
        <section
          className={`mt-3 border-t border-border-subtle pt-3 ${
            activeStep === 2 ? "" : "opacity-95"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Step 2 · Prepare for Telegram
            </p>
            {currentMotionIsLive ? (
              <StatusBadge tone="green">Live in sticker pack</StatusBadge>
            ) : currentIsTelegramReady ? (
              <StatusBadge tone="green">Telegram-ready</StatusBadge>
            ) : null}
          </div>

          {!current ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Available after you set a Current Motion.
            </p>
          ) : currentIsTelegramReady ? (
            currentMotionIsLive ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Version {current.versionNumber} is live in the Telegram sticker pack for this
                sticker. Its Telegram-formatted derivative replaced this sticker inside the existing
                sticker pack. It is not automatically posted as a message to any community.
              </p>
            ) : anyMotionIsLive ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                A different Motion version is currently live on Telegram for this sticker. Version{" "}
                {current.versionNumber} is prepared and can replace it when you release it
                explicitly.
              </p>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                A Telegram-formatted derivative of Version {current.versionNumber} is prepared and
                stored. The Telegram release for this sticker is still static until you release
                motion explicitly.
              </p>
            )

          ) : !currentFromCurrentStatic ? (

            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              This Current Motion came from an earlier static image. Generate and approve motion
              from the current static image before preparing it for Telegram.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Prepares a Telegram-formatted derivative of Version {current.versionNumber}. This is
                media preparation only — nothing is published to Telegram and the release stays
                static.
              </p>
              {telegramProviderUnknown ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Telegram preparation provider status is unknown right now. Use “Refresh status” to
                  re-check — nothing was lost.
                </p>
              ) : telegramConfig?.configured !== true ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {(() => {
                    const missing = [];
                    if (telegramConfig?.falConfigured !== true) missing.push("fal.ai");
                    if (telegramConfig?.cloudConvertConfigured !== true)
                      missing.push("CloudConvert");
                    if (missing.length === 0) return "Telegram preparation is not configured yet.";
                    const list = missing.join(missing.length === 2 ? " and " : "");
                    return `Telegram preparation is unavailable. Missing provider${missing.length === 2 ? "s" : ""}: ${list}.`;
                  })()}
                </p>
              ) : null}
              {activeStep === 2 ? (
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 min-h-11 w-full text-sm font-semibold"
                  disabled={prepareDisabled || !canPrepareTelegram}
                  onClick={() => setConfirmTelegramPrep(true)}
                >
                  {telegramBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  {telegramBusy
                    ? TELEGRAM_PREP_STAGE_LABEL[telegramRun.stage]
                    : "Prepare for Telegram"}
                </Button>
              ) : null}
            </>
          )}

          {telegramRun.failure && !telegramBusy && !currentIsTelegramReady ? (
            <p className="mt-2 text-xs text-signal">
              {telegramRun.failure.title}. {telegramRun.failure.body}
            </p>
          ) : null}

          {/* ---- R3 normalization-only recovery. Never a new background removal. */}
          {canRetryNormalization ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2 min-h-11 w-full text-sm"
                disabled={retryNormalizationDisabled}
                onClick={() => setConfirmNormalizationRetry(true)}
              >
                {telegramRun.retryingNormalization ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Retry normalization only
              </Button>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                This reuses the successful fal.ai background-removal result and re-runs CloudConvert
                formatting only.
              </p>
            </>
          ) : null}
        </section>

        {/* -------------------- Phase C3 explicit motion release to Telegram */}
        <section className="mt-3 border-t border-border-subtle pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Step 3 · Release to Pack
            </p>
            {releaseComplete ? <StatusBadge tone="green">Motion Live</StatusBadge> : null}
          </div>

          {releaseComplete ? (
            <div className="mt-2 flex items-start gap-2 rounded-md border border-pepe/40 bg-pepe/5 p-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-pepe" aria-hidden="true" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Motion is live in the Telegram sticker pack for this sticker. Nothing further is
                required.
              </p>
            </div>
          ) : canShowRelease ? (
            <>
              <Button
                type="button"
                size="sm"
                className="mt-3 min-h-11 w-full text-sm font-semibold"
                disabled={releaseDisabled}
                onClick={() => setConfirmMotionRelease(true)}
              >
                {releasingMotion ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {releasingMotion ? "Releasing motion…" : "Release motion to sticker pack"}
              </Button>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                This replaces this one sticker in place in the existing Telegram set using the
                already-prepared file. No new provider work starts.
              </p>
            </>
          ) : current && currentIsTelegramReady && !telegramPublished ? (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Publish the static sticker pack in Step 5 first. Releasing motion replaces an existing
              live Telegram sticker, so there must already be one to replace.
            </p>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Available after Telegram preparation.
            </p>
          )}

          {releaseError && !currentMotionIsLive ? (
            <p className="mt-2 text-xs text-signal">{releaseError}</p>
          ) : null}
        </section>

        {/* -------------------------------------------------- motion history */}
        {versions.length > 0 ? (
          <details className="mt-3 border-t border-border-subtle pt-3">
            <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
              Version history · {versions.length} version{versions.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-2">
              {versions.map((version) => {
                const isCurrent = state?.currentMotionVersionId === version.id;
                const fromCurrentStatic = sourceIsCurrentStatic(
                  version,
                  state?.currentStaticAssetId,
                );
                const summary = versionSummary(version);
                return (
                  <li key={version.id} className="rounded-md border border-border-subtle p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground">
                        Version {version.versionNumber}
                      </span>
                      {version.motionMode ? (
                        <StatusBadge tone="muted">{MODE_LABEL[version.motionMode]}</StatusBadge>
                      ) : null}
                      {isCurrent ? <StatusBadge tone="gold">Current Motion</StatusBadge> : null}
                      <StatusBadge tone={version.telegramAssetId ? "green" : "muted"}>
                        {version.telegramAssetId
                          ? "Telegram-ready derivative"
                          : "Creative source — Telegram prep required"}
                      </StatusBadge>

                    </div>

                    {summary ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {summary}
                      </p>
                    ) : null}

                    {(() => {
                      const usingTelegram = !!version.telegramPreviewUrl;
                      const src = version.telegramPreviewUrl ?? version.previewUrl;
                      const mime = usingTelegram ? version.telegramMimeType : version.mimeType;
                      const size = usingTelegram
                        ? version.telegramFileSizeBytes
                        : version.fileSizeBytes;
                      return (
                        <>
                          <div className="mt-1.5">
                            {src ? (
                              <video
                                src={src}
                                controls
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                className="max-h-40 w-full rounded bg-black/40 object-contain"
                              />
                            ) : (
                              <p className="text-xs text-muted-foreground">Preview unavailable</p>
                            )}
                          </div>
                          {src ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {usingTelegram ? "Telegram-ready derivative" : "Creative source"}
                              {mime ? ` · ${mime}` : ""}
                              {size != null ? ` · ${formatBytes(size)}` : ""}
                            </p>
                          ) : null}
                        </>
                      );
                    })()}

                    {!fromCurrentStatic ? (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Based on an earlier static version. Generate motion from the current static
                        image before approving it.
                      </p>
                    ) : null}

                    {!isCurrent && version.motionAssetId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-1.5 min-h-11 w-full text-xs"
                        disabled={!fromCurrentStatic || busy || approvingVersionId !== null}
                        onClick={() => setApproveTarget(version)}
                      >
                        {approvingVersionId === version.id ? (
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                        ) : null}
                        Set Current Motion
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {approveError ? <p className="mt-2 text-xs text-signal">{approveError}</p> : null}
          </details>
        ) : null}

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{MOTION_SAFETY_NOTE}</p>
      </div>

      {/* ---------------------------------- BILLABLE generation confirmation */}
      <AlertDialog open={confirmGenerate} onOpenChange={(open) => !open && setConfirmGenerate(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate motion for {stickerLabel}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>This starts paid provider work. Before you confirm:</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Model: {model}</li>
                  <li>Provider work: 1 billable Kie video generation task</li>
                  <li>Creative source length: {durationSeconds} seconds</li>
                  <li>No automatic retry</li>
                  <li>Your current static image will not change</li>
                  <li>Current Motion will not change automatically</li>
                  <li>Telegram will not change</li>
                  <li>
                    The result is NOT Telegram-ready yet — Telegram preparation becomes available
                    after you approve a Current Motion

                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmGenerate(false);
                onGenerate({
                  stickerId,
                  motionMode: mode,
                  ...(mode === "quick" && preset ? { motionPreset: preset } : {}),
                  ...(mode === "custom" ? { motionInstruction: instruction.trim() } : {}),
                });
              }}
            >
              Generate motion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ------------------------------ non-billable Current Motion approval */}
      <AlertDialog open={!!approveTarget} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve this as Current Motion?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This does not change Telegram. Static remains the live Telegram release until you
              complete Prepare for Telegram and explicitly Release to Pack. No provider work and no
              cost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = approveTarget;
                setApproveTarget(null);
                if (target) onSetCurrentMotion({ stickerId, motionVersionId: target.id });
              }}
            >
              Set Current Motion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ------------- MAY BE BILLABLE Telegram preparation confirmation */}
      <AlertDialog
        open={confirmTelegramPrep}
        onOpenChange={(open) => !open && setConfirmTelegramPrep(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prepare {stickerLabel} for Telegram?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>This starts paid external media processing. Before you confirm:</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    It runs motion background removal and Telegram normalization through the
                    configured providers
                  </li>
                  <li>Provider billing depends on your connected provider usage and account</li>
                  <li>No automatic retry</li>
                  <li>Your current static sticker will not change</li>
                  <li>Your Current Motion will not change</li>
                  <li>Your Telegram release will not change</li>
                  <li>Nothing is published to Telegram in this step</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmTelegramPrep(false);
                if (current) onPrepareTelegram({ stickerId, motionVersionId: current.id });
              }}
            >
              Prepare for Telegram
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --------- R3 MAY BE BILLABLE normalization-only retry confirmation */}
      <AlertDialog
        open={confirmNormalizationRetry}
        onOpenChange={(open) => !open && setConfirmNormalizationRetry(false)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Retry normalization for {stickerLabel}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p>
                This reuses the successful fal.ai background-removal result and re-runs CloudConvert
                formatting only. Before you confirm:
              </p>
              <ul className="list-disc space-y-1 pl-4">
                <li>fal.ai background removal already succeeded and will NOT run again.</li>
                <li>Kling/Kie motion generation will NOT run.</li>
                <li>Exactly ONE CloudConvert normalization job may be started.</li>
                <li>There is no automatic retry.</li>
                <li>Your current static sticker remains unchanged.</li>
                <li>Your Current Motion remains unchanged.</li>
                <li>Your Telegram release remains unchanged.</li>
                <li>Nothing is published to Telegram in this step.</li>
              </ul>
            </div>
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmNormalizationRetry(false);
                onRetryNormalization?.({ stickerId });
              }}
            >
              Retry normalization only (1 job)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      {/* ---------------- REAL Telegram change: motion release confirmation */}
      <AlertDialog
        open={confirmMotionRelease}
        onOpenChange={(open) => !open && setConfirmMotionRelease(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Release motion for {stickerLabel} to the Telegram sticker pack?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>This makes a real change on Telegram. Before you confirm:</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>
                    It uses the already-prepared Telegram WEBM. No Kie generation, no fal
                    background removal and no CloudConvert normalization starts in this step
                  </li>
                  <li>It replaces this ONE sticker in place in the existing Telegram set</li>
                  <li>
                    The Telegram pack link stays the same and no sticker is added or removed
                  </li>
                  <li>Your current static image and Current Motion pointer stay unchanged</li>
                  <li>
                    Community sends and Sticker Drops continue using the current live Telegram
                    sticker ID
                  </li>
                  <li>No automatic retry</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmMotionRelease(false);
                if (current) onReleaseMotion({ stickerId, motionVersionId: current.id });
              }}
            >
              Release motion to sticker pack
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>


  );
}
