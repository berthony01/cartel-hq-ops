import { useCallback, useState, useRef, type RefObject } from "react";
import { signedUrl } from "@/lib/media";
import { prepareTelegramCutoutAtUrl } from "@/lib/sticker-export";
import type { Concept } from "@/lib/sticker-lab";
import type { Preview } from "@/hooks/useStickerGenerationRuntime";

/**
 * Sticker Lab review / quality runtime.
 *
 * Behaviour-preserving extraction of the existing browser-side transparency and
 * Telegram-cutout verification, plus the review predicates derived from it.
 * Read-only: it never writes to storage or the database and never calls the
 * generation provider. The 3-worker concurrency below is browser verification
 * only — it is NOT paid generation concurrency.
 */

/** Action-scoped signed URL lifetime (seconds) for verify only. */
const ACTION_URL_TTL = 300;

export type ClientCheck = {
  source: string;
  status: "checking" | "verified" | "failed";
  reason?: string;
  /** Telegram-cutout analysis of the same fresh bytes. */
  cutout?: "verified" | "will_clean" | "failed";
  removedPixels?: number;
};

export function useStickerReviewRuntime(params: {
  previews: Record<string, Preview>;
  aliveRef: RefObject<boolean>;
  concepts: Concept[];
  stickerIdFor: (conceptId: string) => string | null;
  backendExportable: (conceptId: string) => boolean;
}) {
  const { previews, aliveRef, concepts, stickerIdFor, backendExportable } = params;

  /**
   * Local-only, second transparency verification performed in the browser on the
   * already-signed PNG bytes. Never written back to Supabase.
   */
  const [clientChecks, setClientChecks] = useState<Record<string, ClientCheck>>({});
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);
  const verifyRunRef = useRef(false);

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
    [previews, clientChecks, aliveRef],
  );

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
  const browserVerifiedCount = concepts.filter(
    (c) => clientCheckFor(c.id)?.status === "verified",
  ).length;
  const cutoutVerifiedCount = concepts.filter((c) => cutoutOk(c.id)).length;
  const browserFailedCount = concepts.filter(
    (c) => clientCheckFor(c.id)?.status === "failed" || clientCheckFor(c.id)?.cutout === "failed",
  ).length;

  const exportableConcepts = concepts.filter((c) => isExportable(c.id));
  const exportableCount = exportableConcepts.length;
  // Export/publish readiness is stricter than "ready": transparency must be verified.
  const exportReady = concepts.length > 0 && exportableCount === concepts.length;
  const omittedLabels = concepts.filter((c) => !isExportable(c.id)).map((c) => c.label);

  return {
    clientChecks,
    checkProgress,
    runClientVerification,
    clientCheckFor,
    cutoutOk,
    isExportable,
    checksRunning,
    browserVerifiedCount,
    cutoutVerifiedCount,
    browserFailedCount,
    exportableConcepts,
    exportableCount,
    exportReady,
    omittedLabels,
  };
}
