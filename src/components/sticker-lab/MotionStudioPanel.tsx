import { useState } from "react";
import { Loader2 } from "lucide-react";
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
 */

const MODE_COPY: Array<{ mode: MotionMode; title: string; description: string }> = [
  {
    mode: "quick",
    title: "Quick Motion",
    description: "Pick one preset movement.",
  },
  {
    mode: "ai",
    title: "AI Motion",
    description:
      "CARTEL HQ derives the movement from this sticker's own concept plus your Creative Blueprint and Character Lock. It does not call a separate concept model.",
  },
  {
    mode: "custom",
    title: "Custom Motion",
    description: "Describe the movement yourself.",
  },
];

const MODE_LABEL: Record<MotionMode, string> = {
  quick: "Quick",
  ai: "AI",
  custom: "Custom",
};

function versionSummary(version: StickerMotionVersion): string {
  if (version.motionMode === "quick" && version.motionPreset) {
    return MOTION_PRESET_LABELS[version.motionPreset as StickerMotionPreset] ?? version.motionPreset;
  }
  const instruction = (version.motionInstruction ?? "").trim();
  if (!instruction) return "";
  return instruction.length > 140 ? `${instruction.slice(0, 140)}…` : instruction;
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

  return (
    <div className="mt-3 rounded-md border border-border bg-background/40 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Motion Studio
        </p>
        {error ? (
          <StatusBadge tone="muted">Status unavailable</StatusBadge>
        ) : known ? (
          <StatusBadge tone={state.releaseVariant === "motion" ? "gold" : "muted"}>
            {state.releaseVariant === "motion" ? "Motion" : "Static"}
          </StatusBadge>
        ) : null}
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        Animate the approved static without replacing or damaging it. Motion keeps its own version
        history.{" "}
        {currentMotionIsLive
          ? "The Current Motion is the live Telegram release for this sticker."
          : anyMotionIsLive
            ? "A different Motion version is the live Telegram release. This Current Motion stays separate until you explicitly release it."
            : "It stays separate from Telegram until you explicitly release motion."}

      </p>


      <dl className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
        {error ? (
          <div className="text-signal">Motion status unavailable</div>
        ) : !known ? (
          <div>Loading motion status…</div>
        ) : (
          <>
            <div>
              <dt className="inline">Current release: </dt>
              <dd className="inline text-foreground">
                {state.releaseVariant === "motion" ? "Motion" : "Static"}
              </dd>
            </div>
            <div>
              <dt className="inline">Motion versions: </dt>
              <dd className="inline text-foreground">{state.versions.length}</dd>
            </div>
            <div>
              <dt className="inline">Current Motion: </dt>
              <dd className="inline text-foreground">
                {current ? `Version ${current.versionNumber}` : "None"}
              </dd>
            </div>
          </>
        )}
      </dl>

      {/* ------------------------------------------------------- controls */}
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-3">
        {MODE_COPY.map((choice) => {
          const active = mode === choice.mode;
          return (
            <li key={choice.mode}>
              <button
                type="button"
                disabled={busy}
                aria-pressed={active}
                onClick={() => setMode(choice.mode)}
                className={`w-full rounded border p-2 text-left transition ${
                  active
                    ? "border-gold/70 bg-gold/10"
                    : "border-border/70 bg-surface-raised/20 hover:border-border"
                } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
                  {choice.title}
                </span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                  {choice.description}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {mode === "quick" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STICKER_MOTION_PRESETS.map((key) => (
            <button
              key={key}
              type="button"
              disabled={busy}
              aria-pressed={preset === key}
              onClick={() => setPreset(key)}
              className={`min-h-8 rounded-full border px-2.5 text-[10px] transition ${
                preset === key
                  ? "border-gold/70 bg-gold/15 text-foreground"
                  : "border-border/70 text-muted-foreground hover:text-foreground"
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
            onChange={(e) => setInstruction(e.target.value.slice(0, MAX_MOTION_INSTRUCTION_LENGTH))}
            className="text-[11px]"
          />
          <p className="mt-1 text-right text-[10px] text-muted-foreground">
            {instruction.length}/{MAX_MOTION_INSTRUCTION_LENGTH}
          </p>
        </div>
      ) : null}

      {providerUnknown ? (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Motion provider status is unknown right now. Use “Refresh status” to re-check — nothing
          was lost.
        </p>
      ) : config?.configured !== true ? (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Motion provider unavailable. Motion generation stays disabled until it is configured.
        </p>
      ) : null}

      <div className="mt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-10 w-full text-[11px]"
          disabled={generateDisabled}
          onClick={() => setConfirmGenerate(true)}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? MOTION_STAGE_LABEL[run.stage] : "Generate motion"}
        </Button>
      </div>

      {run.failure && !busy ? (
        <p className="mt-2 text-[11px] text-signal">
          {run.failure.title}. {run.failure.body}
        </p>
      ) : null}

      {/* --------------------------------- Phase C2 Telegram preparation */}
      <div className="mt-3 border-t border-border/70 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Telegram preparation
          </p>
          {currentMotionIsLive ? (
            <StatusBadge tone="green">Live in sticker pack</StatusBadge>
          ) : currentIsTelegramReady ? (
            <StatusBadge tone="green">Telegram-ready</StatusBadge>
          ) : null}
        </div>

        {!current ? (
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            Approve a Current Motion first. Telegram preparation only runs on the approved Current
            Motion.
          </p>
        ) : currentIsTelegramReady ? (
          currentMotionIsLive ? (
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Version {current.versionNumber} is live in the Telegram sticker pack for this
              sticker. Its Telegram-formatted derivative replaced this sticker inside the existing
              sticker pack. It is not automatically posted as a message to any community.
            </p>
          ) : anyMotionIsLive ? (
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              A different Motion version is currently live on Telegram for this sticker. Version{" "}
              {current.versionNumber} is prepared and can replace it when you release it explicitly.
            </p>
          ) : (
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              A Telegram-formatted derivative of Version {current.versionNumber} is prepared and
              stored. The Telegram release for this sticker is still static until you release motion
              explicitly.
            </p>
          )

        ) : !currentFromCurrentStatic ? (

          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            This Current Motion came from an earlier static image. Generate and approve motion from
            the current static image before preparing it for Telegram.
          </p>
        ) : (
          <>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Prepares a Telegram-formatted derivative of Version {current.versionNumber}. This is
              media preparation only — nothing is published to Telegram and the release stays
              static.
            </p>
            {telegramProviderUnknown ? (
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Telegram preparation provider status is unknown right now. Use “Refresh status” to
                re-check — nothing was lost.
              </p>
            ) : telegramConfig?.configured !== true ? (
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {(() => {
                  const missing = [];
                  if (telegramConfig?.falConfigured !== true) missing.push("fal.ai");
                  if (telegramConfig?.cloudConvertConfigured !== true) missing.push("CloudConvert");
                  if (missing.length === 0) return "Telegram preparation is not configured yet.";
                  const list = missing.join(missing.length === 2 ? " and " : "");
                  return `Telegram preparation is unavailable. Missing provider${missing.length === 2 ? "s" : ""}: ${list}.`;
                })()}
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 min-h-10 w-full text-[11px]"
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
          </>
        )}

        {telegramRun.failure && !telegramBusy && !currentIsTelegramReady ? (
          <p className="mt-2 text-[11px] text-signal">
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
              className="mt-2 min-h-10 w-full text-[11px]"
              disabled={retryNormalizationDisabled}
              onClick={() => setConfirmNormalizationRetry(true)}
            >
              {telegramRun.retryingNormalization ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Retry normalization only
            </Button>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              This reuses the successful fal.ai background-removal result and re-runs CloudConvert
              formatting only.
            </p>
          </>
        ) : null}


        {/* -------------------- Phase C3 explicit motion release to Telegram */}
        {canShowRelease ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 min-h-10 w-full text-[11px]"
              disabled={releaseDisabled}
              onClick={() => setConfirmMotionRelease(true)}
            >
              {releasingMotion ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {releasingMotion ? "Releasing motion…" : "Release motion to sticker pack"}
            </Button>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              This replaces this one sticker in place in the existing Telegram set using the
              already-prepared file. No new provider work starts.
            </p>
          </>
        ) : current && currentIsTelegramReady && !currentMotionIsLive && !telegramPublished ? (
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Publish the static sticker pack in Step 5 first. Releasing motion replaces an existing
            live Telegram sticker, so there must already be one to replace.
          </p>
        ) : null}

        {releaseError && !currentMotionIsLive ? (

          <p className="mt-2 text-[11px] text-signal">{releaseError}</p>
        ) : null}
      </div>



      {/* -------------------------------------------------- motion history */}
      {versions.length > 0 ? (
        <div className="mt-3 border-t border-border/70 pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Motion history
          </p>
          <ul className="mt-2 space-y-2">
            {versions.map((version) => {
              const isCurrent = state?.currentMotionVersionId === version.id;
              const fromCurrentStatic = sourceIsCurrentStatic(
                version,
                state?.currentStaticAssetId,
              );
              const summary = versionSummary(version);
              return (
                <li key={version.id} className="rounded border border-border/70 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-foreground">
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
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
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
                            <p className="text-[10px] text-muted-foreground">Preview unavailable</p>
                          )}
                        </div>
                        {src ? (
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {usingTelegram ? "Telegram-ready derivative" : "Creative source"}
                            {mime ? ` · ${mime}` : ""}
                            {size != null ? ` · ${formatBytes(size)}` : ""}
                          </p>
                        ) : null}
                      </>
                    );
                  })()}

                  {!fromCurrentStatic ? (
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      Based on an earlier static version. Generate motion from the current static
                      image before approving it.
                    </p>
                  ) : null}

                  {!isCurrent && version.motionAssetId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-1.5 h-8 w-full text-[10px]"
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
          {approveError ? <p className="mt-2 text-[11px] text-signal">{approveError}</p> : null}
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {MOTION_SAFETY_NOTE}
      </p>

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
              This does not change Telegram. Static remains the Telegram release until Motion
              Quality &amp; Release is completed. No provider work and no cost.
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
