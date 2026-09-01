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
const COMPILER_VERSION = "v1";
const MAX_INSTRUCTION = 500;
const MAX_STR = 600;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM = 160;

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

/* ------------------------------------------- defensive blueprint parsing ---
 * `creative_blueprint` is untrusted stored JSON. Only the fields the motion
 * compiler actually needs are read, each length- and shape-capped.
 * -------------------------------------------------------------------------*/

function safeStr(value: unknown, cap = MAX_STR): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

function safeList(value: unknown, maxItems = MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const item = raw.trim().slice(0, MAX_LIST_ITEM);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

const INTENSITY = ["unspecified", "calm", "balanced", "high", "maximum"] as const;
type Intensity = (typeof INTENSITY)[number];

function safeIntensity(value: unknown): Intensity {
  return typeof value === "string" && (INTENSITY as readonly string[]).includes(value)
    ? (value as Intensity)
    : "unspecified";
}

type MotionCharacterLock = {
  enabled: boolean;
  subjectName: string;
  identityNotes: string;
  protectedTraits: string[];
  wardrobeAccessories: string[];
  negativeConstraints: string[];
};

type MotionCreativeDirection = {
  toneKeywords: string[];
  intensity: Intensity;
  visualDirection: string;
  packRules: string[];
};

type MotionBlueprint = {
  useBrandCharacterLock: boolean;
  characterLock: MotionCharacterLock | null;
  creativeDirection: MotionCreativeDirection | null;
};

function parseMotionBlueprint(raw: unknown): MotionBlueprint {
  const empty: MotionBlueprint = { useBrandCharacterLock: false, characterLock: null, creativeDirection: null };
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw.trim()) {
    try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { obj = null; }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return empty;

  const lockRaw = obj.characterLock;
  let characterLock: MotionCharacterLock | null = null;
  if (lockRaw && typeof lockRaw === "object" && !Array.isArray(lockRaw)) {
    const l = lockRaw as Record<string, unknown>;
    characterLock = {
      enabled: l.enabled === true,
      subjectName: safeStr(l.subjectName, 160),
      identityNotes: safeStr(l.identityNotes),
      protectedTraits: safeList(l.protectedTraits),
      wardrobeAccessories: safeList(l.wardrobeAccessories),
      negativeConstraints: safeList(l.negativeConstraints),
    };
  }

  const cdRaw = obj.creativeDirection;
  let creativeDirection: MotionCreativeDirection | null = null;
  if (cdRaw && typeof cdRaw === "object" && !Array.isArray(cdRaw)) {
    const c = cdRaw as Record<string, unknown>;
    creativeDirection = {
      toneKeywords: safeList(c.toneKeywords),
      intensity: safeIntensity(c.intensity),
      visualDirection: safeStr(c.visualDirection),
      packRules: safeList(c.packRules),
    };
  }

  return { useBrandCharacterLock: obj.useBrandCharacterLock === true, characterLock, creativeDirection };
}

function hasLockContent(lock: MotionCharacterLock | null): boolean {
  if (!lock) return false;
  return Boolean(
    lock.subjectName || lock.identityNotes || lock.protectedTraits.length ||
    lock.wardrobeAccessories.length || lock.negativeConstraints.length,
  );
}

/* ---------------------------------------------------------- motion prompt */

type MotionMode = "quick" | "ai" | "custom";

/**
 * Quick Motion presets. The browser may only send one of these keys; the
 * wording the model sees is always server-controlled.
 */
const QUICK_PRESETS = {
  blink: "The character blinks naturally once or twice, with no other change.",
  head_nod: "The character gives one small, confident head nod and returns to the starting pose.",
  eye_glow: "The character's eyes glow briefly and softly, then settle back to normal.",
  money_rain: "A light shower of cash notes falls in front of the existing background, without changing the scene or the character.",
  angry_shake: "The character shakes with restrained anger for a moment and settles back to the starting pose.",
  laugh: "The character laughs briefly with a small shoulder bounce and returns to the starting pose.",
  bounce: "The whole character bounces gently in place a couple of times and settles.",
  raise_cigar: "The character raises the item already held in the supplied image in a short deliberate gesture, then lowers it back to the starting position. If no such item exists in the image, do not invent one and instead perform a small confident hand gesture.",
} as const;

type MotionPreset = keyof typeof QUICK_PRESETS;

const INTENSITY_MOTION_TEXT: Record<Intensity, string> = {
  unspecified: "",
  calm: "Keep the movement energy calm and understated.",
  balanced: "Keep the movement energy balanced and natural.",
  high: "Give the movement bold, high-energy timing while keeping it short and controlled.",
  maximum: "Give the movement maximal expressive timing while keeping it short, controlled and loop-friendly.",
};

/**
 * Motion prompt compiler v1. Priority, highest first:
 *  1. Production/motion safety (identity, caption, composition, camera)
 *  2. Character Lock identity rules (when enabled)
 *  3. Requested motion direction (preset / custom / deterministic AI)
 *  4. Creative Direction — energy and tone guidance only
 */
function buildMotionPrompt(input: {
  mode: MotionMode;
  preset: MotionPreset | null;
  direction: string;
  blueprint: MotionBlueprint;
}): string {
  const parts: string[] = [];
  const { blueprint } = input;
  const lockApplied = blueprint.useBrandCharacterLock && blueprint.characterLock?.enabled === true;
  const lock = lockApplied && hasLockContent(blueprint.characterLock) ? blueprint.characterLock! : null;
  const cd = blueprint.creativeDirection;

  // 1. Hard motion-safety constraints.
  parts.push("Animate the supplied static sticker image into ONE short looping character animation.");
  parts.push("The supplied image is the single authority for identity and composition. Reproduce its character exactly: same face, identity, proportions, body shape, colors, shading, line style, wardrobe and accessories.");
  parts.push("Preserve any visible caption, lettering or numerals exactly as they already appear in the supplied image. Never invent, add, translate, restyle or change any text.");
  parts.push("Keep the camera fixed by default: no zoom, no pan, no orbit, no cuts. Keep the subject centered and keep the starting composition, framing and background recognizably identical to the supplied image.");
  parts.push("Never morph the character, never add extra limbs, hands, fingers or eyes, never duplicate the character, never introduce a new scene, environment, background replacement, watermark, logo or on-screen text.");
  parts.push("No audio of any kind.");
  parts.push("Keep the movement short, restrained and loop-friendly: the final frame must return to a pose very close to the starting pose so the clip loops cleanly.");
  parts.push("Apply ONLY the movement and effects explicitly requested below. Add no other motion, particles, transitions or effects.");

  // 2. Character Lock — outranks all motion and style direction.
  if (lock) {
    parts.push("MANDATORY CHARACTER LOCK — these identity rules outrank every motion, energy or style instruction below and must never be reinterpreted:");
    if (lock.subjectName) parts.push(`Locked character identity: ${lock.subjectName}.`);
    if (lock.identityNotes) parts.push(`Identity definition: ${lock.identityNotes}`);
    if (lock.protectedTraits.length) parts.push(`Protected traits that must be reproduced exactly in every frame and never restyled: ${lock.protectedTraits.join(", ")}.`);
    if (lock.wardrobeAccessories.length) parts.push(`Required wardrobe and accessories that must remain present and unchanged in every frame: ${lock.wardrobeAccessories.join(", ")}.`);
    if (lock.negativeConstraints.length) parts.push(`Never do any of the following to this character: ${lock.negativeConstraints.join(", ")}.`);
  }

  // 3. Requested motion direction.
  const label =
    input.mode === "quick"
      ? "MOTION DIRECTION (selected preset)"
      : input.mode === "custom"
        ? "MOTION DIRECTION (user request, subordinate to every rule above)"
        : "MOTION DIRECTION (derived from this sticker's own concept, subordinate to every rule above)";
  parts.push(`${label}: ${input.direction}`);

  // 4. Creative Direction — energy/tone only.
  if (cd) {
    const guidance: string[] = [];
    if (cd.toneKeywords.length) guidance.push(`Tone: ${cd.toneKeywords.join(", ")}.`);
    const intensity = INTENSITY_MOTION_TEXT[cd.intensity];
    if (intensity) guidance.push(intensity);
    if (cd.visualDirection) guidance.push(`Visual direction: ${cd.visualDirection}`);
    if (cd.packRules.length) guidance.push(`Pack rules: ${cd.packRules.join("; ")}.`);
    if (guidance.length) {
      parts.push(`Pack creative direction (guides energy and tone ONLY; it can never override the identity, caption, composition or camera rules above): ${guidance.join(" ")}`);
    }
  }

  return parts.join(" ");
}

/**
 * AI Motion direction is derived DETERMINISTICALLY from the sticker's own
 * concept plus Creative Direction. No second LLM call is ever made.
 */
function deriveAiDirection(input: {
  stickerLabel: string;
  actionDescription: string;
  blueprint: MotionBlueprint;
}): string {
  const cd = input.blueprint.creativeDirection;
  const tone = cd?.toneKeywords.length ? ` Keep it consistent with the pack tone: ${cd.toneKeywords.join(", ")}.` : "";
  if (input.actionDescription) {
    return `Bring this sticker's own concept to life as movement. The concept action is: ${input.actionDescription}. Animate that action as a short, subtle, expressive loop from the pose already shown in the supplied image.${tone}`;
  }
  if (input.stickerLabel) {
    return `Bring this sticker's own concept to life as movement. The concept is "${input.stickerLabel}". Animate a subtle, expressive motion that reads clearly as that concept, starting from the pose already shown in the supplied image.${tone}`;
  }
  return `Animate a subtle, expressive idle motion that suits the character exactly as shown in the supplied image.${tone}`;
}

/* ------------------------------------------------------------ result MIME */

function normalizeMotionMime(contentType: string | null): string {
  const raw = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return raw.startsWith("video/") ? raw : "video/mp4";
}

function extensionForMime(mime: string): string {
  return mime === "video/webm" ? "webm" : "mp4";
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
    if (action === "start") {
      const workspaceId = String(body.workspaceId ?? "");
      const packId = String(body.packId ?? "");
      const stickerId = String(body.stickerId ?? "");
      const rawMode = String(body.motionMode ?? "");
      const mode: MotionMode | null =
        rawMode === "quick" || rawMode === "ai" || rawMode === "custom" ? rawMode : null;
      if (!workspaceId || !packId || !stickerId || !mode) return respond({ error: "INVALID_INPUT" }, 400);
      if (!(await isMember(workspaceId))) return respond({ error: "FORBIDDEN" }, 403);

      // Quick Motion presets are a strict server allowlist — never a silent fallback.
      let preset: MotionPreset | null = null;
      if (mode === "quick") {
        const rawPreset = safeStr(body.motionPreset, 60);
        if (!rawPreset || !(rawPreset in QUICK_PRESETS)) {
          return respond({ error: "INVALID_MOTION_PRESET", message: "Select a supported Quick Motion preset." }, 400);
        }
        preset = rawPreset as MotionPreset;
      }

      const customInstruction = mode === "custom" ? safeStr(body.motionInstruction, MAX_INSTRUCTION) : "";
      if (mode === "custom" && !customInstruction) {
        return respond({ error: "INVALID_INPUT", message: "A motion instruction is required." }, 400);
      }

      const { data: sticker } = await admin
        .from("stickers")
        .select("id,pack_id,image_asset_id,label,action_description")
        .eq("id", stickerId)
        .maybeSingle();
      if (!sticker || sticker.pack_id !== packId) return respond({ error: "STICKER_NOT_FOUND" }, 404);

      const { data: pack } = await admin
        .from("sticker_packs")
        .select("id,workspace_id,creative_blueprint")
        .eq("id", packId)
        .maybeSingle();
      if (!pack || pack.workspace_id !== workspaceId) return respond({ error: "PACK_NOT_FOUND" }, 404);

      if (!sticker.image_asset_id) {
        return respond({ error: "STATIC_NOT_MOTION_READY", message: "This sticker has no finished current image to animate." }, 409);
      }

      const { data: staticAsset } = await admin
        .from("media_assets")
        .select("id,storage_path,workspace_id,asset_type,transparency_valid")
        .eq("id", sticker.image_asset_id)
        .maybeSingle();
      if (
        !staticAsset ||
        staticAsset.workspace_id !== workspaceId ||
        staticAsset.asset_type !== "generated_sticker" ||
        staticAsset.transparency_valid !== true
      ) {
        return respond({ error: "STATIC_NOT_MOTION_READY", message: "This sticker's current image is not a validated transparent sticker image yet." }, 409);
      }

      // The static version this motion take was derived from, when known.
      const { data: sourceVersion } = await admin
        .from("sticker_versions")
        .select("id")
        .eq("sticker_id", stickerId)
        .eq("asset_id", staticAsset.id)
        .maybeSingle();

      const blueprint = parseMotionBlueprint(pack.creative_blueprint);

      // Deterministic direction — AI Motion never calls another model.
      const derivedInstruction =
        mode === "custom"
          ? customInstruction
          : mode === "ai"
            ? deriveAiDirection({
                stickerLabel: safeStr(sticker.label, 160),
                actionDescription: safeStr(sticker.action_description, MAX_INSTRUCTION),
                blueprint,
              })
            : null;

      const direction = mode === "quick" ? QUICK_PRESETS[preset!] : derivedInstruction!;
      const prompt = buildMotionPrompt({ mode, preset, direction, blueprint });

      // Duplicate-spend protection: an active motion job is reused ONLY when it
      // is the exact same compiled request.
      const requestIdentity = {
        source_static_asset_id: staticAsset.id,
        motion_mode: mode,
        motion_preset: preset,
        motion_instruction: derivedInstruction,
        prompt,
      };
      const sameIdentity = (input: unknown) => {
        const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
        return (
          i.source_static_asset_id === requestIdentity.source_static_asset_id &&
          i.motion_mode === requestIdentity.motion_mode &&
          (i.motion_preset ?? null) === requestIdentity.motion_preset &&
          (i.motion_instruction ?? null) === requestIdentity.motion_instruction &&
          i.prompt === requestIdentity.prompt
        );
      };

      const readActiveJob = async () => {
        const { data } = await admin
          .from("ai_jobs")
          .select("id,status,provider_model,input_json")
          .eq("job_type", JOB_TYPE)
          .eq("sticker_id", stickerId)
          .in("status", ["queued", "running"])
          .maybeSingle();
        return data ?? null;
      };

      const activeJob = await readActiveJob();
      if (activeJob) {
        if (sameIdentity(activeJob.input_json)) {
          return respond({ aiJobId: activeJob.id, status: activeJob.status === "queued" ? "queued" : "running", model: activeJob.provider_model ?? MODEL, reused: true });
        }
        return respond({ error: "MOTION_ALREADY_ACTIVE", message: "A different motion generation is already running for this sticker. Wait for it to finish." }, 409);
      }

      const { data: signed, error: signedError } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(staticAsset.storage_path, SIGNED_URL_TTL);
      if (signedError || !signed?.signedUrl) {
        return respond({ error: "SOURCE_URL_FAILED", message: "The current sticker image could not be prepared for animation." }, 500);
      }

      const { data: job, error: jobError } = await admin.from("ai_jobs").insert({
        workspace_id: workspaceId, user_id: user.id, pack_id: packId, sticker_id: stickerId,
        job_type: JOB_TYPE, status: "queued", provider: "kie", provider_model: MODEL,
        input_json: {
          mode: "motion",
          motion_mode: mode,
          motion_preset: preset,
          motion_instruction: derivedInstruction,
          source_static_asset_id: staticAsset.id,
          source_static_version_id: sourceVersion?.id ?? null,
          motion_prompt_compiler_version: COMPILER_VERSION,
          prompt,
        },
      }).select("*").single();

      if (jobError || !job) {
        // Only the active-motion guard index may be reused; any other insert
        // failure is a real error and must not silently reuse another job.
        if ((jobError as { code?: string } | null)?.code !== "23505") {
          return respond({ error: "JOB_CREATE_FAILED", message: "Could not start motion generation." }, 500);
        }
        const raced = await readActiveJob();
        if (raced && sameIdentity(raced.input_json)) {
          return respond({ aiJobId: raced.id, status: raced.status === "queued" ? "queued" : "running", model: raced.provider_model ?? MODEL, reused: true });
        }
        if (raced) {
          return respond({ error: "MOTION_ALREADY_ACTIVE", message: "A different motion generation is already running for this sticker. Wait for it to finish." }, 409);
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

    if (action === "sync") {
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
          mimeType: output.mime_type ?? null,
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
      let mimeType = "video/mp4";
      try {
        const download = await fetch(resultUrl);
        if (!download.ok) throw new Error("download failed");
        mimeType = normalizeMotionMime(download.headers.get("content-type"));
        clip = new Uint8Array(await download.arrayBuffer());
      } catch {
        return await failJob(job as Record<string, unknown>, "The generated motion clip could not be downloaded.", "MOTION_DOWNLOAD_FAILED");
      }
      if (!clip.byteLength) {
        return await failJob(job as Record<string, unknown>, "The generated motion clip was empty.", "MOTION_DOWNLOAD_FAILED");
      }

      // Deterministic object path keeps concurrent pollers idempotent. No transcoding.
      const path = `${job.workspace_id}/generated_motion/motion-${job.id}.${extensionForMime(mimeType)}`;
      const findAsset = async () => {
        const { data: found } = await admin.from("media_assets").select("id").eq("workspace_id", job.workspace_id).eq("storage_path", path).maybeSingle();
        return found?.id ?? null;
      };

      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, clip, { contentType: mimeType, upsert: false });
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
          asset_type: "generated_motion", mime_type: mimeType, file_size_bytes: clip.byteLength,
          metadata: {
            source: "kie",
            motion_model: job.provider_model,
            motion_task_id: job.provider_task_id,
            motion_job_id: job.id,
            motion_mode: motionMode,
            motion_preset: motionPreset,
            motion_instruction: motionInstruction,
            duration_seconds: 5,
            telegram_ready: false,
            source_static_asset_id: sourceAssetId,
            source_static_version_id: sourceVersionId,
            motion_prompt_compiler_version: COMPILER_VERSION,
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
        const { data: inserted, error: versionError } = await admin.from("sticker_motion_versions").insert({
          workspace_id: job.workspace_id, pack_id: job.pack_id, sticker_id: job.sticker_id,
          source_static_version_id: sourceVersionId, source_static_asset_id: sourceAssetId,
          motion_asset_id: motionAssetId, version_number: nextVersion,
          motion_mode: motionMode, motion_preset: motionPreset, motion_instruction: motionInstruction,
          provider_metadata: {
            provider: "kie", model: job.provider_model, task_id: job.provider_task_id,
            ai_job_id: job.id, duration_seconds: 5, telegram_ready: false,
            mime_type: mimeType, motion_prompt_compiler_version: COMPILER_VERSION,
          },
        }).select("id").maybeSingle();
        if (inserted) { motionVersionId = inserted.id; break; }
        // Only a unique conflict is retryable: either this asset already has a
        // row (idempotent authority) or the version number raced.
        if ((versionError as { code?: string } | null)?.code !== "23505") break;
        motionVersionId = await readVersion();
      }
      if (!motionVersionId) {
        return await failJob(job as Record<string, unknown>, "The motion clip was created but could not be recorded in motion history.", "MOTION_VERSION_FAILED");
      }

      await admin.from("ai_jobs").update({
        status: "succeeded", completed_at: new Date().toISOString(),
        output_json: {
          motion_asset_id: motionAssetId, motion_version_id: motionVersionId,
          storage_path: path, mime_type: mimeType, duration_seconds: 5, telegram_ready: false,
        },
      }).eq("id", job.id);
      await logCredits(job as Record<string, unknown>, credits);

      return respond({
        aiJobId: job.id, jobType: JOB_TYPE, status: "succeeded",
        motionAssetId, motionVersionId, mimeType, telegramReady: false, stage: "motion_source_ready",
      });
    }

    return respond({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("[sticker-motion-ai] unexpected error", error instanceof Error ? error.message : "unknown");
    return respond({ error: "INTERNAL_ERROR", message: "Unexpected server error." }, 500);
  }
});
