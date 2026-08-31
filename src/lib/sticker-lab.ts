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

export const FLOW_STEPS = [
  "Character Reference",
  "Pack Setup",
  "Sticker Concepts",
  "Generate",
  "Review & Publish",
] as const;

export const BUILDER_STEPS = [
  { id: 1, title: "Character Reference", short: "Reference" },
  { id: 2, title: "Pack Setup", short: "Setup" },
  { id: 3, title: "Sticker Concepts", short: "Concepts" },
  { id: 4, title: "Generation Preview", short: "Generate" },
  { id: 5, title: "Review & Publish", short: "Review" },
] as const;


/**
 * Versioned, additive creative blueprint persisted on `sticker_packs.creative_blueprint`.
 * Phase 1A stores and hydrates it only — generation ignores it entirely.
 */
export type CreativeBlueprint = {
  version: 1;
  useBrandCharacterLock: boolean;
  characterLock: CharacterLock | null;
};

export function emptyBlueprint(): CreativeBlueprint {
  return { version: 1, useBrandCharacterLock: false, characterLock: null };
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
