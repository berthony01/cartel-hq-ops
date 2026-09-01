import { useCallback, useEffect, useRef, useState } from "react";
import { loadLatestJobs, classifyProviderError } from "@/lib/sticker-packs";
import type { AiJobRow, ProviderFailure } from "@/lib/sticker-packs";
import {
  startStickerMotionTelegramPrepare,
  syncStickerMotionTelegramPrepare,
} from "@/lib/sticker-motion-telegram";

/**
 * Phase C2 — Telegram motion preparation runtime.
 *
 * DELIBERATELY SEPARATE from the motion generation, candidate and variation
 * runtimes. Preparation is media formatting only: it never publishes to
 * Telegram, never changes `release_variant`, the static current image, the
 * Current Motion pointer, sticker/pack status or Sticker Drops.
 *
 * Cost safety:
 *  - `startTelegramPrepare()` is the ONLY path that can reach the C1 `start`
 *    action, and the UI calls it exclusively from a confirmation dialog.
 *  - At most one client-owned prep poll per sticker.
 *  - There is no automatic retry, ever.
 *  - Recovery is read-only (`loadLatestJobs` + `sync`) and can never create
 *    provider work.
 */

/** Job type written by the `sticker-motion-telegram` Edge Function (C1). */
const TELEGRAM_PREP_JOB_TYPE = "sticker_motion_telegram_prepare";

export type TelegramPrepStage =
  | "idle"
  | "starting"
  | "background"
  | "normalizing"
  | "ready"
  | "failed"
  | "timeout";

export const TELEGRAM_PREP_STAGE_LABEL: Record<TelegramPrepStage, string> = {
  idle: "No Telegram preparation running",
  starting: "Telegram prep: starting…",
  background: "Removing motion background",
  normalizing: "Normalizing for Telegram",
  ready: "Ready for Telegram",
  failed: "Telegram prep failed",
  timeout: "Telegram prep timed out",
};

export const TELEGRAM_PREP_BUSY_STAGES: TelegramPrepStage[] = [
  "starting",
  "background",
  "normalizing",
];

export const isTelegramPrepBusy = (stage: TelegramPrepStage | undefined) =>
  !!stage && TELEGRAM_PREP_BUSY_STAGES.includes(stage);

export type TelegramPrepRun = {
  stage: TelegramPrepStage;
  aiJobId: string | null;
  failure?: ProviderFailure | undefined;
};

const EMPTY_RUN: TelegramPrepRun = { stage: "idle", aiJobId: null };

const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_START_MS = 3000;
const POLL_MAX_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exact safety sentence — appended at most once per failure. */
const SAFETY_SENTENCE =
  "Your current static sticker, Current Motion and Telegram release were not changed.";

const withSafetySentence = (failure: ProviderFailure): ProviderFailure => {
  const body = (failure.body ?? "").trim();
  if (body.includes(SAFETY_SENTENCE)) return { ...failure, body };
  return { ...failure, body: body ? `${body} ${SAFETY_SENTENCE}` : SAFETY_SENTENCE };
};

/** Maps a C1 server stage string onto a local display stage. */
const mapServerStage = (stage: string | undefined | null): TelegramPrepStage => {
  if (!stage) return "background";
  if (stage.startsWith("cloudconvert") || stage.includes("normaliz")) return "normalizing";
  return "background";
};

type PollOutcome = "succeeded" | "failed" | "timeout" | "aborted";

export function useStickerMotionTelegramRuntime(params: {
  workspaceId: string | null | undefined;
}) {
  const { workspaceId } = params;

  const [runs, setRuns] = useState<Record<string, TelegramPrepRun>>({});
  /** Bumped when a Telegram derivative lands so durable motion state refetches. */
  const [telegramMotionReadySignal, setTelegramMotionReadySignal] = useState(0);

  const aliveRef = useRef(true);
  /** Sticker ids with a prep poll owned by THIS tab — one per sticker. */
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

  const patchRun = useCallback((stickerId: string, patch: Partial<TelegramPrepRun>) => {
    setRuns((r) => ({ ...r, [stickerId]: { ...(r[stickerId] ?? EMPTY_RUN), ...patch } }));
  }, []);

  /** Polls one already-created prep job. Never starts provider work. */
  const pollPrepare = useCallback(
    async (stickerId: string, jobId: string): Promise<PollOutcome> => {
      let delay = POLL_START_MS;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(delay);
        if (!aliveRef.current) return "aborted";
        delay = Math.min(Math.round(delay * 1.3), POLL_MAX_MS);

        let res: Awaited<ReturnType<typeof syncStickerMotionTelegramPrepare>>;
        try {
          res = await syncStickerMotionTelegramPrepare(jobId);
        } catch (err) {
          patchRun(stickerId, {
            stage: "failed",
            failure: withSafetySentence(
              classifyProviderError(
                err instanceof Error
                  ? err.message
                  : "This Telegram preparation job could not be checked.",
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
        if (res.status === "succeeded" || res.status === "ready") {
          patchRun(stickerId, { stage: "ready", failure: undefined });
          setTelegramMotionReadySignal((n) => n + 1);
          return "succeeded";
        }
        patchRun(stickerId, { stage: mapServerStage(res.stage) });
      }

      patchRun(stickerId, {
        stage: "timeout",
        failure: withSafetySentence({
          kind: "service",
          title: "This Telegram preparation is still running after 15 minutes",
          body: "Use “Refresh status” before starting another preparation so you do not pay twice.",
          raw: null,
        }),
      });
      return "timeout";
    },
    [patchRun],
  );

  /**
   * MAY BE BILLABLE. Prepares the APPROVED Current Motion for Telegram exactly
   * once. Only call from an explicit, confirmed user action. Nothing is
   * published to Telegram here.
   */
  const startTelegramPrepare = useCallback(
    async (input: { packId: string; stickerId: string; motionVersionId: string }) => {
      const { packId, stickerId, motionVersionId } = input;
      if (!workspaceId) return;
      if (runningRef.current.has(stickerId)) return;
      runningRef.current.add(stickerId);

      setRuns((r) => ({ ...r, [stickerId]: { stage: "starting", aiJobId: null } }));

      try {
        let started: Awaited<ReturnType<typeof startStickerMotionTelegramPrepare>>;
        try {
          started = await startStickerMotionTelegramPrepare({
            workspaceId,
            packId,
            stickerId,
            motionVersionId,
          });
        } catch (err) {
          patchRun(stickerId, {
            stage: "failed",
            aiJobId: null,
            failure: withSafetySentence(
              classifyProviderError(
                err instanceof Error
                  ? err.message
                  : "Telegram preparation could not be started.",
              ),
            ),
          });
          return;
        }

        // Already-prepared reuse: the server returned a durable derivative and
        // spent nothing. No job to poll.
        if (!started.aiJobId) {
          if (started.status === "ready" || started.telegramMotionAssetId) {
            patchRun(stickerId, { stage: "ready", aiJobId: null, failure: undefined });
            setTelegramMotionReadySignal((n) => n + 1);
            return;
          }
          patchRun(stickerId, {
            stage: "failed",
            aiJobId: null,
            failure: withSafetySentence({
              kind: "service",
              title: "Telegram preparation could not be started",
              body: "The preparation service did not return a job id.",
              raw: null,
            }),
          });
          return;
        }

        patchRun(stickerId, {
          stage: mapServerStage(started.stage),
          aiJobId: started.aiJobId,
          failure: undefined,
        });
        // No automatic retry: whatever this poll concludes is the final state.
        await pollPrepare(stickerId, started.aiJobId);
      } finally {
        runningRef.current.delete(stickerId);
      }
    },
    [workspaceId, patchRun, pollPrepare],
  );

  /**
   * READ-ONLY recovery. Resumes polling of an existing queued/running prep job
   * and may surface the latest prep failure. It never calls the C1 `start`
   * action and therefore can never create provider work. Telegram readiness is
   * NEVER inferred here — the durable `telegramAssetId` on the Current Motion
   * is the only readiness authority.
   */
  const recoverTelegramPrepare = useCallback(
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
        const prepJobs = (jobs[stickerId] ?? []).filter(
          (j) => j.job_type === TELEGRAM_PREP_JOB_TYPE,
        );
        if (prepJobs.length === 0) continue;

        const active = prepJobs.find((j) => j.status === "queued" || j.status === "running");
        if (active) {
          runningRef.current.add(stickerId);
          patchRun(stickerId, { stage: "background", aiJobId: active.id, failure: undefined });
          void pollPrepare(stickerId, active.id).finally(() => {
            runningRef.current.delete(stickerId);
          });
          continue;
        }

        const latest = prepJobs[0];
        if (force && latest && latest.status !== "failed") {
          // Nothing running and the newest job did not fail: any lingering
          // failed/timeout badge is stale. Readiness still comes only from the
          // durable telegram asset pointer, never from an old succeeded job.
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
    [patchRun, pollPrepare],
  );

  return {
    telegramPrepRuns: runs,
    telegramMotionReadySignal,
    startTelegramPrepare,
    recoverTelegramPrepare,
    telegramPrepRunFor: (stickerId: string | null | undefined): TelegramPrepRun =>
      (stickerId && runs[stickerId]) || EMPTY_RUN,
  };
}
