import { useCallback, useEffect, useRef, useState } from "react";
import { loadLatestJobs, classifyProviderError } from "@/lib/sticker-packs";
import type { AiJobRow, ProviderFailure } from "@/lib/sticker-packs";
import {
  startStickerMotionGeneration,
  syncStickerMotionJob,
  type StickerMotionPreset,
} from "@/lib/sticker-motion-ai";
import type { MotionMode } from "@/lib/sticker-motion";

/**
 * Motion generation runtime.
 *
 * DELIBERATELY SEPARATE from the current-image, published-candidate and A/B/C
 * variation runtimes. Motion is REVIEW-ONLY: nothing here changes the static
 * current image, sticker or pack status, `release_variant`, the Current Motion
 * pointer or any Telegram state.
 *
 * Cost safety:
 *  - `startMotion()` is the ONLY path to a billable provider task and the UI
 *    calls it exclusively from an explicit confirmation dialog.
 *  - One call performs at most one `startStickerMotionGeneration` invocation.
 *  - There is no automatic retry, ever.
 *  - Recovery is read-only (`loadLatestJobs` + `sync`) and can never create a
 *    provider task.
 */

/** Job type written by the `sticker-motion-ai` Edge Function. */
const MOTION_JOB_TYPE = "sticker_motion_generate";

export type MotionStage = "idle" | "starting" | "generating" | "ready" | "failed" | "timeout";

export const MOTION_STAGE_LABEL: Record<MotionStage, string> = {
  idle: "No motion running",
  starting: "Motion: starting…",
  generating: "Motion: generating",
  ready: "Motion clip ready",
  failed: "Motion failed",
  timeout: "Motion timed out",
};

export const MOTION_BUSY_STAGES: MotionStage[] = ["starting", "generating"];

export const isMotionBusy = (stage: MotionStage | undefined) =>
  !!stage && MOTION_BUSY_STAGES.includes(stage);

export type MotionRun = {
  stage: MotionStage;
  aiJobId: string | null;
  failure?: ProviderFailure | undefined;
};

const EMPTY_RUN: MotionRun = { stage: "idle", aiJobId: null };

const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_START_MS = 3000;
const POLL_MAX_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exact motion safety sentence — appended at most once per failure. */
const SAFETY_SENTENCE =
  "Your current static sticker, Current Motion and Telegram release were not changed.";

const withSafetySentence = (failure: ProviderFailure): ProviderFailure => {
  const body = (failure.body ?? "").trim();
  if (body.includes(SAFETY_SENTENCE)) return { ...failure, body };
  return { ...failure, body: body ? `${body} ${SAFETY_SENTENCE}` : SAFETY_SENTENCE };
};

type PollOutcome = "succeeded" | "failed" | "timeout" | "aborted";

export function useStickerMotionGenerationRuntime(params: {
  workspaceId: string | null | undefined;
}) {
  const { workspaceId } = params;

  const [runs, setRuns] = useState<Record<string, MotionRun>>({});
  /** Bumped whenever a motion clip lands so Motion History can refetch. */
  const [motionReadySignal, setMotionReadySignal] = useState(0);

  const aliveRef = useRef(true);
  /** Sticker ids with a motion run owned by THIS tab — one per sticker. */
  const runningRef = useRef<Set<string>>(new Set());
  /** Recovery keys already reconciled in this mount. */
  const recoveredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      runningRef.current.clear();
    };
  }, []);

  const patchRun = useCallback((stickerId: string, patch: Partial<MotionRun>) => {
    setRuns((r) => ({ ...r, [stickerId]: { ...(r[stickerId] ?? EMPTY_RUN), ...patch } }));
  }, []);

  /** Polls one already-created motion job. Never starts provider work. */
  const pollMotion = useCallback(
    async (stickerId: string, jobId: string): Promise<PollOutcome> => {
      let delay = POLL_START_MS;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(delay);
        if (!aliveRef.current) return "aborted";
        delay = Math.min(Math.round(delay * 1.3), POLL_MAX_MS);

        let res: Awaited<ReturnType<typeof syncStickerMotionJob>>;
        try {
          res = await syncStickerMotionJob(jobId);
        } catch (err) {
          patchRun(stickerId, {
            stage: "failed",
            failure: withSafetySentence(
              classifyProviderError(
                err instanceof Error ? err.message : "This motion job could not be checked.",
              ),
            ),
          });
          return "failed";
        }
        if (!aliveRef.current) return "aborted";

        if (res.status === "failed") {
          patchRun(stickerId, {
            stage: "failed",
            failure: withSafetySentence(classifyProviderError(res.error, res.stage)),
          });
          return "failed";
        }
        if (res.status === "succeeded") {
          patchRun(stickerId, { stage: "ready", failure: undefined });
          setMotionReadySignal((n) => n + 1);
          return "succeeded";
        }
      }

      patchRun(stickerId, {
        stage: "timeout",
        failure: withSafetySentence({
          kind: "service",
          title: "This motion job is still running after 15 minutes",
          body: "Use “Refresh status” before starting another motion so you do not pay twice.",
          raw: null,
        }),
      });
      return "timeout";
    },
    [patchRun],
  );

  /**
   * BILLABLE. Creates exactly ONE Kie video task for one sticker. Only call
   * from an explicit, confirmed user action.
   */
  const startMotion = useCallback(
    async (input: {
      packId: string;
      stickerId: string;
      motionMode: MotionMode;
      motionPreset?: StickerMotionPreset;
      motionInstruction?: string;
    }) => {
      const { packId, stickerId } = input;
      if (!workspaceId) return;
      if (runningRef.current.has(stickerId)) return;
      runningRef.current.add(stickerId);

      setRuns((r) => ({ ...r, [stickerId]: { stage: "starting", aiJobId: null } }));

      try {
        let started: Awaited<ReturnType<typeof startStickerMotionGeneration>>;
        try {
          started = await startStickerMotionGeneration({
            workspaceId,
            packId,
            stickerId,
            motionMode: input.motionMode,
            ...(input.motionPreset ? { motionPreset: input.motionPreset } : {}),
            ...(input.motionInstruction ? { motionInstruction: input.motionInstruction } : {}),
          });
        } catch (err) {
          patchRun(stickerId, {
            stage: "failed",
            aiJobId: null,
            failure: withSafetySentence(
              classifyProviderError(
                err instanceof Error ? err.message : "Motion generation could not be started.",
              ),
            ),
          });
          return;
        }

        if (!started.aiJobId) {
          patchRun(stickerId, {
            stage: "failed",
            aiJobId: null,
            failure: withSafetySentence({
              kind: "service",
              title: "Motion generation could not be started",
              body: "The motion service did not return a job id.",
              raw: null,
            }),
          });
          return;
        }

        patchRun(stickerId, {
          stage: "generating",
          aiJobId: started.aiJobId,
          failure: undefined,
        });
        // No automatic retry: whatever this poll concludes is the final state.
        await pollMotion(stickerId, started.aiJobId);
      } finally {
        runningRef.current.delete(stickerId);
      }
    },
    [workspaceId, patchRun, pollMotion],
  );

  /**
   * READ-ONLY recovery after a browser refresh. Resumes polling of an existing
   * queued/running motion job and surfaces the latest motion failure. It never
   * calls `start` and therefore can never create provider work.
   */
  const recoverMotion = useCallback(
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
        const motionJobs = (jobs[stickerId] ?? []).filter((j) => j.job_type === MOTION_JOB_TYPE);
        if (motionJobs.length === 0) continue;

        const active = motionJobs.find((j) => j.status === "queued" || j.status === "running");
        if (active) {
          runningRef.current.add(stickerId);
          patchRun(stickerId, { stage: "generating", aiJobId: active.id, failure: undefined });
          void pollMotion(stickerId, active.id).finally(() => {
            runningRef.current.delete(stickerId);
          });
          continue;
        }

        const latest = motionJobs[0];
        if (force && latest && latest.status !== "failed") {
          // Nothing running and the newest job did not fail: any lingering
          // failed/timeout badge is stale. Finished clips appear durably
          // through Motion History, never inferred here.
          setRuns((r) => (r[stickerId] ? { ...r, [stickerId]: EMPTY_RUN } : r));
          continue;
        }
        if (latest && latest.status === "failed") {
          patchRun(stickerId, {
            stage: "failed",
            aiJobId: latest.id,
            failure: withSafetySentence(
              classifyProviderError(latest.error_message, latest.job_type),
            ),
          });
        }
      }
    },
    [patchRun, pollMotion],
  );

  /** Clears local motion feedback for a sticker (e.g. after approval). */
  const clearMotionState = useCallback((stickerId: string) => {
    setRuns((r) => ({ ...r, [stickerId]: EMPTY_RUN }));
  }, []);

  return {
    motionRuns: runs,
    motionReadySignal,
    startMotion,
    recoverMotion,
    clearMotionState,
    motionRunFor: (stickerId: string | null | undefined): MotionRun =>
      (stickerId && runs[stickerId]) || EMPTY_RUN,
  };
}
