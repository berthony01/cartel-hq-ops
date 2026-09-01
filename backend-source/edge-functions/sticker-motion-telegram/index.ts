import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * CARTEL HQ — Animated Sticker Studio Phase C1
 * Telegram Motion Preparation — BACKEND CONTRACT ONLY.
 *
 * Pipeline:
 *   generated_motion (5s creative source)
 *     -> fal.ai background matting (transparent VP9 WEBM)
 *     -> CloudConvert deterministic FFmpeg normalization
 *     -> telegram_motion media asset
 *     -> sticker_motion_versions.telegram_asset_id
 *
 * This function NEVER calls the Telegram Bot API, never writes
 * `stickers.release_variant`, `stickers.current_motion_version_id`,
 * `stickers.image_asset_id`, sticker/pack status or any Telegram file id.
 * It never deletes or replaces the original `generated_motion` source and
 * never clears an existing valid `telegram_asset_id`.
 *
 * Telegram has NOT accepted anything in C1: `telegram_accepted` is always false.
 */

const JOB_TYPE = "sticker_motion_telegram_prepare";
const PREP_CONTRACT_VERSION = "v1";
const BUCKET = "workspace-assets";
const SIGNED_URL_TTL = 900; // ~15 minutes

const FAL_MODEL = "veed/video-background-removal/fast";
const FAL_QUEUE_BASE = "https://queue.fal.run/veed/video-background-removal/fast";
const CLOUDCONVERT_BASE = "https://api.cloudconvert.com/v2";

/** Telegram video sticker constraints (validated locally; never provider-claimed). */
const TG = {
  format: "video",
  mimeType: "video/webm",
  codec: "vp9",
  maxDurationSeconds: 3,
  maxFps: 30,
  maxBytes: 256 * 1024,
  maxDimension: 512,
} as const;

/**
 * Fixed, server-owned normalization arguments. Never client-provided.
 * The CloudConvert task already declares `command: "ffmpeg"`, so these
 * arguments MUST NOT begin with another literal `ffmpeg`.
 * Task name `import-motion` fixes the input path.
 */
const FFMPEG_ARGUMENTS =
  `-c:v libvpx-vp9 -i /input/import-motion/motion-alpha.webm -an ` +
  `-vf "setpts=0.55*PTS,fps=30,scale='if(gte(iw,ih),512,-2)':'if(gte(iw,ih),-2,512)':flags=lanczos,format=yuva420p" ` +
  `-t 2.9 -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -row-mt 1 -deadline good -cpu-used 2 ` +
  `-b:v 300k -maxrate 350k -bufsize 700k /output/telegram-motion.webm`;
const NORMALIZE_CONTRACT_VERSION = "telegram-motion-v1";

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

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Provider metadata is untrusted: numbers may arrive as strings like "512" or "29.97 fps". */
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/-?\d+(\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}
/**
 * Duration is reported inconsistently by ExifTool: a raw number, `2.90 s`,
 * or a clock string such as `0:00:02.900`. Never fabricate — return null
 * when the value is not provable.
 */
function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const clock = text.match(/(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)/);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    const s = Number(clock[3]);
    if ([h, m, s].every((v) => Number.isFinite(v))) return h * 3600 + m * 60 + s;
    return null;
  }
  const mmss = text.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);
  if (mmss) {
    const m = Number(mmss[1]);
    const s = Number(mmss[2]);
    if (Number.isFinite(m) && Number.isFinite(s)) return m * 60 + s;
    return null;
  }
  const decimal = text.match(/-?\d+(?:\.\d+)?/);
  if (decimal) {
    const parsed = Number(decimal[0]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}


/** Case-insensitive deep lookup across defensive metadata key naming. */
function findKey(source: unknown, keys: string[], depth = 0): unknown {
  if (depth > 5 || !source || typeof source !== "object") return undefined;
  const wanted = keys.map((k) => k.toLowerCase());
  const entries = Array.isArray(source)
    ? (source as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(source as Json);
  for (const [key, value] of entries) {
    if (wanted.includes(key.toLowerCase()) && value !== null && value !== undefined) return value;
  }
  for (const [, value] of entries) {
    const nested = findKey(value, keys, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/* --------------------------------------------------------------- providers */

async function falFetch(url: string, key: string, init: RequestInit) {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
        // fal must NOT auto-retry server failures — duplicate paid work.
        "X-Fal-No-Retry": "1",
        "X-Fal-Store-IO": "0",
      },
    });
    let payload: Json = {};
    try { payload = asObject(await response.json()); } catch { payload = {}; }
    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        message:
          response.status === 401 || response.status === 403
            ? "fal.ai rejected the configured credentials."
            : response.status === 429
              ? "fal.ai is rate limiting requests."
              : response.status >= 500
                ? "fal.ai is temporarily unavailable."
                : str(payload.detail) ?? str(payload.message) ?? "fal.ai returned an unexpected error.",
        payload,
      };
    }
    return { ok: true as const, status: response.status, payload };
  } catch {
    return { ok: false as const, status: 0, message: "Could not reach fal.ai.", payload: {} as Json };
  }
}

async function ccFetch(path: string, key: string, init: RequestInit) {
  try {
    const response = await fetch(`${CLOUDCONVERT_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });
    let payload: Json = {};
    try { payload = asObject(await response.json()); } catch { payload = {}; }
    if (!response.ok) {
      return {
        ok: false as const,
        status: response.status,
        message:
          response.status === 401 || response.status === 403
            ? "CloudConvert rejected the configured credentials."
            : response.status === 429
              ? "CloudConvert is rate limiting requests."
              : response.status >= 500
                ? "CloudConvert is temporarily unavailable."
                : str(payload.message) ?? "CloudConvert returned an unexpected error.",
        payload,
      };
    }
    return { ok: true as const, status: response.status, payload };
  } catch {
    return { ok: false as const, status: 0, message: "Could not reach CloudConvert.", payload: {} as Json };
  }
}

type CcTask = Json & { name?: string; operation?: string; status?: string; result?: Json; credits?: unknown };

function ccTasks(job: Json): CcTask[] {
  const tasks = job.tasks;
  return Array.isArray(tasks) ? (tasks.filter((t) => t && typeof t === "object") as CcTask[]) : [];
}

function ccTask(job: Json, name: string, operation: string): CcTask | null {
  const tasks = ccTasks(job);
  return (
    tasks.find((t) => String(t.name ?? "") === name) ??
    tasks.find((t) => String(t.operation ?? "") === operation) ??
    null
  );
}

/* ------------------------------------------------------------------ server */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const FAL_KEY = Deno.env.get("FAL_KEY") ?? "";
  const CLOUDCONVERT_API_KEY = Deno.env.get("CLOUDCONVERT_API_KEY") ?? "";

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

  let body: Json;
  try { body = asObject(await req.json()); } catch { return respond({ error: "INVALID_BODY" }, 400); }

  const isMember = async (workspaceId: string) => {
    const { data } = await admin
      .from("workspace_members").select("user_id")
      .eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
    return Boolean(data);
  };

  const action = String(body.action ?? "");

  /* ------------------------------------------- config — free, no provider work */
  if (action === "config") {
    return respond({
      configured: Boolean(FAL_KEY && CLOUDCONVERT_API_KEY),
      falConfigured: Boolean(FAL_KEY),
      cloudConvertConfigured: Boolean(CLOUDCONVERT_API_KEY),
      falModel: FAL_MODEL,
      normalizeContractVersion: NORMALIZE_CONTRACT_VERSION,
      prepContractVersion: PREP_CONTRACT_VERSION,
      telegram: {
        format: TG.format,
        mimeType: TG.mimeType,
        codec: TG.codec,
        maxDurationSeconds: TG.maxDurationSeconds,
        maxFps: TG.maxFps,
        maxBytes: TG.maxBytes,
        maxDimension: TG.maxDimension,
      },
      publishesToTelegram: false,
    });
  }

  /** Marks ONLY this ai_job failed. Never touches sticker/pack/Telegram state. */
  const failJob = async (jobId: string, message: string, code = "MOTION_TELEGRAM_PREP_FAILED") => {
    await admin.from("ai_jobs").update({
      status: "failed",
      error_code: code,
      error_message: message.slice(0, 500),
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
    return respond({ aiJobId: jobId, jobType: JOB_TYPE, status: "failed", error: code, message, telegramChanged: false, releaseChanged: false });
  };

  try {
    /* ------------------------------------------------------------- start */
    if (action === "start") {
      const workspaceId = String(body.workspaceId ?? "");
      const packId = String(body.packId ?? "");
      const stickerId = String(body.stickerId ?? "");
      const motionVersionId = String(body.motionVersionId ?? "");
      if (!workspaceId || !packId || !stickerId || !motionVersionId) return respond({ error: "INVALID_INPUT" }, 400);
      if (!(await isMember(workspaceId))) return respond({ error: "FORBIDDEN" }, 403);

      const { data: pack } = await admin
        .from("sticker_packs").select("id,workspace_id").eq("id", packId).maybeSingle();
      if (!pack || pack.workspace_id !== workspaceId) return respond({ error: "PACK_NOT_FOUND" }, 404);

      const { data: sticker } = await admin
        .from("stickers").select("id,pack_id,image_asset_id,current_motion_version_id")
        .eq("id", stickerId).maybeSingle();
      if (!sticker || sticker.pack_id !== packId) return respond({ error: "STICKER_NOT_FOUND" }, 404);
      if (!sticker.image_asset_id) {
        return respond({ error: "MOTION_SOURCE_STALE", message: "This sticker has no current static image." }, 409);
      }
      // Only the APPROVED Current Motion may be prepared for Telegram.
      if (sticker.current_motion_version_id !== motionVersionId) {
        return respond({ error: "MOTION_NOT_CURRENT", message: "Only the approved Current Motion can be prepared for Telegram." }, 409);
      }

      const { data: version } = await admin
        .from("sticker_motion_versions")
        .select("id,workspace_id,pack_id,sticker_id,motion_asset_id,source_static_asset_id,telegram_asset_id")
        .eq("id", motionVersionId).maybeSingle();
      if (!version || version.workspace_id !== workspaceId || version.pack_id !== packId || version.sticker_id !== stickerId) {
        return respond({ error: "MOTION_VERSION_NOT_FOUND" }, 404);
      }
      if (!version.source_static_asset_id || version.source_static_asset_id !== sticker.image_asset_id) {
        return respond({ error: "MOTION_SOURCE_STALE", message: "This motion was generated from an earlier static image." }, 409);
      }
      if (!version.motion_asset_id) {
        return respond({ error: "MOTION_ASSET_MISSING", message: "This motion version has no stored clip." }, 409);
      }

      const { data: motionAsset } = await admin
        .from("media_assets").select("id,workspace_id,asset_type,storage_path")
        .eq("id", version.motion_asset_id).maybeSingle();
      if (!motionAsset || motionAsset.workspace_id !== workspaceId || motionAsset.asset_type !== "generated_motion" || !motionAsset.storage_path) {
        return respond({ error: "MOTION_ASSET_MISSING", message: "The stored clip for this motion version is not available." }, 409);
      }

      // Already prepared — never re-pay. Reuse requires durable proof that the
      // stored asset is a validated Telegram product OF THIS motion version.
      // A weak asset_type match is not sufficient. If proof is missing we fall
      // through to normal preparation WITHOUT clearing the existing pointer.
      if (version.telegram_asset_id) {
        const { data: existing } = await admin
          .from("media_assets").select("id,workspace_id,asset_type,metadata")
          .eq("id", version.telegram_asset_id).maybeSingle();
        const existingMeta = asObject(existing?.metadata);
        const provenReady =
          existingMeta.telegram_ready === true &&
          str(existingMeta.source_motion_version_id) === motionVersionId;
        if (existing && existing.workspace_id === workspaceId && existing.asset_type === "telegram_motion" && provenReady) {
          return respond({
            status: "ready", stage: "telegram_source_ready", reused: true, billable: false,
            telegramMotionAssetId: existing.id, motionVersionId, telegramReady: true,
            telegramAccepted: false, telegramChanged: false, releaseChanged: false,
          });
        }
      }


      if (!FAL_KEY || !CLOUDCONVERT_API_KEY) {
        return respond({
          error: "MOTION_TELEGRAM_NOT_CONFIGURED",
          message: "Telegram motion preparation is not configured (FAL_KEY / CLOUDCONVERT_API_KEY).",
        }, 503);
      }

      const readActiveJob = async () => {
        const { data } = await admin
          .from("ai_jobs").select("id,status,input_json,output_json")
          .eq("job_type", JOB_TYPE).eq("sticker_id", stickerId)
          .in("status", ["queued", "running"]).maybeSingle();
        return data ?? null;
      };
      const sameInput = (input: unknown) => {
        const i = asObject(input);
        return i.motion_version_id === motionVersionId && i.motion_asset_id === motionAsset.id;
      };
      const reuse = (job: { id: string; status: string; output_json?: unknown }) =>
        respond({
          aiJobId: job.id, status: job.status === "queued" ? "queued" : "running",
          stage: str(asObject(job.output_json).stage) ?? "background_removal",
          reused: true, billable: false, telegramChanged: false, releaseChanged: false,
        });

      const active = await readActiveJob();
      if (active) {
        if (sameInput(active.input_json)) return reuse(active);
        return respond({ error: "MOTION_TELEGRAM_PREP_ACTIVE", message: "A different Telegram motion preparation is already running for this sticker." }, 409);
      }

      // The ai_jobs row is created BEFORE any provider submission so a lost
      // response is always diagnosable. The partial unique index is the final
      // race authority.
      const { data: job, error: jobError } = await admin.from("ai_jobs").insert({
        workspace_id: workspaceId, user_id: user.id, pack_id: packId, sticker_id: stickerId,
        job_type: JOB_TYPE, status: "queued", provider: "fal+cloudconvert", provider_model: FAL_MODEL,
        input_json: {
          motion_version_id: motionVersionId,
          motion_asset_id: motionAsset.id,
          source_static_asset_id: version.source_static_asset_id,
          prep_contract_version: PREP_CONTRACT_VERSION,
          normalize_contract_version: NORMALIZE_CONTRACT_VERSION,
        },
      }).select("id,status").maybeSingle();

      if (jobError || !job) {
        if ((jobError as { code?: string } | null)?.code !== "23505") {
          return respond({ error: "JOB_CREATE_FAILED", message: "Could not start Telegram motion preparation." }, 500);
        }
        const raced = await readActiveJob();
        if (raced && sameInput(raced.input_json)) return reuse(raced);
        if (raced) return respond({ error: "MOTION_TELEGRAM_PREP_ACTIVE", message: "A different Telegram motion preparation is already running for this sticker." }, 409);
        return respond({ error: "JOB_CREATE_FAILED", message: "Could not start Telegram motion preparation." }, 500);
      }

      const { data: signed, error: signedError } = await admin.storage
        .from(BUCKET).createSignedUrl(motionAsset.storage_path, SIGNED_URL_TTL);
      if (signedError || !signed?.signedUrl) {
        return await failJob(job.id, "The motion source clip could not be prepared for background removal.", "SOURCE_URL_FAILED");
      }

      // Exactly ONE fal submission. Never automatically re-submitted anywhere.
      const submit = await falFetch(FAL_QUEUE_BASE, FAL_KEY, {
        method: "POST",
        body: JSON.stringify({
          video_url: signed.signedUrl,
          output_codec: "vp9",
          refine_foreground_edges: true,
          subject_is_person: false,
        }),
      });
      if (!submit.ok) {
        return await failJob(job.id, submit.message, "FAL_SUBMIT_FAILED");
      }

      const requestId = str(submit.payload.request_id);
      const statusUrl = str(submit.payload.status_url);
      const responseUrl = str(submit.payload.response_url);
      if (!requestId && !statusUrl) {
        return await failJob(job.id, "fal.ai returned no request identifier.", "FAL_SUBMIT_FAILED");
      }

      await admin.from("ai_jobs").update({
        status: "running",
        provider_task_id: requestId,
        output_json: {
          stage: "fal_processing",
          fal_model: FAL_MODEL,
          fal_request_id: requestId,
          fal_status_url: statusUrl,
          fal_response_url: responseUrl,
          prep_contract_version: PREP_CONTRACT_VERSION,
        },
      }).eq("id", job.id);

      return respond({
        aiJobId: job.id, status: "running", stage: "background_removal",
        billable: true, telegramChanged: false, releaseChanged: false,
      });
    }

    /* -------------------------------------------------------------- sync */
    if (action === "sync") {
      const aiJobId = String(body.aiJobId ?? "");
      if (!aiJobId) return respond({ error: "INVALID_INPUT" }, 400);

      const { data: job } = await admin.from("ai_jobs").select("*").eq("id", aiJobId).maybeSingle();
      if (!job) return respond({ error: "JOB_NOT_FOUND" }, 404);
      if (job.job_type !== JOB_TYPE) return respond({ error: "WRONG_JOB_TYPE" }, 400);
      if (!(await isMember(job.workspace_id))) return respond({ error: "FORBIDDEN" }, 403);

      const output = asObject(job.output_json);
      const input = asObject(job.input_json);

      if (job.status === "failed") {
        return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "failed", error: job.error_code, message: job.error_message, telegramChanged: false, releaseChanged: false });
      }
      if (job.status === "succeeded") {
        return respond({
          aiJobId: job.id, jobType: JOB_TYPE, status: "succeeded", stage: "telegram_source_ready",
          telegramMotionAssetId: output.telegram_motion_asset_id ?? null,
          motionVersionId: output.motion_version_id ?? null,
          validation: output.validation ?? null,
          telegramReady: true, telegramAccepted: false, telegramChanged: false, releaseChanged: false,
        });
      }

      const stage = str(output.stage);

      /* -- distributed-failure rule: never start paid work from recovery ---- */
      if (!stage) {
        return await failJob(job.id, "This preparation was interrupted before a provider request was durably recorded. Start it again explicitly.", "PREP_INTERRUPTED");
      }

      if (!FAL_KEY || !CLOUDCONVERT_API_KEY) {
        return respond({ error: "MOTION_TELEGRAM_NOT_CONFIGURED", message: "Telegram motion preparation is not configured." }, 503);
      }

      /* ------------------------------------------------ fal_processing --- */
      if (stage === "fal_processing") {
        const statusUrl = str(output.fal_status_url);
        const requestId = str(output.fal_request_id);
        const url = statusUrl ?? (requestId ? `${FAL_QUEUE_BASE}/requests/${requestId}/status` : null);
        if (!url) {
          return await failJob(job.id, "The background removal request could not be located. Start preparation again explicitly.", "PREP_INTERRUPTED");
        }

        const status = await falFetch(url, FAL_KEY, { method: "GET" });
        if (!status.ok) {
          return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", stage: "background_removal", providerMessage: status.message });
        }
        const falStatus = String(status.payload.status ?? "").toUpperCase();
        if (falStatus === "IN_QUEUE" || falStatus === "IN_PROGRESS") {
          return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", stage: "background_removal" });
        }
        if (falStatus && falStatus !== "COMPLETED") {
          return await failJob(job.id, "Background removal did not complete.", "FAL_FAILED");
        }
        if (status.payload.error) {
          return await failJob(job.id, "Background removal reported an error.", "FAL_FAILED");
        }

        const responseUrl = str(output.fal_response_url)
          ?? str(status.payload.response_url)
          ?? (requestId ? `${FAL_QUEUE_BASE}/requests/${requestId}/response` : null);
        if (!responseUrl) {
          return await failJob(job.id, "Background removal produced no retrievable result.", "FAL_FAILED");
        }
        const result = await falFetch(responseUrl, FAL_KEY, { method: "GET" });
        if (!result.ok) {
          return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", stage: "background_removal", providerMessage: result.message });
        }
        const videoArr = result.payload.video;
        const first = Array.isArray(videoArr) ? asObject(videoArr[0]) : asObject(videoArr);
        const alphaUrl = str(first.url);
        if (!alphaUrl) {
          return await failJob(job.id, "Background removal returned no transparent video URL.", "FAL_FAILED");
        }

        // Atomic claim: only the caller that flips the stage may create paid
        // CloudConvert work. Concurrent syncs observe and return.
        const nextOutput = { ...output, stage: "cloudconvert_starting", fal_alpha_url: alphaUrl };
        const { data: claimed } = await admin.from("ai_jobs")
          .update({ output_json: nextOutput })
          .eq("id", job.id)
          .eq("output_json->>stage", "fal_processing")
          .select("id");
        if (!claimed || claimed.length === 0) {
          const { data: reread } = await admin.from("ai_jobs").select("id,status,output_json").eq("id", job.id).maybeSingle();
          return respond({
            aiJobId: job.id, jobType: JOB_TYPE, status: reread?.status ?? "running",
            stage: str(asObject(reread?.output_json).stage) ?? "telegram_normalizing",
          });
        }

        return await createCloudConvert(alphaUrl, nextOutput);
      }

      /* --------------------------------------- cloudconvert_starting ------ */
      if (stage === "cloudconvert_starting") {
        // NEVER create a second CloudConvert job automatically. Try to confirm
        // an already-created job by its deterministic tag first.
        const tag = `cartelhq-motion-telegram-${job.id}`;
        // List lookup only — `include=tasks` is not supported on the list call.
        // Once the job id is persisted, normal /jobs/{id}?include=tasks polling loads tasks.
        const lookup = await ccFetch(`/jobs?filter[tag]=${encodeURIComponent(tag)}`, CLOUDCONVERT_API_KEY, { method: "GET" });
        const list = lookup.ok && Array.isArray(lookup.payload.data) ? (lookup.payload.data as unknown[]) : [];
        const found = list.map(asObject).find((entry) => str(entry.id));
        if (found) {
          const ccJobId = str(found.id)!;
          await admin.from("ai_jobs").update({
            output_json: { ...output, stage: "cloudconvert_processing", cloudconvert_job_id: ccJobId },
          }).eq("id", job.id);
          return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", stage: "telegram_normalizing" });
        }
        return await failJob(job.id, "Telegram normalization was interrupted before it could be confirmed. Start preparation again explicitly.", "PREP_INTERRUPTED");
      }

      /* -------------------------------------- cloudconvert_processing ----- */
      if (stage === "cloudconvert_processing") {
        const ccJobId = str(output.cloudconvert_job_id);
        if (!ccJobId) {
          return await failJob(job.id, "The normalization job reference is missing. Start preparation again explicitly.", "PREP_INTERRUPTED");
        }
        const query = await ccFetch(`/jobs/${encodeURIComponent(ccJobId)}`, CLOUDCONVERT_API_KEY, { method: "GET" });
        if (!query.ok) {
          return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", stage: "telegram_normalizing", providerMessage: query.message });
        }
        const ccJob = asObject(query.payload.data);
        const ccStatus = String(ccJob.status ?? "").toLowerCase();
        if (ccStatus === "waiting" || ccStatus === "processing" || !ccStatus) {
          return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", stage: "telegram_normalizing" });
        }
        if (ccStatus === "error") {
          const errored = ccTasks(ccJob).find((t) => String(t.status ?? "") === "error");
          const message = str(errored?.message) ?? "Telegram normalization failed.";
          return await failJob(job.id, message, "CLOUDCONVERT_FAILED");
        }
        if (ccStatus !== "finished") {
          return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: "running", stage: "telegram_normalizing" });
        }

        const exportTask = ccTask(ccJob, "export-motion", "export/url");
        const metaTask = ccTask(ccJob, "metadata-motion", "metadata");
        const files = Array.isArray(asObject(exportTask?.result).files) ? (asObject(exportTask?.result).files as unknown[]) : [];
        const exportUrl = str(asObject(files[0]).url);
        if (!exportUrl) {
          return await failJob(job.id, "Telegram normalization produced no downloadable file.", "CLOUDCONVERT_FAILED");
        }

        let bytes: Uint8Array;
        try {
          const download = await fetch(exportUrl);
          if (!download.ok) throw new Error("download failed");
          bytes = new Uint8Array(await download.arrayBuffer());
        } catch {
          return await failJob(job.id, "The normalized Telegram clip could not be downloaded.", "TELEGRAM_DOWNLOAD_FAILED");
        }
        if (!bytes.byteLength) {
          return await failJob(job.id, "The normalized Telegram clip was empty.", "TELEGRAM_DOWNLOAD_FAILED");
        }

        /* ----------------------------------------------- validation -------
         * Fail closed: core Telegram-relevant properties MUST be provable from
         * CloudConvert metadata. Missing evidence is a validation failure, never
         * an assumption, and values are never fabricated. */
        const metadata = asObject(asObject(metaTask?.result).metadata);
        const width = num(findKey(metadata, ["ImageWidth", "width", "VideoWidth", "SourceImageWidth"]));
        const height = num(findKey(metadata, ["ImageHeight", "height", "VideoHeight", "SourceImageHeight"]));
        const duration = parseDurationSeconds(findKey(metadata, ["Duration", "duration", "MediaDuration"]));
        const fps = num(findKey(metadata, ["VideoFrameRate", "frame_rate", "FrameRate", "fps"]));
        const codecRaw = str(findKey(metadata, ["VideoCodec", "codec", "CompressorID", "CodecID", "VideoCodecID"]) as string | undefined);
        const audioCodec = findKey(metadata, ["AudioCodec", "audio_codec", "AudioFormat"]);
        const audioStream = findKey(metadata, ["AudioChannels", "AudioSampleRate", "AudioBitrate"]);
        const alphaRaw = findKey(metadata, ["AlphaMode", "alpha_mode", "HasAlpha", "alpha"]);
        const containerRaw = str(findKey(metadata, ["MIMEType", "mime_type", "FileType", "FileTypeExtension", "Format"]) as string | undefined);

        const failures: string[] = [];

        // Byte size is always provable from the actual download.
        if (bytes.byteLength > TG.maxBytes) failures.push(`file size ${bytes.byteLength} exceeds ${TG.maxBytes} bytes`);

        if (width == null) failures.push("width unavailable");
        if (height == null) failures.push("height unavailable");
        if (duration == null) failures.push("duration unavailable");
        if (fps == null) failures.push("fps unavailable");
        if (!codecRaw) failures.push("codec unavailable");

        if (duration != null && duration > TG.maxDurationSeconds + 0.001) failures.push(`duration ${duration}s exceeds ${TG.maxDurationSeconds}s`);
        if (fps != null && fps > TG.maxFps + 0.5) failures.push(`frame rate ${fps} exceeds ${TG.maxFps}`);
        if (codecRaw && !codecRaw.toLowerCase().includes("vp9") && !codecRaw.toLowerCase().includes("vp09")) {
          failures.push(`codec ${codecRaw} is not VP9`);
        }
        if (width != null && height != null) {
          const longest = Math.max(width, height);
          const shortest = Math.min(width, height);
          if (longest !== TG.maxDimension || shortest > TG.maxDimension) {
            failures.push(`dimensions ${width}x${height} do not satisfy longest-side ${TG.maxDimension}`);
          }
        }

        // Audio: explicit evidence of an audio stream fails. Absent evidence is
        // encoder-enforced by the fixed `-an` command; never fabricate a codec.
        let audioEvidence: string;
        const explicitAudioCodec =
          typeof audioCodec === "string" && audioCodec.trim() && !["none", "no", "false", "0"].includes(audioCodec.trim().toLowerCase())
            ? audioCodec.trim()
            : null;
        const explicitAudioStream = num(audioStream);
        if (explicitAudioCodec || (explicitAudioStream != null && explicitAudioStream > 0)) {
          audioEvidence = "present";
          failures.push("an audio stream is present");
        } else {
          audioEvidence = "encoder-enforced";
        }

        // Alpha is fail-closed only when metadata EXPLICITLY reports no alpha.
        let alphaEvidence: string;
        if (alphaRaw === false || (typeof alphaRaw === "string" && ["none", "false", "no", "0"].includes(alphaRaw.trim().toLowerCase()))) {
          alphaEvidence = "absent";
          failures.push("metadata reports no alpha channel");
        } else if (alphaRaw === true || (typeof alphaRaw === "string" && alphaRaw.trim())) {
          alphaEvidence = "reported";
        } else {
          // Not provable from provider metadata; the encoder contract enforces it.
          alphaEvidence = "encoder-enforced";
        }

        // Container: explicit non-WEBM fails; unavailable is encoder-enforced by
        // the fixed `/output/telegram-motion.webm` output path.
        let containerEvidence: string;
        if (containerRaw) {
          const c = containerRaw.toLowerCase();
          if (c.includes("webm")) {
            containerEvidence = "reported";
          } else {
            containerEvidence = "mismatch";
            failures.push(`container ${containerRaw} is not WEBM`);
          }
        } else {
          containerEvidence = "encoder-enforced";
        }

        const validation = {
          bytes: bytes.byteLength,
          max_bytes: TG.maxBytes,
          width, height, duration_seconds: duration, fps,
          codec: codecRaw,
          audio: explicitAudioCodec,
          audio_evidence: audioEvidence,
          alpha: alphaEvidence,
          container: containerRaw,
          container_evidence: containerEvidence,
          mime_type: TG.mimeType,
          normalize_contract_version: NORMALIZE_CONTRACT_VERSION,
          telegram_accepted: false,
          failures,
        };

        if (failures.length > 0) {
          await admin.from("ai_jobs").update({ output_json: { ...output, validation } }).eq("id", job.id);
          return await failJob(job.id, `The normalized clip does not satisfy Telegram constraints: ${failures.join("; ")}`, "TELEGRAM_VALIDATION_FAILED");
        }

        /* ------------------------------------------------ persistence ----- */
        const motionVersionId = str(input.motion_version_id);
        const motionAssetId = str(input.motion_asset_id);
        const sourceStaticAssetId = str(input.source_static_asset_id);
        if (!motionVersionId || !motionAssetId || !sourceStaticAssetId) {
          return await failJob(job.id, "The preparation job is missing its motion linkage.", "PREP_INTERRUPTED");
        }

        // Staleness guard: the sticker must still point at the exact motion
        // version and static image this paid preparation was based on. If it
        // moved, we do NOT link — and we never switch release state or delete
        // the source/derivative.
        const { data: liveSticker } = await admin
          .from("stickers").select("id,image_asset_id,current_motion_version_id")
          .eq("id", job.sticker_id).maybeSingle();
        if (
          !liveSticker ||
          liveSticker.current_motion_version_id !== motionVersionId ||
          liveSticker.image_asset_id !== sourceStaticAssetId
        ) {
          return await failJob(
            job.id,
            "The sticker's current motion or static image changed during preparation, so the Telegram clip was not linked.",
            "MOTION_SOURCE_STALE",
          );
        }


        const path = `${job.workspace_id}/telegram_motion/motion-${motionVersionId}-${job.id}.webm`;
        const findAsset = async () => {
          const { data: found } = await admin.from("media_assets").select("id")
            .eq("workspace_id", job.workspace_id).eq("storage_path", path).maybeSingle();
          return found?.id ?? null;
        };

        const { error: uploadError } = await admin.storage.from(BUCKET)
          .upload(path, bytes, { contentType: TG.mimeType, upsert: false });
        let telegramAssetId: string | null = await findAsset();
        if (uploadError && !telegramAssetId) {
          const slash = path.lastIndexOf("/");
          const { data: listed } = await admin.storage.from(BUCKET)
            .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 100 });
          const exists = (listed ?? []).some((entry) => entry.name === path.slice(slash + 1));
          if (!exists) {
            return await failJob(job.id, "Could not save the Telegram-ready motion clip.", "STORAGE_UPLOAD_FAILED");
          }
        }

        const ccCredits = ccTasks(ccJob)
          .map((t) => num(t.credits))
          .filter((v): v is number => v != null)
          .reduce((a, b) => a + b, 0);

        if (!telegramAssetId) {
          const { data: asset, error: assetError } = await admin.from("media_assets").insert({
            workspace_id: job.workspace_id, uploaded_by: job.user_id, storage_path: path,
            asset_type: "telegram_motion", mime_type: TG.mimeType, file_size_bytes: bytes.byteLength,
            width: width ?? null, height: height ?? null,
            metadata: {
              source: "fal+cloudconvert",
              source_motion_asset_id: motionAssetId,
              source_motion_version_id: motionVersionId,
              source_static_asset_id: sourceStaticAssetId,
              fal_model: FAL_MODEL,
              fal_request_id: output.fal_request_id ?? null,
              cloudconvert_job_id: ccJobId,
              cloudconvert_credits: ccCredits || null,
              normalize_contract_version: NORMALIZE_CONTRACT_VERSION,
              prep_contract_version: PREP_CONTRACT_VERSION,
              validation,
              telegram_ready: true,
              telegram_accepted: false,
            },
          }).select("id").maybeSingle();
          telegramAssetId = asset?.id ?? (assetError ? await findAsset() : null);
          if (!telegramAssetId) {
            return await failJob(job.id, "Could not record the Telegram-ready motion asset.", "ASSET_RECORD_FAILED");
          }
        }

        // Guarded: ONLY telegram_asset_id, only for the exact unchanged lineage.
        const { data: updatedVersion } = await admin.from("sticker_motion_versions")
          .update({ telegram_asset_id: telegramAssetId })
          .eq("id", motionVersionId)
          .eq("motion_asset_id", motionAssetId)
          .eq("source_static_asset_id", sourceStaticAssetId)
          .select("id");
        if (!updatedVersion || updatedVersion.length === 0) {
          return await failJob(job.id, "The motion version changed during preparation, so the Telegram clip was not linked.", "MOTION_SOURCE_STALE");
        }

        await admin.from("ai_jobs").update({
          status: "succeeded", completed_at: new Date().toISOString(),
          output_json: {
            ...output,
            stage: "telegram_source_ready",
            telegram_motion_asset_id: telegramAssetId,
            motion_version_id: motionVersionId,
            storage_path: path,
            cloudconvert_job_id: ccJobId,
            cloudconvert_credits: ccCredits || null,
            validation,
          },
        }).eq("id", job.id);

        return respond({
          aiJobId: job.id, jobType: JOB_TYPE, status: "succeeded", stage: "telegram_source_ready",
          telegramMotionAssetId: telegramAssetId, motionVersionId, validation,
          telegramReady: true, telegramAccepted: false, telegramChanged: false, releaseChanged: false,
        });
      }

      return respond({ aiJobId: job.id, jobType: JOB_TYPE, status: job.status, stage });

      /** Creates exactly ONE CloudConvert job. Only reachable from a claimed transition. */
      async function createCloudConvert(alphaUrl: string, currentOutput: Json) {
        const tag = `cartelhq-motion-telegram-${job!.id}`;
        const create = await ccFetch("/jobs", CLOUDCONVERT_API_KEY, {
          method: "POST",
          body: JSON.stringify({
            tag,
            tasks: {
              "import-motion": { operation: "import/url", url: alphaUrl, filename: "motion-alpha.webm" },
              "normalize-motion": {
                operation: "command",
                input: "import-motion",
                engine: "ffmpeg",
                command: "ffmpeg",
                arguments: FFMPEG_ARGUMENTS,
              },
              "metadata-motion": { operation: "metadata", input: "normalize-motion" },
              "export-motion": { operation: "export/url", input: "normalize-motion" },
            },
          }),
        });
        if (!create.ok) {
          return await failJob(job!.id, create.message, "CLOUDCONVERT_START_FAILED");
        }
        const ccJobId = str(asObject(create.payload.data).id);
        if (!ccJobId) {
          return await failJob(job!.id, "CloudConvert returned no job identifier.", "CLOUDCONVERT_START_FAILED");
        }
        await admin.from("ai_jobs").update({
          output_json: { ...currentOutput, stage: "cloudconvert_processing", cloudconvert_job_id: ccJobId, cloudconvert_tag: tag },
        }).eq("id", job!.id);
        return respond({ aiJobId: job!.id, jobType: JOB_TYPE, status: "running", stage: "telegram_normalizing" });
      }
    }

    return respond({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("[sticker-motion-telegram] unexpected error", error instanceof Error ? error.message : "unknown");
    return respond({ error: "INTERNAL_ERROR", message: "Unexpected server error." }, 500);
  }
});
