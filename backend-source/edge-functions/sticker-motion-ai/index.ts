import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * CARTEL HQ — Animated Sticker Studio Phase B1
 * Review-only motion generation backend.
 *
 * This function is deliberately SEPARATE from `sticker-ai`. It never touches
 * the static current image pointer, `stickers.status`, `stickers.release_variant`,
 * `stickers.current_motion_version_id`, pack status, Telegram fields, Quality &
 * Release state or Sticker Drops. Its only durable product is a review-only
 * `sticker_motion_versions` row plus its `generated_motion` media asset.
 *
 * The produced 5-second clip is a CREATIVE SOURCE CLIP only. It is NOT a
 * Telegram-compliant animated sticker and this phase performs no transcoding.
 */

const KIE_BASE = "https://api.kie.ai";
const DEFAULT_MOTION_MODEL = "kling-2.6/image-to-video";
const BUCKET = "workspace-assets";
const SIGNED_URL_TTL = 900;
const JOB_TYPE = "sticker_motion_generate";
const MAX_INSTRUCTION = 600;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function mapKieState(value: unknown): "running" | "success" | "fail" {
  const state = String(value ?? "").toLowerCase();
  if (["success", "succeeded", "completed", "complete"].includes(state)) return "success";
  if (["fail", "failed", "error", "cancelled", "canceled"].includes(state)) return "fail";
  return "running";
}

function resultUrlFrom(data: Record<string, unknown>): string | null {
  let parsed: Record<string, unknown> | null = null;
  const raw = data.resultJson;
  if (typeof raw === "string" && raw.trim()) {
    try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { parsed = null; }
  } else if (raw && typeof raw === "object") {
    parsed = raw as Record<string, unknown>;
  }
  const urls = parsed?.resultUrls;
  if (Array.isArray(urls) && typeof urls[0] === "string") return urls[0];
  if (typeof parsed?.resultUrl === "string") return parsed.resultUrl;
  if (typeof data.resultUrl === "string") return data.resultUrl;
  return null;
}

function creditsFrom(data: Record<string, unknown>): number | null {
  for (const key of ["creditsConsumed", "consumeCredits", "credits"]) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

async function kieRequest(path: string, apiKey: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${KIE_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
  } catch {
    return { ok: false as const, status: 0, message: "Could not reach Kie.ai." };
  }

  let payload: Record<string, unknown> = {};
  try { payload = (await response.json()) as Record<string, unknown>; } catch { payload = {}; }
  if (!response.ok) {
    const friendly = response.status === 401
      ? "Kie.ai rejected the API key."
      : response.status === 403
        ? "Kie.ai denied this request."
        : response.status === 429
          ? "Kie.ai is rate limiting requests. Try again shortly."
          : response.status >= 500
            ? "Kie.ai is temporarily unavailable."
            : typeof payload.msg === "string" ? payload.msg : "Kie.ai returned an unexpected error.";
    return { ok: false as const, status: response.status, message: friendly, payload };
  }

  return {
    ok: true as const,
    status: response.status,
    payload,
    data: (payload.data && typeof payload.data === "object" ? payload.data : {}) as Record<string, unknown>,
  };
}

/* ------------------------------------------------------------------ prompts */

type MotionMode = "quick" | "ai" | "custom";

const QUICK_PRESETS: Record<string, string> = {
  blink: "The character blinks naturally once or twice.",
  nod: "The character gives a small confident nod.",
  eye_glow: "The character's eyes glow softly and briefly.",
  money_rain: "A light shower of cash notes falls behind the character.",
  laugh: "The character laughs with a small shoulder bounce.",
  idle: "A subtle idle breathing loop with very small body sway.",
};

function safeStr(value: unknown, cap = MAX_INSTRUCTION): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

/**
 * Motion prompt compiler. Identity preservation always outranks the requested
 * motion: the supplied static sticker is the only source of truth for how the
 * character looks.
 */
function buildMotionPrompt(input: {
  mode: MotionMode;
  preset: string | null;
  instruction: string | null;
}): string {
  const parts: string[] = [];
  parts.push("Animate the supplied sticker image as a short looping character animation.");
  parts.push("MANDATORY: preserve the character's exact identity, face, proportions, colors, wardrobe, accessories, lettering and framing from the supplied image. Do not redraw, restyle, recolor, re-letter or replace the character, and do not add new characters, objects, text or captions.");
  parts.push("Keep the subject centered on a clean plain background with the same composition as the supplied image. Camera stays static: no zoom, no pan, no cuts, no scene change.");

  if (input.mode === "quick") {
    const preset = input.preset && QUICK_PRESETS[input.preset] ? QUICK_PRESETS[input.preset] : QUICK_PRESETS.idle;
    parts.push(`Motion: ${preset}`);
  } else if (input.mode === "custom") {
    parts.push(`Motion (user direction, subordinate to the identity rules above): ${input.instruction ?? "subtle idle animation"}`);
  } else {
    parts.push(`Motion (assisted direction, subordinate to the identity rules above): ${input.instruction ?? "a subtle, expressive idle animation that suits this character"}`);
  }

  parts.push("Keep the movement subtle, clean and readable at small sticker size, and make the first and last frame match closely so the clip loops smoothly.");
  return parts.join(" ");
}

/* ------------------------------------------------------------------- server */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const KIE_API_KEY = Deno.env.get("KIE_API_KEY") ?? "";
  const MODEL = Deno.env.get("KIE_MOTION_MODEL") || DEFAULT_MOTION_MODEL;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "UNAUTHENTICATED" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond({ error: "UNAUTHENTICATED" }, 401);
  const user = authData.user;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return respond({ error: "INVALID_BODY" }, 400); }

  const isMember = async (workspaceId: string) => {
    const { data } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    return Boolean(data);
  };

  const action = String(body.action ?? "");
  if (action === "config") {
    return respond({ configured: Boolean(KIE_API_KEY), model: MODEL, durationSeconds: 5, telegramReady: false });
  }
  if (!KIE_API_KEY) {
    return respond({ error: "KIE_NOT_CONFIGURED", message: "KIE_API_KEY is not configured in Supabase Edge Function secrets." }, 503);
  }

  const failJob = async (job: Record<string, unknown>, message: string, code = "PROVIDER_FAILED") => {
    await admin.from("ai_jobs").update({
      status: "failed", error_code: code, error_message: message.slice(0, 500), completed_at: new Date().toISOString(),
    }).eq("id", String(job.id));
    // Review-only: no sticker, pack, release or Telegram state is ever written.
    return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "failed", error: message });
  };

  const logCredits = async (job: Record<string, unknown>, credits: number | null) => {
    if (credits == null) return;
    const { data: existing } = await admin.from("usage_ledger").select("id").eq("ai_job_id", String(job.id)).maybeSingle();
    if (existing) return;
    await admin.from("usage_ledger").insert({
      workspace_id: job.workspace_id, user_id: job.user_id, ai_job_id: job.id,
      action_type: JOB_TYPE, units: credits, provider_cost: null, internal_cost: null,
    });
  };

  try {
    if (action === "start_motion") {
      const workspaceId = String(body.workspaceId ?? "");
      const packId = String(body.packId ?? "");
      const stickerId = String(body.stickerId ?? "");
      const rawMode = String(body.motionMode ?? "");
      const mode: MotionMode | null =
        rawMode === "quick" || rawMode === "ai" || rawMode === "custom" ? rawMode : null;
      if (!workspaceId || !packId || !stickerId || !mode) return respond({ error: "INVALID_INPUT" }, 400);
      if (!(await isMember(workspaceId))) return respond({ error: "FORBIDDEN" }, 403);

      const preset = mode === "quick" ? (safeStr(body.motionPreset, 60) || "idle") : null;
      const instruction = mode === "quick" ? null : safeStr(body.motionInstruction);
      if (mode === "custom" && !instruction) return respond({ error: "INVALID_INPUT", message: "A motion instruction is required." }, 400);

      const { data: sticker } = await admin
        .from("stickers")
        .select("id,pack_id,image_asset_id")
        .eq("id", stickerId)
        .maybeSingle();
      if (!sticker || sticker.pack_id !== packId) return respond({ error: "STICKER_NOT_FOUND" }, 404);

      const { data: pack } = await admin
        .from("sticker_packs")
        .select("id,workspace_id")
        .eq("id", packId)
        .maybeSingle();
      if (!pack || pack.workspace_id !== workspaceId) return respond({ error: "PACK_NOT_FOUND" }, 404);

      if (!sticker.image_asset_id) {
        return respond({ error: "NO_STATIC_IMAGE", message: "This sticker has no current image to animate." }, 409);
      }

      const { data: staticAsset } = await admin
        .from("media_assets")
        .select("id,storage_path,workspace_id")
        .eq("id", sticker.image_asset_id)
        .maybeSingle();
      if (!staticAsset || staticAsset.workspace_id !== workspaceId) {
        return respond({ error: "NO_STATIC_IMAGE", message: "The current sticker image could not be read." }, 409);
      }

      // The static version that this motion take was derived from, when known.
      const { data: sourceVersion } = await admin
        .from("sticker_versions")
        .select("id")
        .eq("sticker_id", stickerId)
        .eq("asset_id", staticAsset.id)
        .maybeSingle();

      // Duplicate-spend protection: one live motion job per sticker.
      const { data: liveJob } = await admin
        .from("ai_jobs")
        .select("id,status,provider_model")
        .eq("job_type", JOB_TYPE)
        .eq("sticker_id", stickerId)
        .in("status", ["queued", "running"])
        .maybeSingle();
      if (liveJob) {
        return respond({ aiJobId: liveJob.id, status: liveJob.status === "queued" ? "queued" : "running", model: liveJob.provider_model ?? MODEL, reused: true });
      }

      const { data: signed, error: signedError } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(staticAsset.storage_path, SIGNED_URL_TTL);
      if (signedError || !signed?.signedUrl) {
        return respond({ error: "SOURCE_URL_FAILED", message: "The current sticker image could not be prepared for animation." }, 500);
      }

      const prompt = buildMotionPrompt({ mode, preset, instruction });

      const { data: job, error: jobError } = await admin.from("ai_jobs").insert({
        workspace_id: workspaceId, user_id: user.id, pack_id: packId, sticker_id: stickerId,
        job_type: JOB_TYPE, status: "queued", provider: "kie", provider_model: MODEL,
        input_json: {
          mode: "motion",
          motion_mode: mode,
          motion_preset: preset,
          motion_instruction: instruction,
          source_static_asset_id: staticAsset.id,
          source_static_version_id: sourceVersion?.id ?? null,
          prompt,
        },
      }).select("*").single();

      if (jobError || !job) {
        // A concurrent starter may have won the guard index; reuse its job.
        const { data: raced } = await admin
          .from("ai_jobs")
          .select("id,status,provider_model")
          .eq("job_type", JOB_TYPE)
          .eq("sticker_id", stickerId)
          .in("status", ["queued", "running"])
          .maybeSingle();
        if (raced) {
          return respond({ aiJobId: raced.id, status: raced.status === "queued" ? "queued" : "running", model: raced.provider_model ?? MODEL, reused: true });
        }
        return respond({ error: "JOB_CREATE_FAILED", message: "Could not start motion generation." }, 500);
      }

      const create = await kieRequest("/api/v1/jobs/createTask", KIE_API_KEY, {
        method: "POST",
        body: JSON.stringify({
          model: MODEL,
          input: { prompt, image_urls: [signed.signedUrl], sound: false, duration: "5" },
        }),
      });
      const taskId = create.ok ? String(create.data.taskId ?? create.data.task_id ?? "") : "";
      if (!create.ok || !taskId) {
        return await failJob(job as Record<string, unknown>, create.ok ? "Kie.ai returned no task ID." : create.message, "PROVIDER_START_FAILED");
      }

      await admin.from("ai_jobs").update({ status: "running", provider_task_id: taskId }).eq("id", job.id);
      return respond({ aiJobId: job.id, status: "running", model: MODEL });
    }

    if (action === "sync_motion") {
      const aiJobId = String(body.aiJobId ?? "");
      if (!aiJobId) return respond({ error: "INVALID_INPUT" }, 400);
      const { data: job } = await admin.from("ai_jobs").select("*").eq("id", aiJobId).maybeSingle();
      if (!job) return respond({ error: "JOB_NOT_FOUND" }, 404);
      if (job.job_type !== JOB_TYPE) return respond({ error: "WRONG_JOB_TYPE" }, 400);
      if (!(await isMember(job.workspace_id))) return respond({ error: "FORBIDDEN" }, 403);

      if (job.status === "failed") {
        return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "failed", error: job.error_message });
      }
      if (job.status === "succeeded") {
        const output = (job.output_json ?? {}) as Record<string, unknown>;
        return respond({
          aiJobId: job.id, jobType: JOB_TYPE, status: "succeeded",
          motionAssetId: output.motion_asset_id ?? null,
          motionVersionId: output.motion_version_id ?? null,
          telegramReady: false,
        });
      }
      if (!job.provider_task_id) return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: job.status });

      const query = await kieRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(job.provider_task_id)}`, KIE_API_KEY, { method: "GET" });
      if (!query.ok) return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", providerMessage: query.message });

      const data = query.data;
      const state = mapKieState(data.state ?? data.status);
      if (state === "running") {
        if (job.status !== "running") await admin.from("ai_jobs").update({ status: "running" }).eq("id", job.id);
        return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running" });
      }
      if (state === "fail") {
        const failMessage = typeof data.failMsg === "string" && data.failMsg ? data.failMsg : "Kie.ai could not complete this motion task.";
        return await failJob(job as Record<string, unknown>, failMessage);
      }

      const resultUrl = resultUrlFrom(data);
      if (!resultUrl) return await failJob(job as Record<string, unknown>, "Kie.ai returned no usable video URL.");
      const credits = creditsFrom(data);

      let clip: Uint8Array;
      try {
        const download = await fetch(resultUrl);
        if (!download.ok) throw new Error("download failed");
        clip = new Uint8Array(await download.arrayBuffer());
      } catch {
        return await failJob(job as Record<string, unknown>, "The generated motion clip could not be downloaded.", "MOTION_DOWNLOAD_FAILED");
      }
      if (!clip.byteLength) {
        return await failJob(job as Record<string, unknown>, "The generated motion clip was empty.", "MOTION_DOWNLOAD_FAILED");
      }

      // Deterministic object path keeps concurrent pollers idempotent.
      const path = `${job.workspace_id}/generated_motion/motion-${job.id}.mp4`;
      const findAsset = async () => {
        const { data: found } = await admin.from("media_assets").select("id").eq("workspace_id", job.workspace_id).eq("storage_path", path).maybeSingle();
        return found?.id ?? null;
      };

      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, clip, { contentType: "video/mp4", upsert: false });
      let motionAssetId: string | null = await findAsset();
      if (uploadError && !motionAssetId) {
        // Fail closed unless the object is proven to already exist.
        const slash = path.lastIndexOf("/");
        const dir = path.slice(0, slash);
        const name = path.slice(slash + 1);
        const { data: listed } = await admin.storage.from(BUCKET).list(dir, { search: name, limit: 100 });
        const exists = (listed ?? []).some((entry) => entry.name === name);
        if (!exists) {
          return await failJob(job as Record<string, unknown>, "Could not save the generated motion clip.", "STORAGE_UPLOAD_FAILED");
        }
      }

      const input = (job.input_json && typeof job.input_json === "object" ? job.input_json : {}) as Record<string, unknown>;
      const motionMode = typeof input.motion_mode === "string" ? input.motion_mode : null;
      const motionPreset = typeof input.motion_preset === "string" ? input.motion_preset : null;
      const motionInstruction = typeof input.motion_instruction === "string" ? input.motion_instruction : null;
      const sourceAssetId = typeof input.source_static_asset_id === "string" ? input.source_static_asset_id : null;
      const sourceVersionId = typeof input.source_static_version_id === "string" ? input.source_static_version_id : null;

      if (!motionAssetId) {
        const { data: asset, error: assetError } = await admin.from("media_assets").insert({
          workspace_id: job.workspace_id, uploaded_by: job.user_id, storage_path: path,
          asset_type: "generated_motion", mime_type: "video/mp4", file_size_bytes: clip.byteLength,
          metadata: {
            source: "kie", motion_model: job.provider_model, motion_task_id: job.provider_task_id,
            motion_job_id: job.id, motion_mode: motionMode, motion_preset: motionPreset,
            duration_seconds: 5, telegram_ready: false, source_static_asset_id: sourceAssetId,
          },
        }).select("id").maybeSingle();
        motionAssetId = asset?.id ?? (assetError ? await findAsset() : null);
        if (!motionAssetId) {
          return await failJob(job as Record<string, unknown>, "Could not record the generated motion asset.", "ASSET_RECORD_FAILED");
        }
      }

      // Durable review-only record. The current motion pointer, release variant,
      // sticker/pack status and Telegram fields are deliberately not written.
      const readVersion = async () => {
        const { data: found } = await admin.from("sticker_motion_versions").select("id")
          .eq("sticker_id", job.sticker_id).eq("motion_asset_id", motionAssetId).maybeSingle();
        return found?.id ?? null;
      };
      let motionVersionId = await readVersion();
      for (let attempt = 0; attempt < 3 && !motionVersionId; attempt++) {
        const { data: maxRow } = await admin.from("sticker_motion_versions")
          .select("version_number").eq("sticker_id", job.sticker_id)
          .order("version_number", { ascending: false }).limit(1).maybeSingle();
        const nextVersion = (maxRow?.version_number ?? 0) + 1;
        const { data: inserted } = await admin.from("sticker_motion_versions").insert({
          workspace_id: job.workspace_id, pack_id: job.pack_id, sticker_id: job.sticker_id,
          source_static_version_id: sourceVersionId, source_static_asset_id: sourceAssetId,
          motion_asset_id: motionAssetId, version_number: nextVersion,
          motion_mode: motionMode, motion_preset: motionPreset, motion_instruction: motionInstruction,
          provider_metadata: {
            provider: "kie", model: job.provider_model, task_id: job.provider_task_id,
            ai_job_id: job.id, duration_seconds: 5, telegram_ready: false,
          },
        }).select("id").maybeSingle();
        if (inserted) { motionVersionId = inserted.id; break; }
        motionVersionId = await readVersion();
      }
      if (!motionVersionId) {
        return await failJob(job as Record<string, unknown>, "The motion clip was created but could not be recorded in motion history.", "MOTION_VERSION_FAILED");
      }

      await admin.from("ai_jobs").update({
        status: "succeeded", completed_at: new Date().toISOString(),
        output_json: {
          motion_asset_id: motionAssetId, motion_version_id: motionVersionId,
          storage_path: path, duration_seconds: 5, telegram_ready: false,
        },
      }).eq("id", job.id);
      await logCredits(job as Record<string, unknown>, credits);

      return respond({
        aiJobId: job.id, jobType: JOB_TYPE, status: "succeeded",
        motionAssetId, motionVersionId, telegramReady: false, stage: "motion_source_ready",
      });
    }

    return respond({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("[sticker-motion-ai] unexpected error", error instanceof Error ? error.message : "unknown");
    return respond({ error: "INTERNAL_ERROR", message: "Unexpected server error." }, 500);
  }
});
