import { normalizeCharacterLock, type CharacterLock } from "@/lib/brand-kit";

export type PackTheme = "Reactions" | "Crypto" | "Community" | "Meme" | "Custom";


export const PACK_THEMES: PackTheme[] = [
  "Reactions",
  "Crypto",
  "Community",
  "Meme",
  "Custom",
];

export const PACK_SIZES = [6, 12, 24] as const;
export type PackSize = (typeof PACK_SIZES)[number];

export type Concept = {
  id: string;
  label: string;
  action: string;
  emoji: string;
  /**
   * Editor/session-only flag. Locked concepts are protected from AI
   * replacement; they are never persisted to the database.
   */
  locked?: boolean;
};

type Seed = [label: string, action: string, emoji: string];

const SEEDS: Record<PackTheme, Seed[]> = {
  Crypto: [
    ["W", "arms raised in victory", "🏆"],
    ["BULLISH", "charging forward, confident grin", "🐂"],
    ["SEND IT", "pointing up hard", "🚀"],
    ["GM", "sleepy wave with coffee", "☕"],
    ["JEET DETECTED", "squinting suspiciously", "🔍"],
    ["CARTEL APPROVED", "stamping a seal", "✅"],
    ["HOLD", "gripping tight, jaw clenched", "✊"],
    ["LOADING UP", "shovelling into a bag", "🛒"],
    ["WE MOVE", "walking with purpose", "🚶"],
    ["COOKING", "stirring a pot, smug", "🍳"],
    ["WATCHING", "eyes narrowed on charts", "👀"],
    ["MOON TIME", "riding a rocket", "🌙"],
    ["NGMI", "head in hands", "💀"],
    ["DIAMOND", "holding up a gem", "💎"],
    ["RUGGED", "falling backwards", "🪤"],
    ["ALPHA", "whispering a secret", "🤫"],
    ["PAPER HANDS", "dropping papers in panic", "🧻"],
    ["FLOOR SWEEP", "sweeping with a broom", "🧹"],
    ["LFG", "shouting with fists up", "🔥"],
    ["REKT", "flat on the ground", "🩹"],
    ["DYOR", "reading a thick book", "📚"],
    ["WHALE", "riding a huge wave", "🐋"],
    ["FUD", "waving hands dismissively", "🚫"],
    ["TOP SIGNAL", "sweating nervously", "📈"],
  ],
  Reactions: [
    ["LOL", "laughing hard", "😂"],
    ["NICE", "thumbs up", "👍"],
    ["NOPE", "shaking head", "🙅"],
    ["SHOCKED", "jaw dropped", "😱"],
    ["THINKING", "hand on chin", "🤔"],
    ["LOVE IT", "heart eyes", "😍"],
    ["CRYING", "streaming tears", "😭"],
    ["ANGRY", "steam from ears", "😤"],
    ["SHRUG", "palms up", "🤷"],
    ["CLAP", "applauding", "👏"],
    ["SLEEPY", "yawning", "🥱"],
    ["SUS", "side eye", "🧐"],
    ["OK", "hand sign", "👌"],
    ["FACEPALM", "hand over face", "🤦"],
    ["PARTY", "throwing confetti", "🎉"],
    ["COOL", "sunglasses drop", "😎"],
    ["SCARED", "hiding behind hands", "😨"],
    ["HUNGRY", "drooling", "🤤"],
    ["WAVE", "waving hello", "👋"],
    ["SALUTE", "sharp salute", "🫡"],
    ["MIND BLOWN", "head exploding", "🤯"],
    ["CHILL", "leaning back relaxed", "🧊"],
    ["POINTING", "pointing at you", "👉"],
    ["SIGH", "deep exhale", "😮‍💨"],
  ],
  Community: [
    ["WELCOME", "opening arms wide", "🫂"],
    ["GM FAM", "morning wave", "🌅"],
    ["RAID", "leading a charge", "📣"],
    ["VOTE", "raising a ballot", "🗳️"],
    ["MOD", "holding a badge", "🛡️"],
    ["BAN HAMMER", "swinging a hammer", "🔨"],
    ["SPACES", "talking into a mic", "🎙️"],
    ["SHILL", "holding a sign", "📢"],
    ["THANKS", "bowing slightly", "🙏"],
    ["TEAMWORK", "fist bump", "🤝"],
    ["ANNOUNCE", "megaphone up", "📯"],
    ["GN", "tucked into bed", "🌙"],
    ["NEW HERE", "shy wave", "🐣"],
    ["OG", "arms crossed, veteran", "🎖️"],
    ["INVITE", "handing out a card", "✉️"],
    ["MEETUP", "group huddle", "🧑‍🤝‍🧑"],
    ["RULES", "pointing at a board", "📋"],
    ["QUIET", "finger to lips", "🤫"],
    ["HYPE", "jumping in the air", "⚡"],
    ["SUPPORT", "helping hand up", "🫱"],
    ["QUESTION", "hand raised", "❓"],
    ["POLL", "holding two options", "📊"],
    ["ARCHIVE", "filing a folder", "🗂️"],
    ["CELEBRATE", "popping a bottle", "🍾"],
  ],
  Meme: [
    ["SMUG", "tiny satisfied smile", "😏"],
    ["COPIUM", "inhaling from a tank", "🫧"],
    ["BASED", "nodding approval", "🗿"],
    ["CRINGE", "recoiling", "😬"],
    ["POPCORN", "watching drama", "🍿"],
    ["THIS IS FINE", "sitting calmly in flames", "🔥"],
    ["STONKS", "pointing at a line up", "📈"],
    ["NO THOUGHTS", "blank stare", "🫥"],
    ["BONK", "swinging a bat", "🏏"],
    ["GIGA", "flexing hard", "💪"],
    ["MALDING", "fuming", "🧨"],
    ["TOUCH GRASS", "standing on a lawn", "🌱"],
    ["RATIO", "holding up a number", "🔢"],
    ["SIDE EYE", "glancing sideways", "👁️"],
    ["SPEECHLESS", "mouth flat line", "😐"],
    ["CHEF KISS", "kissing fingers", "🤌"],
    ["DELETE THIS", "hovering over a key", "⌨️"],
    ["SCREAMING", "wide open mouth", "🗣️"],
    ["PLOTTING", "steepling fingers", "🕴️"],
    ["EXIT", "walking out the door", "🚪"],
    ["ZOOM IN", "holding a magnifier", "🔎"],
    ["CAUGHT", "frozen mid-act", "📸"],
    ["SPRINT", "running fast", "🏃"],
    ["DRAMA", "fanning self", "🎭"],
  ],
  Custom: [
    ["CONCEPT 1", "describe the pose or expression", "⭐"],
    ["CONCEPT 2", "describe the pose or expression", "⭐"],
    ["CONCEPT 3", "describe the pose or expression", "⭐"],
    ["CONCEPT 4", "describe the pose or expression", "⭐"],
    ["CONCEPT 5", "describe the pose or expression", "⭐"],
    ["CONCEPT 6", "describe the pose or expression", "⭐"],
    ["CONCEPT 7", "describe the pose or expression", "⭐"],
    ["CONCEPT 8", "describe the pose or expression", "⭐"],
    ["CONCEPT 9", "describe the pose or expression", "⭐"],
    ["CONCEPT 10", "describe the pose or expression", "⭐"],
    ["CONCEPT 11", "describe the pose or expression", "⭐"],
    ["CONCEPT 12", "describe the pose or expression", "⭐"],
    ["CONCEPT 13", "describe the pose or expression", "⭐"],
    ["CONCEPT 14", "describe the pose or expression", "⭐"],
    ["CONCEPT 15", "describe the pose or expression", "⭐"],
    ["CONCEPT 16", "describe the pose or expression", "⭐"],
    ["CONCEPT 17", "describe the pose or expression", "⭐"],
    ["CONCEPT 18", "describe the pose or expression", "⭐"],
    ["CONCEPT 19", "describe the pose or expression", "⭐"],
    ["CONCEPT 20", "describe the pose or expression", "⭐"],
    ["CONCEPT 21", "describe the pose or expression", "⭐"],
    ["CONCEPT 22", "describe the pose or expression", "⭐"],
    ["CONCEPT 23", "describe the pose or expression", "⭐"],
    ["CONCEPT 24", "describe the pose or expression", "⭐"],
  ],
};

/** Deterministic local starter concepts. No AI, no network. */
export function starterConcepts(theme: PackTheme, size: number): Concept[] {
  const seeds = SEEDS[theme] ?? SEEDS.Custom;
  return Array.from({ length: size }, (_, i) => {
    const [label, action, emoji] = seeds[i % seeds.length]!;
    return { id: `c${i + 1}`, label, action, emoji };
  });
}

export const BUILDER_STEPS = [
  { id: 1, title: "Character & Brand", short: "Character" },
  { id: 2, title: "Creative Direction", short: "Direction" },
  { id: 3, title: "Concept Studio", short: "Concepts" },
  { id: 4, title: "Sticker Studio", short: "Studio" },
  { id: 5, title: "Quality & Release", short: "Release" },
] as const;

/**
 * The four-stage user journey layered on top of the unchanged five-step
 * builder engine. Presentation only — no step ids, routing or validation
 * depend on this map.
 */
export type JourneyStage = {
  key: string;
  name: string;
  steps: number[];
  substeps?: string[];
  does: string;
  benefit: string;
};

export const JOURNEY_STAGES: JourneyStage[] = [
  {
    key: "blueprint",
    name: "Blueprint",
    steps: [1, 2],
    substeps: ["1. Character & Brand", "2. Creative Direction"],
    does: "Lock your character identity, references and creative rules.",
    benefit: "Set it once so every generated sticker stays on-character and on-brand.",
  },
  {
    key: "concepts",
    name: "Concept Studio",
    steps: [3],
    does: "Plan, edit, lock, reorder and optionally AI-suggest sticker ideas.",
    benefit: "Get the ideas right in text — before you spend anything on image generation.",
  },
  {
    key: "studio",
    name: "Sticker Studio",
    steps: [4],
    does: "Test one sticker, generate selected stickers or batches, review versions.",
    benefit: "Control spend and quality sticker by sticker instead of all-or-nothing.",
  },
  {
    key: "release",
    name: "Quality & Release",
    steps: [5],
    does: "Verify transparency and cutout quality, export, publish to Telegram, send to communities.",
    benefit: "Ship one clean Telegram sticker set your communities actually receive.",
  },
];

/** Contextual per-step guide: what you're doing, why, and what comes next. */
export const STEP_GUIDES: Record<
  number,
  { stage: string; doing: string; why: string; next: string }
> = {
  1: {
    stage: "Blueprint · Step 1 of 2",
    doing: "Name your character and choose the reference images the AI must match.",
    why: "Character Lock keeps the same face, wardrobe and traits across the whole pack.",
    next: "Next: Creative Direction, the second half of your Blueprint.",
  },
  2: {
    stage: "Blueprint · Step 2 of 2",
    doing: "Name the pack and set purpose, audience, tone and pack rules.",
    why: "These creative rules steer every concept and every generated image.",
    next: "Next: Concept Studio, where you plan the individual stickers.",
  },
  3: {
    stage: "Concept Studio",
    doing: "Write, edit, lock, reorder or duplicate the concepts in your pack.",
    why: "AI suggestions are optional and text-only. They may use text-model credits, but they never start image generation.",
    next: "Next: Sticker Studio, where concepts become paid image generations.",
  },
  4: {
    stage: "Sticker Studio",
    doing: "Test one sticker first, then generate the ones you select.",
    why: "You choose what gets generated, so you control spend and quality.",
    next: "Next: Quality & Release, where you verify and publish the pack.",
  },
  5: {
    stage: "Quality & Release",
    doing: "Check quality, export if you want, publish the Telegram set, then pick communities.",
    why: "Order matters: quality checks → export (optional) → Telegram pack → communities.",
    next: "After release: automate posting with Sticker Drops.",
  },
};

/** Capabilities that genuinely exist today. Nothing aspirational here. */
export const V2_CAPABILITIES: { name: string; blurb: string }[] = [
  { name: "Character Lock", blurb: "One identity contract reused across the pack." },
  { name: "AI Concept Suggestions", blurb: "Optional, text-only idea help." },
  { name: "Selective & Batch Generation", blurb: "Generate only what you pick." },
  { name: "Version History", blurb: "Successful generations are kept and restorable." },
  { name: "Quality Verification", blurb: "Server-side transparency and cutout checks." },
  { name: "Telegram Release", blurb: "One official sticker set per pack." },
  { name: "Community Distribution", blurb: "Send the set to connected communities." },
  { name: "Sticker Drops", blurb: "Scheduled posting after release." },
];


/**
 * Pack-level creative direction. Persisted only in this phase — the provider
 * prompt compiler does not read it yet.
 */
export const HUMOR_LEVELS = ["unspecified", "none", "light", "balanced", "heavy"] as const;
export type HumorLevel = (typeof HUMOR_LEVELS)[number];

export const INTENSITY_LEVELS = ["unspecified", "calm", "balanced", "high", "maximum"] as const;
export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

export const TEXT_PREFERENCES = [
  "unspecified",
  "no_text",
  "minimal",
  "balanced",
  "text_forward",
] as const;
export type TextPreference = (typeof TEXT_PREFERENCES)[number];

export type CreativeDirection = {
  purpose: string;
  audience: string;
  toneKeywords: string[];
  humorLevel: HumorLevel;
  intensity: IntensityLevel;
  visualDirection: string;
  textPreference: TextPreference;
  textNotes: string;
  packRules: string[];
};

export function emptyCreativeDirection(): CreativeDirection {
  return {
    purpose: "",
    audience: "",
    toneKeywords: [],
    humorLevel: "unspecified",
    intensity: "unspecified",
    visualDirection: "",
    textPreference: "unspecified",
    textNotes: "",
    packRules: [],
  };
}

/** Splits a comma / newline separated textarea value into a clean list. */
export function parseDirectionList(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const trimmed = raw.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export const formatDirectionList = (list: string[]): string => list.join(", ");

function directionString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function directionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

function directionEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Parses an unknown creative direction value. Never throws. */
export function normalizeCreativeDirection(value: unknown): CreativeDirection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyCreativeDirection();
  }
  const raw = value as Record<string, unknown>;
  return {
    purpose: directionString(raw['purpose']),
    audience: directionString(raw['audience']),
    toneKeywords: directionList(raw['toneKeywords']),
    humorLevel: directionEnum(raw['humorLevel'], HUMOR_LEVELS, "unspecified"),
    intensity: directionEnum(raw['intensity'], INTENSITY_LEVELS, "unspecified"),
    visualDirection: directionString(raw['visualDirection']),
    textPreference: directionEnum(raw['textPreference'], TEXT_PREFERENCES, "unspecified"),
    textNotes: directionString(raw['textNotes']),
    packRules: directionList(raw['packRules']),
  };
}

/**
 * Versioned, additive creative blueprint persisted on `sticker_packs.creative_blueprint`.
 * Stored and hydrated only — generation ignores it entirely.
 */
export type CreativeBlueprint = {
  version: 1;
  useBrandCharacterLock: boolean;
  characterLock: CharacterLock | null;
  creativeDirection: CreativeDirection;
};

export function emptyBlueprint(): CreativeBlueprint {
  return {
    version: 1,
    useBrandCharacterLock: false,
    characterLock: null,
    creativeDirection: emptyCreativeDirection(),
  };
}

/** Parses an unknown `creative_blueprint` value. `{}` and junk degrade to defaults. */
export function normalizeBlueprint(value: unknown): CreativeBlueprint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyBlueprint();
  }
  const raw = value as Record<string, unknown>;
  const lock = raw['characterLock'];
  return {
    version: 1,
    useBrandCharacterLock: raw['useBrandCharacterLock'] === true,
    characterLock:
      typeof lock === "object" && lock !== null && !Array.isArray(lock)
        ? normalizeCharacterLock(lock)
        : null,
    creativeDirection: normalizeCreativeDirection(raw['creativeDirection']),
  };
}


export type BuilderDraft = {
  characterName: string;
  imageName: string | null;
  /** Primary uploaded reference (legacy single-reference field). */
  referenceAssetId: string | null;
  referenceStoragePath: string | null;
  /** Up to 3 workspace references explicitly selected for generation. */
  referenceAssetIds: string[];
  packName: string;
  theme: PackTheme;
  size: PackSize;
  brief: string;
  styleNotes: string;
  concepts: Concept[];
  keywords: Record<string, string>;
  /** Persisted pack row id, so retries reuse the same rows. */
  packId: string | null;
  /** Local concept id -> persisted sticker row id. */
  stickerIds: Record<string, string>;
  /** Versioned creative blueprint. Not wired into generation in this phase. */
  creativeBlueprint: CreativeBlueprint;
  /**
   * Editor/session-only flag: the user explicitly marked the concept board
   * ready. Never persisted to the database; any material concept change
   * resets it to false.
   */
  conceptBoardApproved: boolean;
};


export const MAX_REFERENCES = 3;

export const DRAFT_KEY = "cartel-hq:sticker-lab:draft";

export function emptyDraft(): BuilderDraft {
  return {
    characterName: "",
    imageName: null,
    referenceAssetId: null,
    referenceStoragePath: null,
    referenceAssetIds: [],
    packName: "",
    theme: "Crypto",
    size: 12,
    brief: "",
    styleNotes: "",
    concepts: starterConcepts("Crypto", 12),
    keywords: {},
    packId: null,
    stickerIds: {},
    creativeBlueprint: emptyBlueprint(),
    conceptBoardApproved: false,
  };
}


export function loadDraft(): BuilderDraft {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as Partial<BuilderDraft>;
    // Older session drafts predate the blueprint — hydrate them safely.
    return {
      ...emptyDraft(),
      ...parsed,
      creativeBlueprint: normalizeBlueprint(parsed.creativeBlueprint),
      // Older session drafts predate the board-ready flag — never assume ready.
      conceptBoardApproved: parsed.conceptBoardApproved === true,
    };

  } catch {
    return emptyDraft();
  }
}

export function saveDraft(draft: BuilderDraft) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* session storage unavailable — draft stays in memory only */
  }
}

/** Clears the session draft so "Create Sticker Pack" starts genuinely empty.
 *  Never touches persisted Supabase rows. */
export function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* session storage unavailable */
  }
}
