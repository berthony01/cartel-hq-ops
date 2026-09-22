import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { recordProviderCreditUsage } from "../_shared/usage-accounting.ts";
import { requireProjectToolAccess } from "../_shared/project-identity.ts";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from "npm:@imagemagick/magick-wasm@0.0.36";

const wasmBytes = await Deno.readFile(
  new URL("magick.wasm", import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.36")),
);
await initializeImageMagick(wasmBytes);

const KIE_BASE = "https://api.kie.ai";
const DEFAULT_MODEL = "flux-2/pro-image-to-image";
const BG_MODEL = "recraft/remove-background";
const BUCKET = "workspace-assets";
const SIGNED_URL_TTL = 900;

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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
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

/* ---------------------------------------------------------------------------
 * V2 creative blueprint parsing (defensive — `creative_blueprint` is untrusted)
 * ------------------------------------------------------------------------- */

const MAX_STR = 600;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM = 160;

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

function safeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

type CharacterLock = {
  enabled: boolean;
  subjectName: string;
  identityNotes: string;
  protectedTraits: string[];
  wardrobeAccessories: string[];
  negativeConstraints: string[];
  canonicalReferenceAssetIds: string[];
};

const HUMOR = ["unspecified", "none", "light", "balanced", "heavy"] as const;
const INTENSITY = ["unspecified", "calm", "balanced", "high", "maximum"] as const;
const TEXT_PREF = ["unspecified", "no_text", "minimal", "balanced", "text_forward"] as const;

type CreativeDirection = {
  purpose: string;
  audience: string;
  toneKeywords: string[];
  humorLevel: (typeof HUMOR)[number];
  intensity: (typeof INTENSITY)[number];
  visualDirection: string;
  textPreference: (typeof TEXT_PREF)[number];
  textNotes: string;
  packRules: string[];
};

type Blueprint = {
  useBrandCharacterLock: boolean;
  characterLock: CharacterLock | null;
  creativeDirection: CreativeDirection | null;
};

function parseBlueprint(raw: unknown): Blueprint {
  const empty: Blueprint = {
    useBrandCharacterLock: false,
    characterLock: null,
    creativeDirection: null,
  };
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw.trim()) {
    try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { obj = null; }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return empty;

  const lockRaw = obj.characterLock;
  let characterLock: CharacterLock | null = null;
  if (lockRaw && typeof lockRaw === "object" && !Array.isArray(lockRaw)) {
    const l = lockRaw as Record<string, unknown>;
    characterLock = {
      enabled: l.enabled === true,
      subjectName: safeStr(l.subjectName, 160),
      identityNotes: safeStr(l.identityNotes),
      protectedTraits: safeList(l.protectedTraits),
      wardrobeAccessories: safeList(l.wardrobeAccessories),
      negativeConstraints: safeList(l.negativeConstraints),
      canonicalReferenceAssetIds: safeList(l.canonicalReferenceAssetIds, 3),
    };
  }

  const cdRaw = obj.creativeDirection;
  let creativeDirection: CreativeDirection | null = null;
  if (cdRaw && typeof cdRaw === "object" && !Array.isArray(cdRaw)) {
    const c = cdRaw as Record<string, unknown>;
    creativeDirection = {
      purpose: safeStr(c.purpose),
      audience: safeStr(c.audience),
      toneKeywords: safeList(c.toneKeywords),
      humorLevel: safeEnum(c.humorLevel, HUMOR, "unspecified"),
      intensity: safeEnum(c.intensity, INTENSITY, "unspecified"),
      visualDirection: safeStr(c.visualDirection),
      textPreference: safeEnum(c.textPreference, TEXT_PREF, "unspecified"),
      textNotes: safeStr(c.textNotes),
      packRules: safeList(c.packRules),
    };
  }

  return {
    useBrandCharacterLock: obj.useBrandCharacterLock === true,
    characterLock,
    creativeDirection,
  };
}

function hasCreativeDirectionContent(cd: CreativeDirection | null): boolean {
  if (!cd) return false;
  return Boolean(
    cd.purpose || cd.audience || cd.toneKeywords.length || cd.visualDirection ||
    cd.textNotes || cd.packRules.length ||
    cd.humorLevel !== "unspecified" || cd.intensity !== "unspecified" ||
    cd.textPreference !== "unspecified",
  );
}

function hasCharacterLockContent(lock: CharacterLock | null): boolean {
  if (!lock) return false;
  return Boolean(
    lock.subjectName || lock.identityNotes || lock.protectedTraits.length ||
    lock.wardrobeAccessories.length || lock.negativeConstraints.length,
  );
}

const HUMOR_TEXT: Record<string, string> = {
  none: "Keep humor out of it; play the concept straight.",
  light: "Keep humor light and subtle.",
  balanced: "Use a clearly playful, comedic tone that stays controlled.",
  heavy: "Lean into strong, exaggerated comedic energy.",
};

const INTENSITY_TEXT: Record<string, string> = {
  calm: "Keep the energy calm and understated.",
  balanced: "Keep the energy balanced and natural.",
  high: "Make the pose and expression bold and high-energy.",
  maximum: "Push the pose and expression to a maximal, extreme reaction.",
};

/**
 * A/B/C Variations — the ONLY variation wording the model ever sees. Labels are
 * server-controlled; the browser can only ask for A, B or C.
 */
const VARIATION_TEXT: Record<"A" | "B" | "C", string> = {
  A: "This is alternate take A: stay closest to the approved concept, changing only to a natural alternate pose or composition of the same idea.",
  B: "This is alternate take B: make the pose, expression and composition noticeably different from the obvious first reading of the concept while staying fully on brief.",
  C: "This is alternate take C: take the boldest on-brief alternate interpretation of the concept, with the most expressive pose and composition, while preserving every mandatory identity and text rule exactly.",
};


/**
 * V2 prompt compiler. Hierarchy, highest priority first:
 *  1. Production/one-sticker safety constraints
 *  2. Character Lock identity rules (pack snapshot only)
 *  3. Explicit concept pose/action + explicit text preference
 *  4. Brand Kit styling
 *  5. Pack Creative Direction
 *  6. Legacy freeform brief / style notes / pack rules (guidance only)
 *  7. Final production constraints restated
 */
function buildPrompt(
  brand: Record<string, unknown> | null,
  pack: Record<string, unknown>,
  sticker: Record<string, unknown>,
  blueprint: Blueprint,
  /**
   * A/B/C Variations — server-controlled ONLY. Supplied exclusively by
   * `start_variation`. It is injected AFTER the mandatory identity/concept/text
   * rules and BEFORE lower-priority styling guidance, so it can never override
   * Character Lock or the exact caption contract.
   */
  variationLabel: "A" | "B" | "C" | null = null,
) {
  const parts: string[] = [];
  const label = String(sticker.label ?? "").trim();
  const action = String(sticker.action_description ?? "").trim();
  const characterName = String(pack.character_name ?? "").trim();

  // Applied == opted in AND a snapshot object exists (canonical-reference-only
  // locks are valid). The textual block below is emitted only when there is
  // actual identity text to compile.
  const lockApplied =
    blueprint.useBrandCharacterLock === true && blueprint.characterLock !== null;
  const lock =
    lockApplied && hasCharacterLockContent(blueprint.characterLock)
      ? blueprint.characterLock!
      : null;
  const cd = blueprint.creativeDirection;
  const textPreference = cd?.textPreference ?? "unspecified";
  const noText = textPreference === "no_text";

  // 1. Hard production constraints.
  parts.push("Create exactly ONE clean die-cut messaging sticker using the SAME character identity shown in the supplied reference image.");
  parts.push("Preserve the character's face, proportions, colors, wardrobe, accessories and overall identity. Only change the pose and expression requested.");

  // 2. Character Lock (mandatory identity contract).
  if (lock) {
    parts.push("MANDATORY CHARACTER LOCK — these identity rules outrank every style, brief or creative note below and must never be reinterpreted:");
    if (lock.subjectName) parts.push(`Locked character identity: ${lock.subjectName}.`);
    else if (characterName) parts.push(`Locked character identity: ${characterName}.`);
    if (lock.identityNotes) parts.push(`Identity definition: ${lock.identityNotes}`);
    if (lock.protectedTraits.length) parts.push(`Protected traits that must be reproduced exactly and never restyled: ${lock.protectedTraits.join(", ")}.`);
    if (lock.wardrobeAccessories.length) parts.push(`Required wardrobe and accessories: ${lock.wardrobeAccessories.join(", ")}.`);
    if (lock.negativeConstraints.length) parts.push(`Never do any of the following to this character: ${lock.negativeConstraints.join(", ")}.`);
    if (characterName && lock.subjectName && characterName !== lock.subjectName) {
      parts.push(`Additional legacy subject context: ${characterName}.`);
    }
  } else if (characterName) {
    parts.push(`Character or brand subject: ${characterName}.`);
  }

  // 3. Explicit concept intent.
  if (action) parts.push(`Pose or expression: ${action}.`);

  // 3b. Text preference (overrides any freeform text guidance below).
  if (noText) {
    parts.push("TEXT RULE (mandatory, overrides any other text guidance): render NO visible text, caption, lettering, numerals or written words anywhere in the image. The concept name is planning metadata only and must not appear.");
  } else if (label) {
    const caption =
      textPreference === "minimal"
        ? `Include the short caption text "${label}" spelled exactly as written, as a compact supporting caption. Do not add any other words.`
        : textPreference === "balanced"
          ? `Include the caption text "${label}" spelled exactly as written, as a clear readable caption. Do not add any other words.`
          : textPreference === "text_forward"
            ? `Include the caption text "${label}" spelled exactly as written, rendered prominently as a major design element of the sticker. Do not add any other words.`
            : `Include the short caption text "${label}" spelled exactly as written, in bold readable sticker lettering. Do not add any other words.`;
    parts.push(`TEXT RULE (mandatory, overrides any other text guidance): ${caption}`);
  } else {
    parts.push("TEXT RULE (mandatory, overrides any other text guidance): no caption text was supplied, so do not invent, add or imply any words or lettering.");
  }

  // 3c. Variation direction (server-controlled, lower priority than every
  // mandatory rule above and never a licence to change identity or caption).
  const variationText = variationLabel ? VARIATION_TEXT[variationLabel] : "";
  if (variationText) {
    parts.push(`VARIATION DIRECTION (lower priority than the identity, concept and text rules above, which must still be obeyed exactly): ${variationText}`);
  }

  // 4. Brand Kit styling (unchanged behavior).
  if (brand) {
    const brandName = String(brand.brand_name ?? "").trim();
    const ticker = String(brand.ticker ?? "").trim();
    if (brandName) parts.push(`Brand: ${brandName}${ticker ? ` (${ticker})` : ""}.`);
    const colors = stringArray(brand.colors);
    if (colors.length) parts.push(`Use this brand palette: ${colors.slice(0, 8).join(", ")}.`);
    const fonts = stringArray(brand.fonts);
    if (fonts.length) parts.push(`Lettering direction: ${fonts.slice(0, 3).join(", ")}.`);
    const styleNotes = String(brand.ai_style_notes ?? "").trim();
    if (styleNotes) parts.push(`Brand art direction: ${styleNotes}`);
    const prohibited = stringArray(brand.prohibited_styles);
    if (prohibited.length) parts.push(`Strictly avoid: ${prohibited.slice(0, 12).join(", ")}.`);
  }

  // 5. Pack Creative Direction (style guidance inside the hard constraints).
  if (hasCreativeDirectionContent(cd)) {
    parts.push("Pack creative direction (guides style only; never overrides the identity or text rules above):");
    if (cd!.purpose) parts.push(`Pack purpose: ${cd!.purpose}`);
    if (cd!.audience) parts.push(`Intended audience: ${cd!.audience}`);
    if (cd!.toneKeywords.length) parts.push(`Tone: ${cd!.toneKeywords.join(", ")}.`);
    const humor = HUMOR_TEXT[cd!.humorLevel];
    if (humor) parts.push(humor);
    const intensity = INTENSITY_TEXT[cd!.intensity];
    if (intensity) parts.push(intensity);
    if (cd!.visualDirection) parts.push(`Visual direction: ${cd!.visualDirection}`);
    if (!noText && cd!.textNotes) parts.push(`Caption styling notes (styling only, never changes the exact caption wording): ${cd!.textNotes}`);
    if (cd!.packRules.length) parts.push(`Pack rules (lower priority than the identity and text rules above): ${cd!.packRules.join("; ")}.`);
  }

  // 6. Legacy freeform fields.
  const brief = String(pack.brief ?? "").trim();
  if (brief) parts.push(`Pack brief: ${brief}`);
  const packStyle = String(pack.style_notes ?? "").trim();
  if (packStyle) parts.push(`Pack-specific style direction: ${packStyle}`);

  // 7. Final production constraints.
  parts.push("Square 1:1 composition. Center the subject with generous margin. Use a simple flat solid backdrop only, with no environment, no scene, no background objects, no ground shadow and no gradient backdrop.");
  parts.push("Use crisp edges, a strong silhouette, high contrast and a thick clean outline suitable for automatic background removal.");
  parts.push(
    noText
      ? "No watermark, no signature, no frame, no unrelated logos, no extra characters and no text of any kind."
      : "No watermark, no signature, no frame, no unrelated logos, no extra characters and no extra text beyond the exact caption requested above.",
  );
  return parts.join(" ");
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const KIE_API_KEY = Deno.env.get("KIE_API_KEY") ?? "";
  const MODEL = Deno.env.get("KIE_STICKER_MODEL") || DEFAULT_MODEL;

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

  /**
   * Project Identity Gate A. Runs AFTER the existing membership check and
   * BEFORE any provider request, new provider task or generated-state write.
   * Fails closed; the platform-owner bypass lives inside can_use_project_tools.
   */
  const identityDenial = async (workspaceId: string) => {
    const access = await requireProjectToolAccess(admin, user.id, workspaceId);
    return access.allowed ? null : respond(access.body, access.status);
  };

  const action = String(body.action ?? "");
  if (action === "config") {
    return respond({ configured: Boolean(KIE_API_KEY), model: MODEL, backgroundModel: BG_MODEL });
  }
  if (!KIE_API_KEY) {
    return respond({ error: "KIE_NOT_CONFIGURED", message: "KIE_API_KEY is not configured in Supabase Edge Function secrets." }, 503);
  }

  /**
   * Generation mode of a job.
   *  - "current"   : ordinary generation; owns the current image pointer.
   *  - "candidate" : Phase 4D published review-only image.
   *  - "variation" : A/B/C review-only image.
   * Both review-only modes must never write sticker or pack status, never move
   * the current pointer and never touch Telegram fields.
   */
  type JobMode = "current" | "candidate" | "variation";
  const jobModeOf = (job: Record<string, unknown>): JobMode => {
    const input = (job.input_json && typeof job.input_json === "object" ? job.input_json : {}) as Record<string, unknown>;
    return input.mode === "candidate"
      ? "candidate"
      : input.mode === "variation"
        ? "variation"
        : "current";
  };
  const isReviewOnlyMode = (mode: JobMode) => mode !== "current";
  const variationMetaOf = (job: Record<string, unknown>) => {
    const input = (job.input_json && typeof job.input_json === "object" ? job.input_json : {}) as Record<string, unknown>;
    return {
      groupId: typeof input.variation_group_id === "string" ? input.variation_group_id : null,
      label: typeof input.variation_label === "string" ? input.variation_label : null,
    };
  };

  const failSticker = async (job: Record<string, unknown>, message: string, code = "PROVIDER_FAILED") => {
    await admin.from("ai_jobs").update({
      status: "failed", error_code: code, error_message: message.slice(0, 500), completed_at: new Date().toISOString(),
    }).eq("id", String(job.id));
    const mode = jobModeOf(job);
    const reviewOnly = isReviewOnlyMode(mode);
    if (job.sticker_id && !reviewOnly) {
      const input = (job.input_json && typeof job.input_json === "object" ? job.input_json : {}) as Record<string, unknown>;
      const prior = typeof input.prior_image_asset_id === "string" ? input.prior_image_asset_id : null;
      await admin.from("stickers").update({ status: prior ? "ready" : "failed" }).eq("id", String(job.sticker_id));
    }
    const meta = mode === "variation" ? variationMetaOf(job) : null;
    return respond({
      aiJobId: job.id, jobType: job.job_type, status: "failed", error: message,
      ...(reviewOnly ? { mode } : {}),
      ...(meta ? { variationGroupId: meta.groupId, variationLabel: meta.label } : {}),
    });
  };


  // Cost Accounting Phase 1: the shared writer owns dedupe via the DB unique
  // index on usage_ledger.idempotency_key. Never throws into the job path.
  const logCredits = async (job: Record<string, unknown>, credits: number | null) => {
    await recordProviderCreditUsage(admin, {
      workspaceId: String(job.workspace_id ?? ""),
      userId: job.user_id == null ? null : String(job.user_id),
      aiJobId: String(job.id),
      actionType: String(job.job_type),
      credits,
      provider: typeof job.provider === "string" && job.provider ? job.provider : "kie",
      providerModel: typeof job.provider_model === "string" ? job.provider_model : null,
      providerTaskId: typeof job.provider_task_id === "string" ? job.provider_task_id : null,
      jobType: typeof job.job_type === "string" ? job.job_type : null,
    });
  };

  try {
    if (action === "start" || action === "start_candidate" || action === "start_variation") {
      // Phase 4D.1 / A-B-C Variations — the review-only actions share the ENTIRE
      // generation setup below (prompt compiler, Brand Kit, Character Lock,
      // Creative Direction, reference precedence, model, 1:1 request,
      // background-removal child). Only the entry guard, the status writes and
      // the finalization differ.
      const requestMode: JobMode =
        action === "start_candidate"
          ? "candidate"
          : action === "start_variation"
            ? "variation"
            : "current";
      const isCandidate = requestMode === "candidate";
      const isVariation = requestMode === "variation";
      const reviewOnly = isReviewOnlyMode(requestMode);
      const workspaceId = String(body.workspaceId ?? "");
      const packId = String(body.packId ?? "");
      const stickerId = String(body.stickerId ?? "");
      if (!workspaceId || !packId || !stickerId) return respond({ error: "INVALID_INPUT" }, 400);
      // Variation identity is validated before any lookup, job row or Kie call.
      const variationGroupId = isVariation ? String(body.variationGroupId ?? "") : null;
      const rawLabel = isVariation ? String(body.variationLabel ?? "").trim().toUpperCase() : "";
      const variationLabel = isVariation ? (rawLabel as "A" | "B" | "C") : null;
      if (isVariation) {
        const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!variationGroupId || !uuidShape.test(variationGroupId)) {
          return respond({ error: "INVALID_VARIATION_GROUP", message: "The variation group id is not valid." }, 400);
        }
        if (!["A", "B", "C"].includes(rawLabel)) {
          return respond({ error: "INVALID_VARIATION_LABEL", message: "Variation label must be A, B or C." }, 400);
        }
      }
      if (!(await isMember(workspaceId))) return respond({ error: "FORBIDDEN" }, 403);
      const identityBlocked = await identityDenial(workspaceId);
      if (identityBlocked) return identityBlocked;

      const { data: pack } = await admin.from("sticker_packs").select("*").eq("id", packId).eq("workspace_id", workspaceId).maybeSingle();
      if (!pack) return respond({ error: "PACK_NOT_FOUND" }, 404);
      const { data: sticker } = await admin.from("stickers").select("*").eq("id", stickerId).eq("pack_id", packId).maybeSingle();
      if (!sticker) return respond({ error: "STICKER_NOT_FOUND" }, 404);

      // Phase 4C — published mutation safety. A sticker with ANY Telegram
      // footprint must never start a billable regeneration. This runs BEFORE
      // any reference resolution, signed URL, job lookup/insert or Kie call,
      // so nothing is written and nothing is charged on this path. Status is
      // deliberately not used: generation overwrites it.
      const hasTelegramFootprint =
        (sticker as Record<string, unknown>).telegram_file_id != null ||
        (sticker as Record<string, unknown>).telegram_published_at != null;
      if (requestMode === "current" && hasTelegramFootprint) {
        return respond({
          error: "STICKER_PUBLISHED",
          message: "This sticker is already connected to Telegram. Regeneration is blocked to keep the live Telegram set synchronized with CARTEL HQ.",
        }, 409);
      }
      // Phase 4D.1 — the mirror guard. Candidate generation exists only for
      // stickers that are already connected to Telegram; everything else uses
      // the ordinary Regenerate path. Also runs before any billable work.
      if (isCandidate && !hasTelegramFootprint) {
        return respond({
          error: "CANDIDATE_REQUIRES_PUBLISHED",
          message: "This sticker is not connected to Telegram, so use the ordinary Regenerate action instead. No provider task was started.",
        }, 409);
      }
      // A/B/C variations are alternates OF an existing current image. Published
      // or unpublished is irrelevant, but there must be something to vary from.
      // Fails before any provider task or job row, so nothing is charged.
      if (isVariation && (sticker as Record<string, unknown>).image_asset_id == null) {
        return respond({
          error: "VARIATION_REQUIRES_CURRENT",
          message: "Generate this sticker first. A/B/C variations are alternates of an existing sticker image. No provider task was started.",
        }, 409);
      }



      const blueprint = parseBlueprint((pack as Record<string, unknown>).creative_blueprint);
      const characterLockApplied =
        blueprint.useBrandCharacterLock === true && blueprint.characterLock !== null;
      const creativeDirectionApplied = hasCreativeDirectionContent(blueprint.creativeDirection);

      let refs: Array<{ id: string; storage_path: string; asset_type: string }> = [];
      let referenceSource: "explicit" | "character_lock" | "pack_reference" | "workspace_auto" =
        "workspace_auto";
      const explicit = stringArray(body.referenceAssetIds).slice(0, 3);
      if (explicit.length) {
        const { data } = await admin.from("media_assets").select("id,storage_path,asset_type").eq("workspace_id", workspaceId).in("id", explicit);
        refs = data ?? [];
        if (refs.length) {
          refs = explicit
            .map((id) => refs.find((r) => r.id === id))
            .filter((r): r is { id: string; storage_path: string; asset_type: string } => Boolean(r));
          referenceSource = "explicit";
        }
      }
      // Character Lock canonical references are a FALLBACK only — they never
      // override explicit user-selected references.
      if (!refs.length && blueprint.useBrandCharacterLock === true) {
        const canonical = (blueprint.characterLock?.canonicalReferenceAssetIds ?? []).slice(0, 3);
        if (canonical.length) {
          const { data } = await admin.from("media_assets").select("id,storage_path,asset_type").eq("workspace_id", workspaceId).in("id", canonical).in("asset_type", ["mascot", "reference_image", "logo"]);
          const found = data ?? [];
          const ordered = canonical
            .map((id) => found.find((r) => r.id === id))
            .filter((r): r is { id: string; storage_path: string; asset_type: string } => Boolean(r));
          if (ordered.length) {
            refs = ordered;
            referenceSource = "character_lock";
          }
        }
      }
      if (!refs.length && pack.reference_asset_id) {
        const { data } = await admin.from("media_assets").select("id,storage_path,asset_type").eq("workspace_id", workspaceId).eq("id", pack.reference_asset_id).maybeSingle();
        if (data) {
          refs = [data];
          referenceSource = "pack_reference";
        }
      }
      if (!refs.length) {
        const { data } = await admin.from("media_assets").select("id,storage_path,asset_type,created_at").eq("workspace_id", workspaceId).in("asset_type", ["mascot", "reference_image", "logo"]).order("created_at", { ascending: false });
        const priority = ["mascot", "reference_image", "logo"];
        const candidate = (data ?? []).sort((a, b) => priority.indexOf(a.asset_type) - priority.indexOf(b.asset_type))[0];
        if (candidate) {
          refs = [candidate];
          referenceSource = "workspace_auto";
        }
      }
      if (!refs.length) return respond({ error: "NO_REFERENCE", message: "Upload or select a mascot/reference image before generating." }, 400);

      const signedUrls: string[] = [];
      for (const ref of refs) {
        const { data } = await admin.storage.from(BUCKET).createSignedUrl(ref.storage_path, SIGNED_URL_TTL);
        if (data?.signedUrl) signedUrls.push(data.signedUrl);
      }
      if (!signedUrls.length) return respond({ error: "REFERENCE_UNAVAILABLE" }, 400);

      const { data: brand } = await admin.from("brand_kits").select("*").eq("workspace_id", workspaceId).maybeSingle();
      const prompt = buildPrompt(brand, pack, sticker, blueprint, variationLabel);
      const priorAssetId = sticker.image_asset_id ?? null;

      // Duplicate-spend protection. Active work for this sticker is authoritative:
      // return it instead of billing a second provider task. This covers BOTH
      // phases of the pipeline — the parent `sticker_generate` job AND the
      // `remove_background` child that continues after the parent succeeds —
      // and runs before any new ai_jobs insert and before any Kie createTask.
      // The DB partial unique index on active `sticker_generate` per sticker
      // remains the guarantee for the simultaneous initial-start race.
      const findActiveJob = async (jobType: "sticker_generate" | "remove_background") => {
        const { data } = await admin.from("ai_jobs")
          .select("id,status,input_json")
          .eq("sticker_id", stickerId)
          .eq("job_type", jobType)
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data ?? null;
      };
      const findActiveGeneration = () => findActiveJob("sticker_generate");
      const MODE_NOUN: Record<JobMode, string> = {
        current: "a regeneration",
        candidate: "a candidate image",
        variation: "an A/B/C variation",
      };
      const crossModeConflict = (activeMode: JobMode) =>
        respond({
          error: "ACTIVE_JOB_CONFLICT",
          message: `This sticker is already running ${MODE_NOUN[activeMode]}. Wait for it to finish before starting another task.`,
        }, 409);
      const modeExtras = () =>
        reviewOnly
          ? { mode: requestMode, ...(isVariation ? { variationGroupId, variationLabel } : {}) }
          : {};
      /**
       * Variations must additionally match group AND label, so A/B/C can never
       * silently reuse each other's in-flight pipeline. Anything else fails closed.
       */
      const sameVariationIdentity = (job: Record<string, unknown>) => {
        const meta = variationMetaOf(job);
        return meta.groupId === variationGroupId && meta.label === variationLabel;
      };
      /** Reuse only a same-mode active parent job; a different mode fails closed. */
      const resolveActive = (active: { id: string; status: string; input_json: unknown } | null) => {
        if (!active) return null;
        const activeMode = jobModeOf(active as unknown as Record<string, unknown>);
        if (activeMode !== requestMode) return crossModeConflict(activeMode);
        if (isVariation && !sameVariationIdentity(active as unknown as Record<string, unknown>)) {
          return crossModeConflict(activeMode);
        }
        return respond({ aiJobId: active.id, status: active.status === "queued" ? "queued" : "running", model: MODEL, ...modeExtras() });
      };
      /**
       * Background phase: the parent already succeeded, so the unique active
       * `sticker_generate` index no longer blocks a second start. Callers must
       * still be sent back to the in-flight pipeline, never to a new paid task.
       */
      const resolveActiveBackground = async () => {
        const child = await findActiveJob("remove_background");
        if (!child) return null;
        const childMode = jobModeOf(child as unknown as Record<string, unknown>);
        if (childMode !== requestMode) return crossModeConflict(childMode);
        if (isVariation && !sameVariationIdentity(child as unknown as Record<string, unknown>)) {
          return crossModeConflict(childMode);
        }
        const childInput = (child.input_json && typeof child.input_json === "object" ? child.input_json : {}) as Record<string, unknown>;
        // R1.1 — a background-only RETRY child stores the FAILED background row
        // id in `parent_job_id` as an idempotency-chain key. It is NOT a
        // generation job id, so it must never be handed back as one.
        if (typeof childInput.retry_of_background_job_id === "string") {
          return respond({
            error: "BACKGROUND_RETRY_ACTIVE",
            message: "A background-only retry is still running for this sticker. Wait for it to finish before starting new work.",
          }, 409);
        }
        const parentJobId = typeof childInput.parent_job_id === "string" ? childInput.parent_job_id : null;
        if (parentJobId) {
          const { data: parent } = await admin.from("ai_jobs").select("id").eq("id", parentJobId).maybeSingle();
          // Existing polling semantics are parent-driven; hand back the parent id.
          if (parent) return respond({ aiJobId: parent.id, status: "running", model: MODEL, ...modeExtras() });
        }
        // Fail closed rather than returning a child id as if it were a parent.
        return respond({
          error: "GENERATION_ALREADY_ACTIVE",
          message: "This sticker is still finishing an earlier generation. Wait for it to complete before starting another.",
        }, 409);
      };
      const activeExisting = await findActiveGeneration();
      const activeResponse = resolveActive(activeExisting);
      if (activeResponse) return activeResponse;
      const activeBackgroundResponse = await resolveActiveBackground();
      if (activeBackgroundResponse) return activeBackgroundResponse;

      // Variation idempotency: a finished A/B/C slot is never re-generated, so a
      // repeated request can never double-charge for the same take.
      if (isVariation) {
        const { data: existingVersion } = await admin.from("sticker_versions")
          .select("id")
          .eq("sticker_id", stickerId)
          .eq("variation_group_id", variationGroupId)
          .eq("variation_label", variationLabel)
          .maybeSingle();
        if (existingVersion) {
          return respond({
            status: "succeeded", model: MODEL, versionId: existingVersion.id,
            mode: "variation", variationGroupId, variationLabel,
          });
        }
      }

      const { data: job, error: jobError } = await admin.from("ai_jobs").insert({
        workspace_id: workspaceId, user_id: user.id, pack_id: packId, sticker_id: stickerId,
        job_type: "sticker_generate", provider: "kie", provider_model: MODEL, status: "queued",
        input_json: {
          model: MODEL, prompt, reference_asset_ids: refs.map((r) => r.id), prior_image_asset_id: priorAssetId,
          prompt_compiler_version: "v2",
          reference_source: referenceSource,
          character_lock_applied: characterLockApplied,
          creative_direction_applied: creativeDirectionApplied,
          ...(reviewOnly ? { mode: requestMode } : {}),
          ...(isVariation ? { variation_group_id: variationGroupId, variation_label: variationLabel } : {}),
        },
      }).select("*").single();
      if (jobError || !job) {
        // Race: another request won the unique active-generation guard.
        if ((jobError as { code?: string } | null)?.code === "23505") {
          const racedResponse = resolveActive(await findActiveGeneration());
          if (racedResponse) return racedResponse;
        }
        return respond({ error: "JOB_CREATE_FAILED" }, 500);
      }


      const create = await kieRequest("/api/v1/jobs/createTask", KIE_API_KEY, {
        method: "POST",
        body: JSON.stringify({ model: MODEL, input: { input_urls: signedUrls, prompt, aspect_ratio: "1:1", resolution: "1K", nsfw_checker: true } }),
      });
      const taskId = create.ok ? String(create.data.taskId ?? create.data.task_id ?? "") : "";
      if (!create.ok || !taskId) return await failSticker(job, create.ok ? "Kie.ai returned no task ID." : create.message, "PROVIDER_START_FAILED");

      await admin.from("ai_jobs").update({ status: "running", provider_task_id: taskId }).eq("id", job.id);
      // Review-only generation leaves the live sticker and its pack completely alone.
      if (!reviewOnly) {
        await admin.from("stickers").update({ status: "generating" }).eq("id", stickerId);
        await admin.from("sticker_packs").update({ status: "generating" }).eq("id", packId);
      }
      return respond({ aiJobId: job.id, status: "running", model: MODEL, ...modeExtras() });

    }

    /**
     * Recovery Phase R1 — REVIEW-ONLY background-removal retry.
     *
     * Reuses an already-successful `sticker_generate` provider result and
     * starts EXACTLY ONE new background-removal task. It never starts image
     * generation, never touches the sticker, pack, current pointer or Telegram,
     * and is only reachable for `variation` / `candidate` review-only work.
     */
    if (action === "retry_review_background") {
      const workspaceId = String(body.workspaceId ?? "");
      const backgroundJobId = String(body.backgroundJobId ?? "");
      if (!workspaceId || !backgroundJobId) return respond({ error: "INVALID_INPUT" }, 400);
      if (!(await isMember(workspaceId))) return respond({ error: "FORBIDDEN" }, 403);
      const retryIdentityBlocked = await identityDenial(workspaceId);
      if (retryIdentityBlocked) return retryIdentityBlocked;

      const { data: failedJob } = await admin.from("ai_jobs").select("*").eq("id", backgroundJobId).maybeSingle();
      if (!failedJob) return respond({ error: "JOB_NOT_FOUND" }, 404);
      if (String(failedJob.workspace_id) !== workspaceId) return respond({ error: "FORBIDDEN" }, 403);
      if (failedJob.job_type !== "remove_background") {
        return respond({ error: "NOT_A_BACKGROUND_JOB", message: "This retry only applies to a failed background-removal step." }, 409);
      }
      if (failedJob.status !== "failed") {
        return respond({ error: "JOB_NOT_FAILED", message: "This background-removal step is not in a failed state." }, 409);
      }
      const failedMode = jobModeOf(failedJob as Record<string, unknown>);
      if (!isReviewOnlyMode(failedMode)) {
        return respond({ error: "NOT_REVIEW_ONLY", message: "Only review-only candidate or A/B/C variation work can be retried this way." }, 409);
      }
      const retryIsVariation = failedMode === "variation";
      const retryMeta = variationMetaOf(failedJob as Record<string, unknown>);
      if (retryIsVariation && (!retryMeta.groupId || !retryMeta.label)) {
        return respond({ error: "VARIATION_METADATA_MISSING", message: "This variation take is missing its identity and cannot be retried." }, 409);
      }
      const failedStickerId = failedJob.sticker_id ? String(failedJob.sticker_id) : "";
      const failedPackId = failedJob.pack_id ? String(failedJob.pack_id) : "";
      if (!failedStickerId || !failedPackId) {
        return respond({ error: "JOB_INCOMPLETE", message: "This background-removal step is missing its sticker or pack reference." }, 409);
      }

      const failedInput = (failedJob.input_json && typeof failedJob.input_json === "object" ? failedJob.input_json : {}) as Record<string, unknown>;
      const sourceGenerationJobId =
        typeof failedInput.source_generation_job_id === "string"
          ? failedInput.source_generation_job_id
          : typeof failedInput.parent_job_id === "string"
            ? failedInput.parent_job_id
            : null;
      if (!sourceGenerationJobId) {
        return respond({ error: "SOURCE_GENERATION_MISSING", message: "The original image generation for this take could not be identified. A new full generation would be required." }, 409);
      }
      const { data: sourceJob } = await admin.from("ai_jobs").select("*").eq("id", sourceGenerationJobId).maybeSingle();
      if (
        !sourceJob ||
        sourceJob.job_type !== "sticker_generate" ||
        sourceJob.status !== "succeeded" ||
        String(sourceJob.workspace_id) !== workspaceId ||
        String(sourceJob.pack_id ?? "") !== failedPackId ||
        String(sourceJob.sticker_id ?? "") !== failedStickerId ||
        jobModeOf(sourceJob as Record<string, unknown>) !== failedMode
      ) {
        return respond({ error: "SOURCE_GENERATION_INVALID", message: "The original image generation for this take is no longer usable. A new full generation would be required." }, 409);
      }
      if (retryIsVariation) {
        const sourceMeta = variationMetaOf(sourceJob as Record<string, unknown>);
        if (sourceMeta.groupId !== retryMeta.groupId || sourceMeta.label !== retryMeta.label) {
          return respond({ error: "SOURCE_GENERATION_INVALID", message: "The original image generation does not match this variation take." }, 409);
        }
      }
      if (!sourceJob.provider_task_id) {
        return respond({ error: "SOURCE_GENERATION_INVALID", message: "The original image generation has no provider record. A new full generation would be required." }, 409);
      }

      // No overlapping generation or background work for this sticker.
      const { data: activeJobs } = await admin.from("ai_jobs")
        .select("id,job_type,status")
        .eq("sticker_id", failedStickerId)
        .in("job_type", ["sticker_generate", "remove_background"])
        .in("status", ["queued", "running"])
        .limit(1);
      if ((activeJobs ?? []).length > 0) {
        return respond({ error: "ACTIVE_JOB_CONFLICT", message: "This sticker is already running a generation task. Wait for it to finish before retrying." }, 409);
      }

      // Retrieval only — never a createTask for image generation.
      const sourceQuery = await kieRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(String(sourceJob.provider_task_id))}`, KIE_API_KEY, { method: "GET" });
      if (!sourceQuery.ok) {
        return respond({ error: "SOURCE_RESULT_UNAVAILABLE", message: "The original generated image could not be retrieved from the provider. A new full generation would be required. No task was started." }, 409);
      }
      if (mapKieState(sourceQuery.data.state ?? sourceQuery.data.status) !== "success") {
        return respond({ error: "SOURCE_RESULT_UNAVAILABLE", message: "The original generated image is no longer reported as successful. A new full generation would be required. No task was started." }, 409);
      }
      const sourceResultUrl = resultUrlFrom(sourceQuery.data);
      if (!sourceResultUrl) {
        return respond({ error: "SOURCE_RESULT_UNAVAILABLE", message: "The original generated image is no longer available from the provider. A new full generation would be required. No task was started." }, 409);
      }

      const retryPriorAssetId =
        typeof failedInput.prior_image_asset_id === "string" ? failedInput.prior_image_asset_id : null;
      const { data: retryChild, error: retryChildError } = await admin.from("ai_jobs").insert({
        workspace_id: workspaceId, user_id: user.id, pack_id: failedPackId, sticker_id: failedStickerId,
        job_type: "remove_background", provider: "kie", provider_model: BG_MODEL, status: "queued",
        input_json: {
          // R1.1 — the DATABASE is the final duplicate-spend authority. For a
          // retry child, `parent_job_id` is an IDEMPOTENCY-CHAIN key pointing at
          // the FAILED background row, not at the generation row. The original
          // child already used `parent_job_id = sourceGenerationJobId`, so this
          // value is new and the existing unique index admits exactly ONE retry
          // per failed background job. True lineage stays in
          // `source_generation_job_id`, which finalization prefers.
          parent_job_id: backgroundJobId,
          source_generation_job_id: sourceGenerationJobId,
          retry_of_background_job_id: backgroundJobId,
          prior_image_asset_id: retryPriorAssetId,
          model: BG_MODEL,
          mode: failedMode,
          ...(retryIsVariation ? { variation_group_id: retryMeta.groupId, variation_label: retryMeta.label } : {}),
        },
      }).select("*").single();
      if (retryChildError || !retryChild) {
        // 23505: another concurrent confirmation already created THE retry child.
        // This branch must NEVER reach createTask.
        if (retryChildError && String((retryChildError as { code?: string }).code ?? "") === "23505") {
          const { data: winner } = await admin.from("ai_jobs")
            .select("*")
            .eq("job_type", "remove_background")
            .eq("sticker_id", failedStickerId)
            .contains("input_json", { parent_job_id: backgroundJobId })
            .maybeSingle();
          const winnerInput = (winner?.input_json && typeof winner.input_json === "object" ? winner.input_json : {}) as Record<string, unknown>;
          const winnerMeta = winner ? variationMetaOf(winner as unknown as Record<string, unknown>) : { groupId: null, label: null };
          const sameLineage =
            !!winner &&
            String(winner.workspace_id) === workspaceId &&
            String(winner.pack_id ?? "") === failedPackId &&
            String(winner.sticker_id ?? "") === failedStickerId &&
            jobModeOf(winner as unknown as Record<string, unknown>) === failedMode &&
            winnerInput.source_generation_job_id === sourceGenerationJobId &&
            winnerInput.retry_of_background_job_id === backgroundJobId &&
            (!retryIsVariation ||
              (winnerMeta.groupId === retryMeta.groupId && winnerMeta.label === retryMeta.label));
          if (!sameLineage) {
            // Fail closed: an unexplained conflicting row must never authorise spend.
            return respond({
              error: "RETRY_CONFLICT",
              message: "Another background-removal retry already exists for this take and could not be verified. No task was started.",
            }, 409);
          }
          // Distributed-failure safety: a queued/running winner without a
          // provider task is NOT re-submitted here. Returned as-is.
          return respond({
            aiJobId: winner.id,
            status: winner.status === "succeeded" ? "succeeded" : winner.status === "failed" ? "failed" : winner.status === "queued" ? "queued" : "running",
            model: BG_MODEL,
            mode: failedMode,
            retryKind: "background_only",
            ...(winner.status === "failed" && winner.error_message ? { error: String(winner.error_message) } : {}),
            ...(retryIsVariation ? { variationGroupId: retryMeta.groupId, variationLabel: retryMeta.label } : {}),
          });
        }
        return respond({ error: "JOB_CREATE_FAILED" }, 500);
      }


      const retryCreate = await kieRequest("/api/v1/jobs/createTask", KIE_API_KEY, {
        method: "POST",
        body: JSON.stringify({ model: BG_MODEL, input: { image: sourceResultUrl, nsfw_checker: true } }),
      });
      const retryTaskId = retryCreate.ok ? String(retryCreate.data.taskId ?? retryCreate.data.task_id ?? "") : "";
      if (!retryCreate.ok || !retryTaskId) {
        // Only the new retry child is marked failed. Nothing else is touched.
        await admin.from("ai_jobs").update({
          status: "failed", error_code: "BACKGROUND_START_FAILED",
          error_message: (retryCreate.ok ? "Kie.ai returned no background-removal task ID." : retryCreate.message).slice(0, 500),
          completed_at: new Date().toISOString(),
        }).eq("id", retryChild.id);
        return respond({
          aiJobId: retryChild.id, status: "failed", model: BG_MODEL, mode: failedMode,
          retryKind: "background_only",
          error: retryCreate.ok ? "Kie.ai returned no background-removal task ID." : retryCreate.message,
          ...(retryIsVariation ? { variationGroupId: retryMeta.groupId, variationLabel: retryMeta.label } : {}),
        });
      }
      await admin.from("ai_jobs").update({ status: "running", provider_task_id: retryTaskId }).eq("id", retryChild.id);
      return respond({
        aiJobId: retryChild.id, status: "running", model: BG_MODEL, mode: failedMode,
        retryKind: "background_only",
        ...(retryIsVariation ? { variationGroupId: retryMeta.groupId, variationLabel: retryMeta.label } : {}),
      });
    }

    if (action === "sync") {
      const aiJobId = String(body.aiJobId ?? "");
      if (!aiJobId) return respond({ error: "INVALID_INPUT" }, 400);
      const { data: job } = await admin.from("ai_jobs").select("*").eq("id", aiJobId).maybeSingle();
      if (!job) return respond({ error: "JOB_NOT_FOUND" }, 404);
      if (!(await isMember(job.workspace_id))) return respond({ error: "FORBIDDEN" }, 403);
      // `sync` polls the provider and can spawn the background-removal child
      // task, so it is provider-spending work and is gated like a start.
      const syncIdentityBlocked = await identityDenial(String(job.workspace_id));
      if (syncIdentityBlocked) return syncIdentityBlocked;

      const jobMode = jobModeOf(job as Record<string, unknown>);
      const jobIsCandidate = jobMode === "candidate";
      const jobIsVariation = jobMode === "variation";
      const jobIsReviewOnly = isReviewOnlyMode(jobMode);
      const jobVariationMeta = variationMetaOf(job as Record<string, unknown>);
      const jobModeExtras = jobIsReviewOnly
        ? {
            mode: jobMode,
            ...(jobIsVariation
              ? { variationGroupId: jobVariationMeta.groupId, variationLabel: jobVariationMeta.label }
              : {}),
          }
        : {};
      if (job.status === "failed") return respond({ aiJobId: job.id, jobType: job.job_type, status: "failed", error: job.error_message, ...jobModeExtras });
      if (job.status === "succeeded") {
        const output = (job.output_json ?? {}) as Record<string, unknown>;
        return respond({ aiJobId: job.id, jobType: job.job_type, status: "succeeded", childJobId: output.child_job_id ?? null, assetId: output.asset_id ?? null, transparencyValid: output.transparency_valid ?? null, versionId: output.version_id ?? null, ...jobModeExtras });
      }

      if (!job.provider_task_id) return respond({ aiJobId: job.id, jobType: job.job_type, status: job.status });

      const query = await kieRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(job.provider_task_id)}`, KIE_API_KEY, { method: "GET" });
      if (!query.ok) return respond({ aiJobId: job.id, jobType: job.job_type, status: "running", providerMessage: query.message });

      const data = query.data;
      const state = mapKieState(data.state ?? data.status);
      if (state === "running") {
        if (job.status !== "running") await admin.from("ai_jobs").update({ status: "running" }).eq("id", job.id);
        return respond({ aiJobId: job.id, jobType: job.job_type, status: "running" });
      }
      if (state === "fail") {
        const failMessage = typeof data.failMsg === "string" && data.failMsg ? data.failMsg : "Kie.ai could not complete this task.";
        return await failSticker(job, failMessage);
      }

      const resultUrl = resultUrlFrom(data);
      if (!resultUrl) return await failSticker(job, "Kie.ai returned no usable image URL.");
      const credits = creditsFrom(data);

      if (job.job_type === "sticker_generate") {
        const existingOutput = (job.output_json ?? {}) as Record<string, unknown>;
        let childJobId = typeof existingOutput.child_job_id === "string" ? existingOutput.child_job_id : null;
        if (!childJobId) {
          const { data: existingChild } = await admin.from("ai_jobs").select("id").eq("job_type", "remove_background").eq("sticker_id", job.sticker_id).contains("input_json", { parent_job_id: job.id }).maybeSingle();
          childJobId = existingChild?.id ?? null;
        }
        if (!childJobId) {
          const priorAssetId = job.input_json && typeof job.input_json === "object" ? (job.input_json as Record<string, unknown>).prior_image_asset_id ?? null : null;
          const { data: child, error: childError } = await admin.from("ai_jobs").insert({
            workspace_id: job.workspace_id, user_id: job.user_id, pack_id: job.pack_id, sticker_id: job.sticker_id,
            job_type: "remove_background", provider: "kie", provider_model: BG_MODEL, status: "queued",
            input_json: {
              parent_job_id: job.id, prior_image_asset_id: priorAssetId, model: BG_MODEL,
              ...(jobIsReviewOnly ? { mode: jobMode } : {}),
              ...(jobIsVariation ? { variation_group_id: jobVariationMeta.groupId, variation_label: jobVariationMeta.label } : {}),
            },
          }).select("*").single();
          if (childError || !child) {
            // Race: a concurrent poller already created the child. Reuse it and
            // never start a second background provider task.
            if ((childError as { code?: string } | null)?.code === "23505") {
              const { data: racedChild } = await admin.from("ai_jobs").select("id").eq("job_type", "remove_background").eq("sticker_id", job.sticker_id).contains("input_json", { parent_job_id: job.id }).maybeSingle();
              if (racedChild) {
                await admin.from("ai_jobs").update({ status: "succeeded", completed_at: new Date().toISOString(), output_json: { generation_result_received: true, child_job_id: racedChild.id } }).eq("id", job.id);
                await logCredits(job, credits);
                return respond({ aiJobId: job.id, jobType: job.job_type, status: "succeeded", childJobId: racedChild.id, stage: "background_removal" });
              }
            }
            return await failSticker(job, "Could not create the background-removal job.");
          }
          childJobId = child.id;


          const bgCreate = await kieRequest("/api/v1/jobs/createTask", KIE_API_KEY, {
            method: "POST",
            body: JSON.stringify({ model: BG_MODEL, input: { image: resultUrl, nsfw_checker: true } }),
          });
          const bgTaskId = bgCreate.ok ? String(bgCreate.data.taskId ?? bgCreate.data.task_id ?? "") : "";
          if (!bgCreate.ok || !bgTaskId) {
            await admin.from("ai_jobs").update({ status: "failed", error_code: "BACKGROUND_START_FAILED", error_message: bgCreate.ok ? "Kie.ai returned no background-removal task ID." : bgCreate.message, completed_at: new Date().toISOString() }).eq("id", childJobId);
            // A failed review-only take must never demote the live sticker.
            if (!jobIsReviewOnly) {
              const prior = typeof priorAssetId === "string" ? priorAssetId : null;
              await admin.from("stickers").update({ status: prior ? "ready" : "failed" }).eq("id", job.sticker_id);
            }

          } else {
            await admin.from("ai_jobs").update({ status: "running", provider_task_id: bgTaskId }).eq("id", childJobId);
          }
        }

        await admin.from("ai_jobs").update({ status: "succeeded", completed_at: new Date().toISOString(), output_json: { generation_result_received: true, child_job_id: childJobId } }).eq("id", job.id);
        await logCredits(job, credits);
        return respond({ aiJobId: job.id, jobType: job.job_type, status: "succeeded", childJobId, stage: "background_removal" });
      }

      if (job.job_type === "remove_background") {
        let sourceBytes: Uint8Array;
        try {
          const imageResponse = await fetch(resultUrl);
          if (!imageResponse.ok) throw new Error("download failed");
          sourceBytes = new Uint8Array(await imageResponse.arrayBuffer());
        } catch {
          return await failSticker(job, "Could not download the background-removed image.", "IMAGE_DOWNLOAD_FAILED");
        }

        let width = 0;
        let height = 0;
        let transparent = false;
        let finalPng: Uint8Array | null = null;
        try {
          ImageMagick.read(sourceBytes, (img) => {
            width = img.width;
            height = img.height;
            transparent = img.hasAlpha === true && img.isOpaque === false;
            if (transparent) img.write(MagickFormat.Png, (bytes) => { finalPng = Uint8Array.from(bytes); });
          });
        } catch {
          return await failSticker(job, "The processed image could not be decoded for transparency validation.", "TRANSPARENCY_DECODE_FAILED");
        }
        if (!transparent || !finalPng) return await failSticker(job, "Transparency validation failed: the processed image does not contain real transparent pixels.", "TRANSPARENCY_FAILED");

        // Review-only finalization (candidate and A/B/C variation) must be
        // idempotent across concurrent pollers, so its object path is DERIVED
        // from the background job id. A retry then collides on the unique
        // storage path / unique media_assets row instead of creating a second
        // logical image. Ordinary generation keeps its existing random path and
        // behaviour untouched.
        const path = jobIsReviewOnly
          ? `${job.workspace_id}/generated_sticker/${jobIsVariation ? "variation" : "candidate"}-${job.id}.png`
          : `${job.workspace_id}/generated_sticker/${crypto.randomUUID()}.png`;
        const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, finalPng, { contentType: "image/png", upsert: false });

        // A losing review-only poller reuses the asset the winner already recorded.
        let assetId: string | null = null;
        const findReviewAsset = async () => {
          const { data } = await admin.from("media_assets").select("id").eq("workspace_id", job.workspace_id).eq("storage_path", path).maybeSingle();
          return data?.id ?? null;
        };
        if (uploadError) {
          // Ordinary generation is unchanged: any upload failure is terminal.
          if (!jobIsReviewOnly) return await failSticker(job, "Could not save the finished sticker image.", "STORAGE_UPLOAD_FAILED");
          // Review-only: an upload error is only survivable when the deterministic
          // object is PROVEN to already exist (idempotent retry). A network or
          // service error must never produce a media/version row for an object
          // that was never stored, so this fails closed unless proven.
          assetId = await findReviewAsset();
          if (!assetId) {
            const slash = path.lastIndexOf("/");
            const dir = path.slice(0, slash);
            const name = path.slice(slash + 1);
            const { data: listed } = await admin.storage.from(BUCKET).list(dir, { search: name, limit: 100 });
            const objectExists = (listed ?? []).some((entry) => entry.name === name);
            if (!objectExists) {
              return await failSticker(job, "Could not save the finished sticker image.", "STORAGE_UPLOAD_FAILED");
            }
          }
        } else if (jobIsReviewOnly) {
          assetId = await findReviewAsset();
        }

        // R1 — a background-removal RETRY child records its source generation
        // under `source_generation_job_id` (the indexed `parent_job_id` key is
        // reserved for the original child). Prefer the new key, then the old.
        const bgInput = (job.input_json && typeof job.input_json === "object" ? job.input_json : {}) as Record<string, unknown>;
        const parentJobId =
          typeof bgInput.source_generation_job_id === "string"
            ? bgInput.source_generation_job_id
            : (bgInput.parent_job_id ?? null);
        let parentTaskId: string | null = null;
        let parentModel: string | null = null;
        if (typeof parentJobId === "string") {
          const { data: parent } = await admin.from("ai_jobs").select("provider_task_id,provider_model").eq("id", parentJobId).maybeSingle();
          parentTaskId = parent?.provider_task_id ?? null;
          parentModel = parent?.provider_model ?? null;
        }

        if (!assetId) {
          const { data: asset, error: assetError } = await admin.from("media_assets").insert({
            workspace_id: job.workspace_id, uploaded_by: job.user_id, storage_path: path, asset_type: "generated_sticker",
            mime_type: "image/png", width, height, file_size_bytes: finalPng.byteLength, transparency_valid: true,
            metadata: { source: "kie", generation_model: parentModel, generation_task_id: parentTaskId, background_model: job.provider_model, background_task_id: job.provider_task_id, generation_job_id: parentJobId, background_job_id: job.id, ...(jobIsCandidate ? { candidate: true } : {}), ...(jobIsVariation ? { variation: true, variation_group_id: jobVariationMeta.groupId, variation_label: jobVariationMeta.label } : {}) },
          }).select("id").single();
          if (assetError || !asset) {
            if (jobIsReviewOnly) {
              // Recover a concurrently inserted review-only asset before failing.
              const { data: racedAsset } = await admin.from("media_assets").select("id").eq("workspace_id", job.workspace_id).eq("storage_path", path).maybeSingle();
              assetId = racedAsset?.id ?? null;
            }
            if (!assetId) {
              if (!jobIsReviewOnly) await admin.storage.from(BUCKET).remove([path]);
              return await failSticker(job, "Could not record the finished sticker asset.", "ASSET_RECORD_FAILED");
            }
          } else {
            assetId = asset.id;
          }
        }

        if (jobIsReviewOnly) {
          // Durable review-only record ONLY. The current pointer, sticker status,
          // Telegram fields and pack status are deliberately never written here.
          const versionOrigin = jobIsVariation ? "variation_generation" : "candidate_generation";
          let versionId: string | null = null;
          const readVersion = async () => {
            const { data } = await admin.from("sticker_versions").select("id").eq("sticker_id", job.sticker_id).eq("asset_id", assetId).maybeSingle();
            return data?.id ?? null;
          };
          /** A finished A/B/C slot is unique per (sticker, group, label). */
          const readVariationSlot = async () => {
            if (!jobIsVariation || !jobVariationMeta.groupId || !jobVariationMeta.label) return null;
            const { data } = await admin.from("sticker_versions").select("id")
              .eq("sticker_id", job.sticker_id)
              .eq("variation_group_id", jobVariationMeta.groupId)
              .eq("variation_label", jobVariationMeta.label)
              .maybeSingle();
            return data?.id ?? null;
          };
          versionId = (await readVersion()) ?? (await readVariationSlot());
          for (let attempt = 0; attempt < 3 && !versionId; attempt++) {
            const { data: maxRow } = await admin.from("sticker_versions").select("version_number").eq("sticker_id", job.sticker_id).order("version_number", { ascending: false }).limit(1).maybeSingle();
            const nextVersion = (maxRow?.version_number ?? 0) + 1;
            const { data: inserted, error: versionError } = await admin.from("sticker_versions").insert({
              workspace_id: job.workspace_id, pack_id: job.pack_id, sticker_id: job.sticker_id,
              asset_id: assetId, version_number: nextVersion, origin: versionOrigin,
              ...(jobIsVariation ? { variation_group_id: jobVariationMeta.groupId, variation_label: jobVariationMeta.label } : {}),
            }).select("id").maybeSingle();
            if (!versionError && inserted) { versionId = inserted.id; break; }
            // Unique conflict on (sticker_id, asset_id), (sticker_id, version_number)
            // or the variation slot: re-read and reuse rather than creating a
            // second logical review image.
            versionId = (await readVersion()) ?? (await readVariationSlot());
          }
          if (!versionId) {
            return await failSticker(job, "The image was created but could not be recorded in version history.", jobIsVariation ? "VARIATION_VERSION_FAILED" : "CANDIDATE_VERSION_FAILED");
          }

          await admin.from("ai_jobs").update({ status: "succeeded", completed_at: new Date().toISOString(), output_json: { asset_id: assetId, storage_path: path, transparency_valid: true, width, height, mode: jobMode, version_id: versionId, ...(jobIsVariation ? { variation_group_id: jobVariationMeta.groupId, variation_label: jobVariationMeta.label } : {}) } }).eq("id", job.id);
          await logCredits(job, credits);
          return respond({ aiJobId: job.id, jobType: job.job_type, status: "succeeded", assetId, transparencyValid: true, stage: jobIsVariation ? "variation_ready" : "candidate_ready", versionId, ...jobModeExtras });
        }

        await admin.from("stickers").update({ image_asset_id: assetId, status: "ready" }).eq("id", job.sticker_id);
        await admin.from("ai_jobs").update({ status: "succeeded", completed_at: new Date().toISOString(), output_json: { asset_id: assetId, storage_path: path, transparency_valid: true, width, height } }).eq("id", job.id);
        await logCredits(job, credits);

        if (job.pack_id) {
          const { data: siblings } = await admin.from("stickers").select("status").eq("pack_id", job.pack_id);
          const all = siblings ?? [];
          const allReady = all.length > 0 && all.every((s) => s.status === "ready");
          await admin.from("sticker_packs").update({ status: allReady ? "review" : "draft" }).eq("id", job.pack_id);
        }

        return respond({ aiJobId: job.id, jobType: job.job_type, status: "succeeded", assetId, transparencyValid: true, stage: "ready" });

      }

      return respond({ aiJobId: job.id, jobType: job.job_type, status: job.status });
    }

    return respond({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error("[sticker-ai] unexpected error", error instanceof Error ? error.message : "unknown");
    return respond({ error: "INTERNAL_ERROR", message: "Unexpected server error." }, 500);
  }
});
