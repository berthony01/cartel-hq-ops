/**
 * Character Lock — canonical character identity stored inside the existing
 * `brand_kits.metadata` JSON under a single stable, versioned key.
 *
 * Nothing here touches generation. Phase 1A only defines, persists and shows
 * the model; prompt compilation and provider behaviour are unchanged.
 */

export const CHARACTER_LOCK_KEY = "sticker_character_lock_v1";

export const MAX_CANONICAL_REFERENCES = 3;

export type CharacterLock = {
  enabled: boolean;
  subjectName: string;
  identityNotes: string;
  protectedTraits: string[];
  wardrobeAccessories: string[];
  negativeConstraints: string[];
  /** Media asset ids already stored in this workspace. Max 3. */
  canonicalReferenceAssetIds: string[];
};

export function emptyCharacterLock(): CharacterLock {
  return {
    enabled: false,
    subjectName: "",
    identityNotes: "",
    protectedTraits: [],
    wardrobeAccessories: [],
    negativeConstraints: [],
    canonicalReferenceAssetIds: [],
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringList(value: unknown, limit?: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (limit !== undefined && out.length >= limit) break;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses an unknown JSON value into a Character Lock. Never throws. */
export function normalizeCharacterLock(value: unknown): CharacterLock {
  if (!isRecord(value)) return emptyCharacterLock();
  return {
    enabled: value['enabled'] === true,
    subjectName: asString(value['subjectName']).trim(),
    identityNotes: asString(value['identityNotes']),
    protectedTraits: asStringList(value['protectedTraits']),
    wardrobeAccessories: asStringList(value['wardrobeAccessories']),
    negativeConstraints: asStringList(value['negativeConstraints']),
    canonicalReferenceAssetIds: asStringList(
      value['canonicalReferenceAssetIds'],
      MAX_CANONICAL_REFERENCES,
    ),
  };
}

/** Reads the Character Lock out of an unknown `brand_kits.metadata` value. */
export function readCharacterLock(metadata: unknown): CharacterLock {
  if (!isRecord(metadata)) return emptyCharacterLock();
  return normalizeCharacterLock(metadata[CHARACTER_LOCK_KEY]);
}

/**
 * Merges the Character Lock into existing metadata, preserving every other
 * key already stored on the row.
 */
export function writeCharacterLock(
  metadata: unknown,
  lock: CharacterLock,
): Record<string, unknown> {
  const base = isRecord(metadata) ? { ...metadata } : {};
  base[CHARACTER_LOCK_KEY] = normalizeCharacterLock(lock);
  return base;
}

/** True when the lock carries anything worth showing or snapshotting. */
export function hasCharacterLockContent(lock: CharacterLock): boolean {
  return (
    lock.subjectName.trim().length > 0 ||
    lock.identityNotes.trim().length > 0 ||
    lock.protectedTraits.length > 0 ||
    lock.wardrobeAccessories.length > 0 ||
    lock.negativeConstraints.length > 0 ||
    lock.canonicalReferenceAssetIds.length > 0
  );
}

/** Splits a comma / newline separated textarea value into a clean list. */
export function parseLockList(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(/[\n,]/)) {
    const trimmed = raw.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export const formatLockList = (list: string[]): string => list.join(", ");
