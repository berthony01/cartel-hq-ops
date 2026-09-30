/**
 * MINI-HQ B1 — shared custom message media contract (pure, isomorphic).
 *
 * Prepared media only: selections are stored per workspace but NO sender
 * reads them yet (sending integration is a later, sequenced batch).
 * Validation is by decoded bytes + magic numbers, never by client MIME.
 */

export const CUSTOM_MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export const CUSTOM_MEDIA_MAX_DIMENSION = 4096;
export const CUSTOM_MEDIA_PURPOSE = "custom_message_media";
export const CUSTOM_MEDIA_ASSET_TYPE = "other";
export const CUSTOM_MEDIA_SLOTS = ["mission", "broadcast"] as const;
export type CustomMediaSlot = (typeof CUSTOM_MEDIA_SLOTS)[number];
export type CustomMediaKind = "png" | "jpeg" | "gif";
export const CUSTOM_MEDIA_MIME: Record<CustomMediaKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

export type CustomMediaInspection =
  | { ok: true; kind: CustomMediaKind; mimeType: string; width: number; height: number; animated: boolean; bytes: number }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_type" | "corrupt" | "bad_dimensions" };

export function isCustomMediaSlot(value: unknown): value is CustomMediaSlot {
  return typeof value === "string" && (CUSTOM_MEDIA_SLOTS as readonly string[]).includes(value);
}

function u16be(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}
function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}
function u32be(b: Uint8Array, i: number): number {
  return (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0);
}

function detect(b: Uint8Array): CustomMediaKind | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  return null;
}

function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { h: u16be(b, i + 5), w: u16be(b, i + 7) };
    i += 2 + len;
  }
  return null;
}

/** Counts GIF image descriptors (0x2C) by walking blocks; >1 frame = animated. */
function gifFrames(b: Uint8Array): number | null {
  let i = 13;
  const flags = b[10] ?? 0;
  if (flags & 0x80) i += 3 * (1 << ((flags & 0x07) + 1));
  let frames = 0;
  const skipSub = () => {
    while (i < b.length) {
      const n = b[i] ?? 0;
      i += 1;
      if (n === 0) return true;
      i += n;
    }
    return false;
  };
  while (i < b.length) {
    const t = b[i];
    if (t === 0x3b) return frames;
    if (t === 0x21) {
      i += 2;
      if (!skipSub()) return null;
    } else if (t === 0x2c) {
      frames += 1;
      const lf = b[i + 9] ?? 0;
      i += 10;
      if (lf & 0x80) i += 3 * (1 << ((lf & 0x07) + 1));
      i += 1; // LZW min code size
      if (!skipSub()) return null;
    } else return null;
  }
  return frames > 0 ? frames : null;
}

export function inspectCustomMedia(b: Uint8Array): CustomMediaInspection {
  if (!b || b.length === 0) return { ok: false, reason: "empty" };
  if (b.length > CUSTOM_MEDIA_MAX_BYTES) return { ok: false, reason: "too_large" };
  const kind = detect(b);
  if (!kind) return { ok: false, reason: "unsupported_type" };
  let w = 0;
  let h = 0;
  let animated = false;
  if (kind === "png") {
    if (b.length < 24 || String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0) !== "IHDR") return { ok: false, reason: "corrupt" };
    w = u32be(b, 16);
    h = u32be(b, 20);
  } else if (kind === "jpeg") {
    const s = jpegSize(b);
    if (!s) return { ok: false, reason: "corrupt" };
    w = s.w;
    h = s.h;
  } else {
    if (b.length < 14) return { ok: false, reason: "corrupt" };
    w = u16le(b, 6);
    h = u16le(b, 8);
    const frames = gifFrames(b);
    if (frames === null) return { ok: false, reason: "corrupt" };
    animated = frames > 1;
  }
  if (!(w > 0 && h > 0 && w <= CUSTOM_MEDIA_MAX_DIMENSION && h <= CUSTOM_MEDIA_MAX_DIMENSION)) return { ok: false, reason: "bad_dimensions" };
  return { ok: true, kind, mimeType: CUSTOM_MEDIA_MIME[kind], width: w, height: h, animated, bytes: b.length };
}

/** Generated, workspace-scoped storage path. Never derived from client names. */
export function customMediaStoragePath(workspaceId: string, assetId: string, kind: CustomMediaKind): string {
  return `${workspaceId}/custom-message-media/${assetId}.${kind === "jpeg" ? "jpg" : kind}`;
}

export function isWorkspaceCustomMediaPath(workspaceId: string, path: string): boolean {
  return new RegExp(`^${workspaceId}/custom-message-media/[0-9a-f-]{36}\\.(png|jpg|gif)$`).test(path);
}

/**
 * Pro gate from the authoritative evaluate_commercial_access result.
 * Allowed only for explicit UNRESTRICTED (platform owner) or an enforced,
 * allowed cartel_49 (Pro) result. Observe-mode would_block, errors and
 * malformed payloads fail closed.
 */
export const CUSTOM_MEDIA_FEATURE_KEY = "official_broadcasts";
export const CUSTOM_MEDIA_PRO_PLAN = "cartel_49";
export function customMediaEntitled(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  if (r["allowed"] !== true) return false;
  if (r["reason"] === "UNRESTRICTED" && r["mode"] === "unrestricted") return true;
  if (r["would_block"] === true) return false;
  return r["plan_code"] === CUSTOM_MEDIA_PRO_PLAN;
}
