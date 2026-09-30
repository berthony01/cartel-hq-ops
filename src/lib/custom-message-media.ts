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

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(b: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i += 1) c = (CRC_TABLE[(c ^ (b[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * STRUCTURAL PNG check (not a full pixel decode): signature, IHDR first
 * (13 bytes), every chunk in bounds with a valid CRC, at least one non-empty
 * IDAT, IEND last with nothing after it.
 */
function pngStructure(b: Uint8Array): { w: number; h: number } | null {
  let i = 8;
  let w = 0;
  let h = 0;
  let first = true;
  let idatBytes = 0;
  while (i + 12 <= b.length) {
    const len = u32be(b, i);
    const type = String.fromCharCode(b[i + 4] ?? 0, b[i + 5] ?? 0, b[i + 6] ?? 0, b[i + 7] ?? 0);
    const dataEnd = i + 8 + len;
    if (len > b.length || dataEnd + 4 > b.length) return null;
    if (crc32(b, i + 4, dataEnd) !== u32be(b, dataEnd)) return null;
    if (first) {
      if (type !== "IHDR" || len !== 13) return null;
      w = u32be(b, i + 8);
      h = u32be(b, i + 12);
      first = false;
    } else if (type === "IHDR") return null;
    if (type === "IDAT") idatBytes += len;
    if (type === "IEND") {
      if (len !== 0 || dataEnd + 4 !== b.length || idatBytes === 0) return null;
      return { w, h };
    }
    i = dataEnd + 4;
  }
  return null;
}

/**
 * STRUCTURAL JPEG check (not a full decode): marker segments in bounds, a
 * baseline/progressive SOF with components, an SOS after the SOF, non-empty
 * entropy-coded data, and an EOI marker ending the file.
 */
function jpegStructure(b: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  let size: { w: number; h: number } | null = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) { i += 1; continue; }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) return null;
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 8 || size) return null;
      const comps = b[i + 9] ?? 0;
      if (comps < 1 || len !== 8 + 3 * comps) return null;
      size = { h: u16be(b, i + 5), w: u16be(b, i + 7) };
    }
    if (marker === 0xda) {
      if (!size) return null;
      const dataStart = i + 2 + len;
      // Entropy data must be non-empty and the file must end with EOI.
      if (b.length - 2 <= dataStart) return null;
      if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
      return size;
    }
    i += 2 + len;
  }
  return null;
}

/**
 * STRUCTURAL GIF walk (not an LZW decode): logical screen + optional global
 * table in bounds, every block in bounds, each frame has non-zero size within
 * the logical screen, a colour table, and non-empty image data; trailer 0x3B
 * required. Returns frame count (>=1) or null.
 */
function gifStructure(b: Uint8Array, sw: number, sh: number): number | null {
  const flags = b[10] ?? 0;
  const hasGlobal = (flags & 0x80) !== 0;
  let i = 13;
  if (hasGlobal) i += 3 * (1 << ((flags & 0x07) + 1));
  if (i > b.length) return null;
  let frames = 0;
  const skipSub = (): number | null => {
    let total = 0;
    while (i < b.length) {
      const n = b[i] ?? 0;
      i += 1;
      if (n === 0) return total;
      if (i + n > b.length) return null;
      total += n;
      i += n;
    }
    return null;
  };
  while (i < b.length) {
    const t = b[i];
    if (t === 0x3b) return frames > 0 ? frames : null;
    if (t === 0x21) {
      if (i + 2 > b.length) return null;
      i += 2;
      if (skipSub() === null) return null;
    } else if (t === 0x2c) {
      if (i + 10 > b.length) return null;
      const left = u16le(b, i + 1);
      const top = u16le(b, i + 3);
      const fw = u16le(b, i + 5);
      const fh = u16le(b, i + 7);
      const lf = b[i + 9] ?? 0;
      if (fw === 0 || fh === 0 || left + fw > sw || top + fh > sh) return null;
      if (!(lf & 0x80) && !hasGlobal) return null;
      i += 10;
      if (lf & 0x80) i += 3 * (1 << ((lf & 0x07) + 1));
      if (i >= b.length) return null;
      const lzw = b[i] ?? 0;
      if (lzw < 2 || lzw > 11) return null;
      i += 1;
      const data = skipSub();
      if (data === null || data === 0) return null;
      frames += 1;
    } else return null;
  }
  return null; // missing trailer
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
    const s = pngStructure(b);
    if (!s) return { ok: false, reason: "corrupt" };
    w = s.w;
    h = s.h;
  } else if (kind === "jpeg") {
    const s = jpegStructure(b);
    if (!s) return { ok: false, reason: "corrupt" };
    w = s.w;
    h = s.h;
  } else {
    if (b.length < 14) return { ok: false, reason: "corrupt" };
    w = u16le(b, 6);
    h = u16le(b, 8);
    if (!(w > 0 && h > 0 && w <= CUSTOM_MEDIA_MAX_DIMENSION && h <= CUSTOM_MEDIA_MAX_DIMENSION)) return { ok: false, reason: "bad_dimensions" };
    const frames = gifStructure(b, w, h);
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
 * Pro gate from the authoritative LIVE evaluate_commercial_access result
 * (commercial_evaluate_workspace_feature schema). Positive-only predicate:
 *  - UNRESTRICTED: allowed===true, reason 'UNRESTRICTED', mode 'unrestricted'
 *    (platform owner bypass, evaluated first by the RPC), or
 *  - Pro: allowed===true, would_block===false, reason 'FEATURE_INCLUDED',
 *    feature_key 'official_broadcasts', plan_code 'cartel_49', kind 'feature',
 *    enabled===true, assignment_status active|trialing, mode===enforcement_mode
 *    in enforce|observe.
 * Anything else (errors, missing/extra-typed fields, observe would_block) fails closed.
 * Keep IDENTICAL to custom_media_gate_ok() in the staged SQL.
 */
export const CUSTOM_MEDIA_FEATURE_KEY = "official_broadcasts";
export const CUSTOM_MEDIA_PRO_PLAN = "cartel_49";
export function customMediaEntitled(result: unknown): boolean {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  if (r["allowed"] !== true) return false;
  if (r["reason"] === "UNRESTRICTED" && r["mode"] === "unrestricted") return true;
  return (
    r["would_block"] === false &&
    r["reason"] === "FEATURE_INCLUDED" &&
    r["feature_key"] === CUSTOM_MEDIA_FEATURE_KEY &&
    r["plan_code"] === CUSTOM_MEDIA_PRO_PLAN &&
    r["kind"] === "feature" &&
    r["enabled"] === true &&
    (r["assignment_status"] === "active" || r["assignment_status"] === "trialing") &&
    (r["mode"] === "enforce" || r["mode"] === "observe") &&
    r["enforcement_mode"] === r["mode"]
  );
}
