import { useCallback, useEffect, useRef, useState } from "react";
import { loadLatestJobs, classifyProviderError } from "@/lib/sticker-packs";
import type { AiJobRow, ProviderFailure } from "@/lib/sticker-packs";
import { startStickerCandidateGeneration, syncStickerJob } from "@/lib/sticker-ai";

/**
 * Phase 4D.2 — Published candidate runtime.
 *
 * DELIBERATELY SEPARATE from `useStickerGenerationRuntime`. A candidate never
 * changes `stickers.image_asset_id`, the live Telegram sticker, the current
 * preview or the current generation stage/failure state, so its transient
 * state is kept in its own store and never written back into the current-image
 * runtime.
 *
 * Cost safety: `start_candidate` is only ever reachable through
 * `startCandidate()`, which the UI calls exclusively from an explicit,
 * confirmed user action. Recovery is read-only (`loadLatestJobs` + `sync`) and
 * can never create a provider task.
 */

export type CandidateStage =
  | "idle"
  | "starting"
  | "generating"
  | "background"
  | "ready"
  | "failed"
  | "timeout";

export const CANDIDATE_STAGE_LABEL: Record<CandidateStage, string> = {
  idle: "No candidate",
  starting: "Candidate: starting…",
  generating: "Candidate: generating",
  background: "Candidate: removing background",
  ready: "Candidate ready",
  failed: "Candidate failed",
  timeout: "Candidate timed out",
};

export const CANDIDATE_BUSY_STAGES: CandidateStage[] = ["starting", "generating", "background"];

export const isCandidateBusy = (stage: CandidateStage | undefined) =>
  !!stage && CANDIDATE_BUSY_STAGES.includes(stage);

/** Same conservative polling contract as ordinary generation. */
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_START_MS = 3000;
const POLL_MAX_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function usePublishedStickerCandidateRuntime(params: {
  workspaceId: string | null | undefined;
  referenceAssetIds: string[];
}) {
  const { workspaceId, referenceAssetIds } = params;

  const [candidateStages, setCandidateStages] = useState<Record<string, CandidateStage>>({});
  const [candidateFailures, setCandidateFailures] = useState<
    Record<string, ProviderFailure | undefined>
  >({});
  const [candidateJobIds, setCandidateJobIds] = useState<Record<string, string | undefined>>({});
  /**
   * Monotonic signal bumped whenever a candidate finishes (or is recovered as
   * finished) so the read-only Version History query can refetch.
   */
  const [candidateReadySignal, setCandidateReadySignal] = useState(0);

  const aliveRef = useRef(true);
  /** Sticker ids polled by THIS tab — guarantees one poller per sticker. */
  const pollingRef = useRef<Set<string>>(new Set());
  /** Packs whose read-only recovery already ran in this mount. */
  const recoveredRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      pollingRef.current.clear();
    };
  }, []);

  const setStage = (stickerId: string, stage: CandidateStage) =>
    setCandidateStages((s) => ({ ...s, [stickerId]: stage }));

  /**
   * Polls an already-existing candidate job to completion. Never starts work
   * and never spends credits.
   */
  const pollCandidate = useCallback(
    async (stickerId: string, startJobId: string, startStage: CandidateStage) => {
      if (pollingRef.current.has(stickerId)) return;
      pollingRef.current.add(stickerId);
      setCandidateFailures((f) => ({ ...f, [stickerId]: undefined }));
      setStage(stickerId, startStage);
      setCandidateJobIds((j) => ({ ...j, [stickerId]: startJobId }));
      let jobId = startJobId;
      let delay = POLL_START_MS;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      try {
        while (Date.now() < deadline) {
          await sleep(delay);
          if (!aliveRef.current) return;
          delay = Math.min(Math.round(delay * 1.3), POLL_MAX_MS);
          const res = await syncStickerJob(jobId);
          if (!aliveRef.current) return;

          if (res.status === "failed") {
            setStage(stickerId, "failed");
            setCandidateFailures((f) => ({
              ...f,
              [stickerId]: classifyProviderError(res.error, res.stage),
            }));
            return;
          }

          if (res.status === "succeeded") {
            if (res.childJobId) {
              // Parent finished: follow the background-removal child.
              jobId = res.childJobId;
              delay = POLL_START_MS;
              setCandidateJobIds((j) => ({ ...j, [stickerId]: jobId }));
              setStage(stickerId, "background");
              continue;
            }
            // Terminal success: the durable candidate lives in sticker_versions.
            setStage(stickerId, "ready");
            setCandidateReadySignal((n) => n + 1);
            return;
          }

          if (res.stage === "background_removal") setStage(stickerId, "background");
        }
        setStage(stickerId, "timeout");
        setCandidateFailures((f) => ({
          ...f,
          [stickerId]: {
            kind: "service",
            title: "Candidate still running after 15 minutes",
            body: "The candidate is taking unusually long. Your live Telegram sticker was not changed. Use “Refresh status” later before starting another candidate so you do not pay twice.",
            raw: null,
          },
        }));
      } catch (err) {
        if (!aliveRef.current) return;
        setStage(stickerId, "failed");
        setCandidateFailures((f) => ({
          ...f,
          [stickerId]: classifyProviderError(
            err instanceof Error ? err.message : "The candidate could not be checked.",
          ),
        }));
      } finally {
        pollingRef.current.delete(stickerId);
      }
    },
    [],
  );

  /**
   * BILLABLE. Creates exactly one candidate pipeline (image generation +
   * background removal). Only call from an explicit confirmed user action.
   */
  const startCandidate = useCallback(
    async (packId: string, stickerId: string) => {
      if (!workspaceId) return;
      if (pollingRef.current.has(stickerId)) return;
      setCandidateFailures((f) => ({ ...f, [stickerId]: undefined }));
      setStage(stickerId, "starting");
      let started: Awaited<ReturnType<typeof startStickerCandidateGeneration>>;
      try {
        started = await startStickerCandidateGeneration({
          workspaceId,
          packId,
          stickerId,
          referenceAssetIds,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "The candidate could not be started.";
        setStage(stickerId, "failed");
        setCandidateFailures((f) => ({
          ...f,
          [stickerId]: {
            ...classifyProviderError(message),
            body: `${classifyProviderError(message).body} Your live Telegram sticker was not changed.`,
          },
        }));
        return;
      }
      if (!started.aiJobId) {
        setStage(stickerId, "failed");
        setCandidateFailures((f) => ({
          ...f,
          [stickerId]: {
            kind: "service",
            title: "Candidate could not be started",
            body: "The generation service did not return a job id. Your live Telegram sticker was not changed.",
            raw: null,
          },
        }));
        return;
      }
      await pollCandidate(stickerId, started.aiJobId, "generating");
    },
    [workspaceId, referenceAssetIds, pollCandidate],
  );

  /**
   * READ-ONLY recovery after a refresh. Resumes polling of in-flight candidate
   * jobs and surfaces the last candidate failure. Never calls start_candidate,
   * so it can never create a provider task or spend credits.
   */
  const recoverCandidates = useCallback(
    async (packId: string, stickerIds: string[]) => {
      const ids = Array.from(new Set(stickerIds.filter(Boolean)));
      if (ids.length === 0) return;
      const recoveryKey = `${packId}:${ids.slice().sort().join(",")}`;
      if (recoveredRef.current.has(recoveryKey)) return;
      recoveredRef.current.add(recoveryKey);

      let jobs: Record<string, AiJobRow[]> = {};
      try {
        jobs = await loadLatestJobs(ids);
      } catch {
        recoveredRef.current.delete(recoveryKey);
        return;
      }
      if (!aliveRef.current) return;

      for (const stickerId of ids) {
        if (pollingRef.current.has(stickerId)) continue;
        const candidates = (jobs[stickerId] ?? []).filter((j) => j.is_candidate);
        if (candidates.length === 0) continue;
        const isActive = (j: AiJobRow) => j.status === "queued" || j.status === "running";
        const isBackground = (j: AiJobRow) => j.job_type.toLowerCase().includes("background");

        const activeChild = candidates.find((j) => isActive(j) && isBackground(j));
        if (activeChild) {
          void pollCandidate(stickerId, activeChild.id, "background");
          continue;
        }
        const activeParent = candidates.find((j) => isActive(j) && !isBackground(j));
        if (activeParent) {
          void pollCandidate(stickerId, activeParent.id, "generating");
          continue;
        }
        const latest = candidates[0];
        if (latest && latest.status === "failed") {
          // Candidate-only failure: current/live state is untouched.
          setStage(stickerId, "failed");
          setCandidateFailures((f) => ({
            ...f,
            [stickerId]: classifyProviderError(latest.error_message, latest.job_type),
          }));
        }
      }
    },
    [pollCandidate],
  );

  /** Clears local candidate feedback for a sticker (e.g. after approval). */
  const clearCandidateState = useCallback((stickerId: string) => {
    setCandidateStages((s) => ({ ...s, [stickerId]: "idle" }));
    setCandidateFailures((f) => ({ ...f, [stickerId]: undefined }));
    setCandidateJobIds((j) => ({ ...j, [stickerId]: undefined }));
  }, []);

  return {
    candidateStages,
    candidateFailures,
    candidateJobIds,
    candidateReadySignal,
    startCandidate,
    recoverCandidates,
    clearCandidateState,
    candidateStageFor: (stickerId: string | null | undefined): CandidateStage =>
      (stickerId && candidateStages[stickerId]) || "idle",
  };
}
