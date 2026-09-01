import { useCallback, useEffect, useRef, useState } from "react";
import { loadLatestJobs, classifyProviderError } from "@/lib/sticker-packs";
import type { AiJobRow, ProviderFailure } from "@/lib/sticker-packs";
import { startStickerVariationGeneration, syncStickerJob } from "@/lib/sticker-ai";
import type { StickerVariationLabel } from "@/lib/sticker-ai";

/**
 * A/B/C Variations runtime.
 *
 * DELIBERATELY SEPARATE from the current-image runtime and from the published
 * candidate runtime. A variation is REVIEW-ONLY: it never changes
 * `stickers.image_asset_id`, sticker status, pack status or any published
 * Telegram sticker. Finished takes land in `sticker_versions` only.
 *
 * Cost safety:
 *  - `start_variation` is only reachable through `startVariationRound()`, which
 *    the UI calls exclusively from an explicit, confirmed user action.
 *  - Takes run STRICTLY SEQUENTIALLY (A, then B, then C). A failed or cancelled
 *    take stops the round, so a broken run can never spend three times.
 *  - Recovery is read-only (`loadLatestJobs` + `sync`) and can never create a
 *    provider task or continue a round on its own.
 */

export const VARIATION_LABELS: StickerVariationLabel[] = ["A", "B", "C"];

export type VariationStage =
  | "idle"
  | "starting"
  | "generating"
  | "background"
  | "done"
  | "cancelled"
  | "failed"
  | "timeout";

export const VARIATION_STAGE_LABEL: Record<VariationStage, string> = {
  idle: "No variations",
  starting: "Variations: starting…",
  generating: "Variations: generating",
  background: "Variations: removing background",
  done: "Variations ready",
  cancelled: "Variations stopped",
  failed: "Variations failed",
  timeout: "Variations timed out",
};

export const VARIATION_BUSY_STAGES: VariationStage[] = ["starting", "generating", "background"];

export const isVariationBusy = (stage: VariationStage | undefined) =>
  !!stage && VARIATION_BUSY_STAGES.includes(stage);

export type VariationRound = {
  /** Round identity; also the `sticker_versions.variation_group_id`. */
  groupId: string | null;
  stage: VariationStage;
  /** Take currently in flight, when any. */
  currentLabel: StickerVariationLabel | null;
  /** Takes finished in this round, in completion order. */
  completed: StickerVariationLabel[];
  failure?: ProviderFailure | undefined;
  /**
   * R1 — set ONLY when the failure happened during background removal, i.e.
   * the paid image generation already succeeded. Enables the one-task
   * background-only retry instead of a full new round.
   */
  retryableBackgroundJobId?: string | null;
};

const EMPTY_ROUND: VariationRound = {
  groupId: null,
  stage: "idle",
  currentLabel: null,
  completed: [],
  retryableBackgroundJobId: null,
};

/** Same conservative polling contract as ordinary generation. */
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_START_MS = 3000;
const POLL_MAX_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exact variation safety sentence — must appear at most once per failure. */
const SAFETY_SENTENCE = "Your current sticker image was not changed.";

/** Ensures the safety sentence appears exactly once. Always true for variations. */
const withSafetySentence = (failure: ProviderFailure): ProviderFailure => {
  const body = (failure.body ?? "").trim();
  if (body.includes(SAFETY_SENTENCE)) {
    const first = body.indexOf(SAFETY_SENTENCE) + SAFETY_SENTENCE.length;
    const head = body.slice(0, first);
    const tail = body.slice(first).split(SAFETY_SENTENCE).join("").replace(/\s+/g, " ").trim();
    return { ...failure, body: tail ? `${head} ${tail}` : head };
  }
  return { ...failure, body: body ? `${body} ${SAFETY_SENTENCE}` : SAFETY_SENTENCE };
};

type PollOutcome = "succeeded" | "failed" | "timeout" | "aborted";

export function useStickerVariationRuntime(params: {
  workspaceId: string | null | undefined;
  referenceAssetIds: string[];
}) {
  const { workspaceId, referenceAssetIds } = params;

  const [rounds, setRounds] = useState<Record<string, VariationRound>>({});
  /** Bumped whenever a take finishes so Version History can refetch. */
  const [variationReadySignal, setVariationReadySignal] = useState(0);

  const aliveRef = useRef(true);
  /** Sticker ids running a round in THIS tab — one round per sticker. */
  const runningRef = useRef<Set<string>>(new Set());
  /** Sticker ids the user asked to stop after the in-flight take. */
  const cancelRef = useRef<Set<string>>(new Set());
  /** Packs whose read-only recovery already ran in this mount. */
  const recoveredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      runningRef.current.clear();
      cancelRef.current.clear();
    };
  }, []);

  const patchRound = useCallback((stickerId: string, patch: Partial<VariationRound>) => {
    setRounds((r) => ({
      ...r,
      [stickerId]: { ...(r[stickerId] ?? EMPTY_ROUND), ...patch },
    }));
  }, []);

  /**
   * Polls one already-created take to completion. Never starts provider work.
   */
  const pollTake = useCallback(
    async (
      stickerId: string,
      startJobId: string,
      options?: { startsOnBackground?: boolean },
    ): Promise<PollOutcome> => {
      let jobId = startJobId;
      /** True once the polled job is the background-removal child. */
      let onBackground = options?.startsOnBackground === true;
      let delay = POLL_START_MS;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(delay);
        if (!aliveRef.current) return "aborted";
        delay = Math.min(Math.round(delay * 1.3), POLL_MAX_MS);
        let res: Awaited<ReturnType<typeof syncStickerJob>>;
        try {
          res = await syncStickerJob(jobId);
        } catch (err) {
          patchRound(stickerId, {
            stage: "failed",
            currentLabel: null,
            failure: withSafetySentence(
              classifyProviderError(
                err instanceof Error ? err.message : "This variation could not be checked.",
              ),
            ),
          });
          return "failed";
        }
        if (!aliveRef.current) return "aborted";

        if (res.status === "failed") {
          patchRound(stickerId, {
            stage: "failed",
            currentLabel: null,
            failure: withSafetySentence(classifyProviderError(res.error, res.stage)),
            // Only a background-stage failure is retryable with one task: the
            // paid image generation for this take already succeeded.
            retryableBackgroundJobId: onBackground ? jobId : null,
          });
          return "failed";
        }

        if (res.status === "succeeded") {
          if (res.childJobId) {
            jobId = res.childJobId;
            onBackground = true;
            delay = POLL_START_MS;
            patchRound(stickerId, { stage: "background" });
            continue;
          }
          return "succeeded";
        }


        if (res.stage === "background_removal") patchRound(stickerId, { stage: "background" });
      }
      patchRound(stickerId, {
        stage: "timeout",
        currentLabel: null,
        failure: withSafetySentence({
          kind: "service",
          title: "A variation is still running after 15 minutes",
          body: "This take is taking unusually long. Use “Refresh status” later before starting another round so you do not pay twice.",
          raw: null,
        }),
      });
      return "timeout";
    },
    [patchRound],
  );

  /**
   * BILLABLE. Runs A → B → C sequentially for one sticker: three image
   * generations plus their background-removal steps. Only call from an
   * explicit confirmed user action. Stops immediately on failure or cancel.
   */
  const startVariationRound = useCallback(
    async (packId: string, stickerId: string) => {
      if (!workspaceId) return;
      if (runningRef.current.has(stickerId)) return;
      runningRef.current.add(stickerId);
      cancelRef.current.delete(stickerId);

      const groupId = crypto.randomUUID();
      const completed: StickerVariationLabel[] = [];
      setRounds((r) => ({
        ...r,
        [stickerId]: { groupId, stage: "starting", currentLabel: "A", completed: [] },
      }));

      try {
        for (const label of VARIATION_LABELS) {
          if (!aliveRef.current) return;
          if (cancelRef.current.has(stickerId)) {
            patchRound(stickerId, { stage: "cancelled", currentLabel: null });
            return;
          }
          patchRound(stickerId, { stage: "starting", currentLabel: label, failure: undefined });

          let started: Awaited<ReturnType<typeof startStickerVariationGeneration>>;
          try {
            started = await startStickerVariationGeneration({
              workspaceId,
              packId,
              stickerId,
              variationGroupId: groupId,
              variationLabel: label,
              referenceAssetIds,
            });
          } catch (err) {
            patchRound(stickerId, {
              stage: "failed",
              currentLabel: null,
              failure: withSafetySentence(
                classifyProviderError(
                  err instanceof Error ? err.message : "This variation could not be started.",
                ),
              ),
            });
            return;
          }

          // The server short-circuits an already finished slot without a job id.
          if (!started.aiJobId) {
            if (started.status === "succeeded") {
              completed.push(label);
              patchRound(stickerId, { completed: [...completed] });
              setVariationReadySignal((n) => n + 1);
              continue;
            }
            patchRound(stickerId, {
              stage: "failed",
              currentLabel: null,
              failure: withSafetySentence({
                kind: "service",
                title: "A variation could not be started",
                body: "The generation service did not return a job id.",
                raw: null,
              }),
            });
            return;
          }

          patchRound(stickerId, { stage: "generating", currentLabel: label });
          const outcome = await pollTake(stickerId, started.aiJobId);
          if (outcome !== "succeeded") return;

          completed.push(label);
          patchRound(stickerId, { completed: [...completed], currentLabel: null });
          setVariationReadySignal((n) => n + 1);
        }
        patchRound(stickerId, { stage: "done", currentLabel: null });
      } finally {
        runningRef.current.delete(stickerId);
        cancelRef.current.delete(stickerId);
      }
    },
    [workspaceId, referenceAssetIds, patchRound, pollTake],
  );

  /**
   * Asks the round to stop after the take that is already in flight. The
   * in-flight take is already paid for, so it is never abandoned mid-way.
   */
  const cancelVariationRound = useCallback((stickerId: string) => {
    if (!runningRef.current.has(stickerId)) return;
    cancelRef.current.add(stickerId);
  }, []);

  /**
   * READ-ONLY recovery after a refresh. Resumes polling of an in-flight take
   * and surfaces the last variation failure. It never starts a take and never
   * continues a round automatically — the user must explicitly run a new round.
   */
  const recoverVariations = useCallback(
    async (packId: string, stickerIds: string[], options?: { force?: boolean }) => {
      const force = options?.force === true;
      const ids = Array.from(new Set(stickerIds.filter(Boolean)));
      if (ids.length === 0) return;
      const recoveryKey = `${packId}:${ids.slice().sort().join(",")}`;
      if (!force && recoveredRef.current.has(recoveryKey)) return;
      recoveredRef.current.add(recoveryKey);

      let jobs: Record<string, AiJobRow[]> = {};
      try {
        jobs = await loadLatestJobs(ids);
      } catch {
        if (!force) recoveredRef.current.delete(recoveryKey);
        return;
      }
      if (!aliveRef.current) return;

      for (const stickerId of ids) {
        if (runningRef.current.has(stickerId)) continue;
        const variations = (jobs[stickerId] ?? []).filter((j) => j.is_variation);
        if (variations.length === 0) continue;
        const isActive = (j: AiJobRow) => j.status === "queued" || j.status === "running";
        const isBackground = (j: AiJobRow) => j.job_type.toLowerCase().includes("background");

        const active =
          variations.find((j) => isActive(j) && isBackground(j)) ??
          variations.find((j) => isActive(j) && !isBackground(j));
        if (active) {
          const label = (active.variation_label as StickerVariationLabel | null) ?? null;
          runningRef.current.add(stickerId);
          patchRound(stickerId, {
            groupId: active.variation_group_id,
            stage: isBackground(active) ? "background" : "generating",
            currentLabel: label,
            failure: undefined,
          });
          void pollTake(stickerId, active.id).then((outcome) => {
            runningRef.current.delete(stickerId);
            if (outcome === "succeeded") {
              // The round is NOT continued automatically: the remaining takes
              // are billable and need an explicit user action.
              setRounds((r) => {
                const prev = r[stickerId] ?? EMPTY_ROUND;
                const done = label && !prev.completed.includes(label)
                  ? [...prev.completed, label]
                  : prev.completed;
                return {
                  ...r,
                  [stickerId]: { ...prev, stage: "done", currentLabel: null, completed: done },
                };
              });
              setVariationReadySignal((n) => n + 1);
            }
          });
          continue;
        }

        const latest = variations[0];
        if (force && latest && latest.status !== "failed") {
          // Nothing running and the newest take did not fail: any lingering
          // failed/timeout badge is stale. Finished takes appear durably
          // through Version History, never inferred here.
          setRounds((r) => (r[stickerId] ? { ...r, [stickerId]: EMPTY_ROUND } : r));
          continue;
        }
        if (latest && latest.status === "failed") {
          patchRound(stickerId, {
            groupId: latest.variation_group_id,
            stage: "failed",
            currentLabel: null,
            failure: withSafetySentence(
              classifyProviderError(latest.error_message, latest.job_type),
            ),
          });
        }
      }
    },
    [patchRound, pollTake],
  );

  /** Clears local variation feedback for a sticker (e.g. after a restore). */
  const clearVariationState = useCallback((stickerId: string) => {
    setRounds((r) => ({ ...r, [stickerId]: EMPTY_ROUND }));
  }, []);

  return {
    variationRounds: rounds,
    variationReadySignal,
    startVariationRound,
    cancelVariationRound,
    recoverVariations,
    clearVariationState,
    variationRoundFor: (stickerId: string | null | undefined): VariationRound =>
      (stickerId && rounds[stickerId]) || EMPTY_ROUND,
  };
}
