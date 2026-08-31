import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * sticker-concepts — TEXT ONLY.
 *
 * Produces editable sticker CONCEPT IDEAS for Sticker Lab Step 3. It never
 * creates images, never touches `stickers`, `sticker_packs`, `ai_jobs` or
 * `usage_ledger`, never calls the image pipeline (`/api/v1/jobs/createTask`)
 * and never invokes the `sticker-ai` function.
 *
 * Reuses the existing KIE_API_KEY secret. No new secret is introduced.
 */

const KIE_BASE = "https://api.kie.ai";
const CHAT_MODEL = "gemini-2.5-flash";
const CHAT_PATH = "/gemini-2.5-flash/v1/chat/completions";

const ALLOWED_SIZES = [6, 12, 24];

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

/* --------------------------------- helpers -------------------------------- */

const MAX_STR = 600;
const MAX_LIST_ITEMS = 12;
const MAX_LIST_ITEM = 160;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStr(value: unknown, cap = MAX_STR): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

function safeList(value: unknown, maxItems = MAX_LIST_ITEMS, cap = MAX_LIST_ITEM): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().slice(0, cap);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function jsonList(value: unknown, maxItems = MAX_LIST_ITEMS): string[] {
  if (Array.isArray(value)) return safeList(value, maxItems);
  if (typeof value === "string" && value.trim()) {
    try {
      return safeList(JSON.parse(value), maxItems);
    } catch {
      return safeList([value], maxItems);
    }
  }
  if (isRecord(value)) {
    return safeList(
      Object.entries(value).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
      maxItems,
    );
  }
  return [];
}

type CharacterLock = {
  enabled: boolean;
  subjectName: string;
  identityNotes: string;
  protectedTraits: string[];
  wardrobeAccessories: string[];
  negativeConstraints: string[];
};

type CreativeDirection = {
  purpose: string;
  audience: string;
  toneKeywords: string[];
  humorLevel: string;
  intensity: string;
  visualDirection: string;
  textPreference: string;
  textNotes: string;
  packRules: string[];
};

type Blueprint = {
  useBrandCharacterLock: boolean;
  characterLock: CharacterLock | null;
  creativeDirection: CreativeDirection;
};

const HUMOR = ["unspecified", "none", "light", "balanced", "heavy"];
const INTENSITY = ["unspecified", "calm", "balanced", "high", "maximum"];
const TEXT_PREF = ["unspecified", "no_text", "minimal", "balanced", "text_forward"];

function safeEnum(value: unknown, allowed: string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : "unspecified";
}

function parseBlueprint(value: unknown): Blueprint {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const record = isRecord(raw) ? raw : {};
  const lockRaw = record["characterLock"];
  const lock = isRecord(lockRaw)
    ? {
        enabled: lockRaw["enabled"] === true,
        subjectName: safeStr(lockRaw["subjectName"], 120),
        identityNotes: safeStr(lockRaw["identityNotes"]),
        protectedTraits: safeList(lockRaw["protectedTraits"]),
        wardrobeAccessories: safeList(lockRaw["wardrobeAccessories"]),
        negativeConstraints: safeList(lockRaw["negativeConstraints"]),
      }
    : null;
  const dirRaw = isRecord(record["creativeDirection"]) ? (record["creativeDirection"] as Record<string, unknown>) : {};
  return {
    useBrandCharacterLock: record["useBrandCharacterLock"] === true,
    characterLock: lock,
    creativeDirection: {
      purpose: safeStr(dirRaw["purpose"]),
      audience: safeStr(dirRaw["audience"]),
      toneKeywords: safeList(dirRaw["toneKeywords"]),
      humorLevel: safeEnum(dirRaw["humorLevel"], HUMOR),
      intensity: safeEnum(dirRaw["intensity"], INTENSITY),
      visualDirection: safeStr(dirRaw["visualDirection"]),
      textPreference: safeEnum(dirRaw["textPreference"], TEXT_PREF),
      textNotes: safeStr(dirRaw["textNotes"]),
      packRules: safeList(dirRaw["packRules"]),
    },
  };
}

const HUMOR_TEXT: Record<string, string> = {
  none: "Play it straight; no jokes.",
  light: "Light humour.",
  balanced: "Balanced humour.",
  heavy: "Comedy-forward.",
};

const INTENSITY_TEXT: Record<string, string> = {
  calm: "Calm, understated energy.",
  balanced: "Balanced energy.",
  high: "High energy.",
  maximum: "Maximum, over-the-top energy.",
};

const TEXT_PREF_TEXT: Record<string, string> = {
  no_text: "The finished stickers will carry no rendered text, so labels are planning metadata only.",
  minimal: "Finished stickers use very short text at most, so keep labels to one or two words.",
  balanced: "Finished stickers may carry a short caption; labels should read well as captions.",
  text_forward: "Finished stickers lean on caption text; labels should be punchy caption lines.",
};

/* ------------------------------ prompt builder ----------------------------- */

type BrandKit = {
  brand_name?: string | null;
  ticker?: string | null;
  colors?: unknown;
  fonts?: unknown;
  ai_style_notes?: string | null;
  prohibited_styles?: unknown;
};

function buildPrompt(input: {
  size: number;
  targetCount: number;
  mode: "board" | "alternatives";
  focus: Array<{ label: string; action: string }>;
  characterName: string;
  theme: string;
  brief: string;
  styleNotes: string;
  blueprint: Blueprint;
  brandKit: BrandKit | null;
  existing: Array<{ label: string; action: string }>;
}): string {
  const { blueprint, brandKit } = input;
  const dir = blueprint.creativeDirection;
  const lock = blueprint.useBrandCharacterLock ? blueprint.characterLock : null;
  const lines: string[] = [];

  lines.push(
    `You are a creative director for a messaging sticker pack of ${input.size} stickers. Produce exactly ${input.targetCount} distinct sticker CONCEPT IDEAS.`,
  );
  lines.push(
    "These are concept ideas, not image prompts. Each concept describes ONE single character sticker: a concrete, visible pose, expression or action that an illustrator could draw without further explanation.",
  );

  const subject = lock?.subjectName || input.characterName;
  if (subject) lines.push(`CHARACTER: ${subject}.`);
  if (lock) {
    if (lock.identityNotes) lines.push(`CHARACTER IDENTITY: ${lock.identityNotes}`);
    if (lock.protectedTraits.length) lines.push(`ALWAYS PRESERVE: ${lock.protectedTraits.join("; ")}.`);
    if (lock.wardrobeAccessories.length) lines.push(`WARDROBE / ACCESSORIES: ${lock.wardrobeAccessories.join("; ")}.`);
    if (lock.negativeConstraints.length) lines.push(`NEVER: ${lock.negativeConstraints.join("; ")}.`);
  }

  if (input.theme) lines.push(`PACK THEME: ${input.theme}.`);
  if (dir.purpose) lines.push(`PURPOSE: ${dir.purpose}`);
  if (dir.audience) lines.push(`AUDIENCE: ${dir.audience}`);
  if (dir.toneKeywords.length) lines.push(`TONE: ${dir.toneKeywords.join(", ")}.`);
  if (HUMOR_TEXT[dir.humorLevel]) lines.push(`HUMOUR: ${HUMOR_TEXT[dir.humorLevel]}`);
  if (INTENSITY_TEXT[dir.intensity]) lines.push(`ENERGY: ${INTENSITY_TEXT[dir.intensity]}`);
  if (dir.visualDirection) lines.push(`VISUAL DIRECTION: ${dir.visualDirection}`);
  if (TEXT_PREF_TEXT[dir.textPreference]) lines.push(`TEXT USE: ${TEXT_PREF_TEXT[dir.textPreference]}`);
  if (dir.textNotes) lines.push(`TEXT NOTES: ${dir.textNotes}`);
  if (dir.packRules.length) lines.push(`PACK RULES: ${dir.packRules.join("; ")}.`);

  if (input.brief) lines.push(`BRIEF: ${input.brief}`);
  if (input.styleNotes) lines.push(`STYLE NOTES: ${input.styleNotes}`);

  if (brandKit) {
    const brandBits: string[] = [];
    if (brandKit.brand_name) brandBits.push(`brand ${safeStr(brandKit.brand_name, 120)}`);
    if (brandKit.ticker) brandBits.push(`ticker ${safeStr(brandKit.ticker, 40)}`);
    const colors = jsonList(brandKit.colors, 8);
    if (colors.length) brandBits.push(`colours ${colors.join(", ")}`);
    const fonts = jsonList(brandKit.fonts, 6);
    if (fonts.length) brandBits.push(`fonts ${fonts.join(", ")}`);
    if (brandBits.length) lines.push(`BRAND KIT: ${brandBits.join("; ")}.`);
    const styleNotes = safeStr(brandKit.ai_style_notes);
    if (styleNotes) lines.push(`BRAND STYLE NOTES: ${styleNotes}`);
    const prohibited = jsonList(brandKit.prohibited_styles, 10);
    if (prohibited.length) lines.push(`BRAND PROHIBITED: ${prohibited.join("; ")}.`);
  }

  const describe = (c: { label: string; action: string }) =>
    `${c.label}${c.action ? ` (${c.action})` : ""}`;

  if (input.existing.length) {
    lines.push(
      `THE CURRENT BOARD (do not duplicate any of these): ${input.existing.map(describe).join(" | ")}.`,
    );
  }

  if (input.mode === "alternatives") {
    lines.push(
      `REPLACEMENT TASK: produce exactly one replacement alternative for each of the ${input.focus.length} concepts listed below, in the SAME ORDER. Result ${"#"}N must replace focus concept ${"#"}N.`,
    );
    lines.push(
      `FOCUS CONCEPTS TO REPLACE: ${input.focus
        .map((c, i) => `${i + 1}. ${describe(c)}`)
        .join(" | ")}.`,
    );
    lines.push(
      "Each alternative must be meaningfully different from the concept it replaces and from every concept already on the board, while still fitting the same character, brand and creative direction.",
    );
  } else {
    lines.push(
      `Propose a genuinely different, more interesting set of ${input.targetCount} concepts that does not repeat anything already on the board.`,
    );
  }

  lines.push(
    "RULES: label is a short punchy caption-style name (max 48 characters). action is one concrete visible pose, expression or action (max 200 characters), no camera or rendering jargon. emoji is a single short emoji. Every label must be unique. No slurs, no hate, no financial promises, no claims of guaranteed profit or token safety.",
  );
  lines.push(`Return exactly ${input.targetCount} concepts, in order.`);

  return lines.join("\n");
}

/* ------------------------------ output parsing ----------------------------- */

type SuggestedConcept = { label: string; action: string; emoji: string };

function parseConcepts(content: unknown, size: number): SuggestedConcept[] | null {
  let text: string | null = null;
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    const parts = content
      .map((p) => (isRecord(p) && typeof p["text"] === "string" ? (p["text"] as string) : ""))
      .filter(Boolean);
    text = parts.join("");
  }
  if (!text || !text.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  const rawList = parsed["concepts"];
  if (!Array.isArray(rawList)) return null;

  const out: SuggestedConcept[] = [];
  const seen = new Set<string>();
  for (const entry of rawList) {
    if (!isRecord(entry)) continue;
    const label = safeStr(entry["label"], 48);
    const action = safeStr(entry["action"], 200);
    const emoji = safeStr(entry["emoji"], 12);
    if (!label || !action) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, action, emoji });
  }
  return out.length === size ? out : null;
}

/* ---------------------------------- server --------------------------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const KIE_API_KEY = Deno.env.get("KIE_API_KEY") ?? "";

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
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return respond({ error: "INVALID_BODY" }, 400);
  }

  const action = String(body["action"] ?? "");

  // Free probe. Never contacts the provider and spends nothing.
  if (action === "config") {
    return respond({ configured: Boolean(KIE_API_KEY), model: CHAT_MODEL });
  }

  if (action !== "suggest") return respond({ error: "UNKNOWN_ACTION" }, 400);

  if (!KIE_API_KEY) {
    return respond(
      {
        error: "KIE_NOT_CONFIGURED",
        message: "KIE_API_KEY is not configured in Supabase Edge Function secrets.",
      },
      503,
    );
  }

  const workspaceId = String(body["workspaceId"] ?? "");
  const size = Number(body["size"]);
  if (!workspaceId || !ALLOWED_SIZES.includes(size)) return respond({ error: "INVALID_INPUT" }, 400);

  // Backwards compatible: absent targetCount means "the whole board".
  const rawTarget = body["targetCount"];
  const targetCount = rawTarget === undefined || rawTarget === null ? size : Number(rawTarget);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > size) {
    return respond({ error: "INVALID_TARGET_COUNT" }, 400);
  }

  const modeRaw = safeStr(body["mode"], 20);
  const mode: "board" | "alternatives" = modeRaw === "alternatives" ? "alternatives" : "board";

  const toConcept = (c: Record<string, unknown>) => ({
    label: safeStr(c["label"], 48),
    action: safeStr(c["action"], 200),
  });

  const focus = Array.isArray(body["focusConcepts"])
    ? (body["focusConcepts"] as unknown[])
        .filter(isRecord)
        .map(toConcept)
        .filter((c) => c.label || c.action)
        .slice(0, Math.min(targetCount, 24))
    : [];

  if (mode === "alternatives" && focus.length !== targetCount) {
    return respond({ error: "INVALID_FOCUS_CONCEPTS" }, 400);
  }

  const { data: membership } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return respond({ error: "FORBIDDEN" }, 403);

  const existing = Array.isArray(body["concepts"])
    ? (body["concepts"] as unknown[])
        .filter(isRecord)
        .slice(0, 24)
        .map(toConcept)
        .filter((c) => c.label || c.action)
    : [];

  const { data: brandKit } = await admin
    .from("brand_kits")
    .select("brand_name,ticker,colors,fonts,ai_style_notes,prohibited_styles")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const prompt = buildPrompt({
    size,
    targetCount,
    mode,
    focus,
    characterName: safeStr(body["characterName"], 120),
    theme: safeStr(body["theme"], 60),
    brief: safeStr(body["brief"]),
    styleNotes: safeStr(body["styleNotes"]),
    blueprint: parseBlueprint(body["creativeBlueprint"]),
    brandKit: (brandKit as BrandKit | null) ?? null,
    existing,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["concepts"],
    properties: {
      concepts: {
        type: "array",
        minItems: size,
        maxItems: size,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "action", "emoji"],
          properties: {
            label: { type: "string" },
            action: { type: "string" },
            emoji: { type: "string" },
          },
        },
      },
    },
  };

  // Exactly ONE provider request per explicit user action. No retries.
  let response: Response;
  try {
    response = await fetch(`${KIE_BASE}${CHAT_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KIE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stream: false,
        include_thoughts: false,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "sticker_concepts", strict: true, schema },
        },
      }),
    });
  } catch {
    return respond({ error: "PROVIDER_UNREACHABLE", message: "Could not reach the concept service." }, 502);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const status = response.status;
    const message =
      status === 401
        ? "The concept service rejected the configured API key."
        : status === 403
          ? "The concept service denied this request."
          : status === 429
            ? "The concept service is rate limiting requests. Try again shortly."
            : status >= 500
              ? "The concept service is temporarily unavailable."
              : "The concept service returned an unexpected error.";
    const safeStatus = status === 401 ? 401 : status === 403 ? 403 : status === 429 ? 429 : 502;
    return respond({ error: "PROVIDER_FAILED", message }, safeStatus);
  }

  const choices = payload["choices"];
  const first = Array.isArray(choices) && isRecord(choices[0]) ? (choices[0] as Record<string, unknown>) : null;
  const message = first && isRecord(first["message"]) ? (first["message"] as Record<string, unknown>) : null;
  const concepts = parseConcepts(message?.["content"], size);

  if (!concepts) {
    return respond(
      {
        error: "PROVIDER_MALFORMED",
        message: `The concept service did not return ${size} usable concepts. Nothing was changed — try again or keep the starter concepts.`,
      },
      502,
    );
  }

  const usageRaw = isRecord(payload["usage"]) ? (payload["usage"] as Record<string, unknown>) : null;
  const usageNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const usage = usageRaw
    ? {
        promptTokens: usageNumber(usageRaw["prompt_tokens"]),
        completionTokens: usageNumber(usageRaw["completion_tokens"]),
        totalTokens: usageNumber(usageRaw["total_tokens"]),
      }
    : null;

  return respond({ concepts, model: CHAT_MODEL, usage });
});
