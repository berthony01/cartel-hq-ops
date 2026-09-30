/**
 * B2 + B4 — prepared custom message media for the EXISTING senders
 * (`social-mission-telegram` and `telegram-group`). Service-role only.
 *
 * Repository parity copy: keep byte-identical with
 * backend-source/edge-functions/_shared/custom-message-media.ts.
 *
 * Invariants mirrored from B1 (`set_workspace_custom_message_media`):
 *  - asset lives in the SAME workspace, asset_type 'other',
 *    metadata.purpose 'custom_message_media';
 *  - MIME image/png | image/jpeg | image/gif, size 1..2097152, dims 1..4096;
 *  - storage_path is exactly <workspace>/custom-message-media/<asset_id>.<ext>;
 *  - the Pro gate is evaluate_commercial_access(... 'official_broadcasts' ...)
 *    passed through public.custom_media_gate_ok, fail closed on anything else.
 *
 * A prepared selection is NEVER silently ignored or substituted: every failure
 * is returned as an explicit error and the caller refuses to claim or send.
 */

export const CUSTOM_MEDIA_BUCKET = "workspace-assets";
export const CUSTOM_MEDIA_MAX_BYTES = 2_097_152;
export const CUSTOM_MEDIA_MAX_DIMENSION = 4096;
export const CUSTOM_MEDIA_PURPOSE = "custom_message_media";
export const CUSTOM_MEDIA_FEATURE_KEY = "official_broadcasts";

export type CustomMediaSlot = "mission" | "broadcast";
export type CustomMediaTransport = "PHOTO" | "ANIMATION";

const MIME_EXT: Record<string, "png" | "jpg" | "gif"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ValidatedCustomMedia = {
  assetId: string;
  storagePath: string;
  mimeType: string;
  transport: CustomMediaTransport;
  fileName: string;
};

export type PreparedCustomMediaResult =
  | { state: "none" }
  | { state: "ready"; media: ValidatedCustomMedia; bytes: Uint8Array }
  | { state: "error"; code: string; message: string };

// deno-lint-ignore no-explicit-any
type AdminLike = any;

export function customMediaTransportForMime(mime: unknown): CustomMediaTransport | null {
  if (typeof mime !== "string") return null;
  const m = mime.toLowerCase();
  if (m === "image/gif") return "ANIMATION";
  if (m === "image/png" || m === "image/jpeg") return "PHOTO";
  return null;
}

export function expectedCustomMediaPath(workspaceId: string, assetId: string, mime: string): string | null {
  const ext = MIME_EXT[mime.toLowerCase()];
  if (!ext || !UUID_RE.test(workspaceId) || !UUID_RE.test(assetId)) return null;
  return `${workspaceId}/custom-message-media/${assetId}.${ext}`;
}

function fileNameFor(mime: string): string {
  const ext = MIME_EXT[mime] ?? "bin";
  return `media.${ext}`;
}

/** Validates one media_assets row against the exact B1 invariants. */
export function validateCustomMediaRow(
  row: Record<string, unknown> | null | undefined,
  workspaceId: string,
  assetId: string,
): { ok: true; media: ValidatedCustomMedia } | { ok: false; reason: string } {
  if (!row) return { ok: false, reason: "ASSET_NOT_FOUND" };
  if (row["id"] !== assetId || row["workspace_id"] !== workspaceId) return { ok: false, reason: "ASSET_NOT_FOUND" };
  if (row["asset_type"] !== "other") return { ok: false, reason: "ASSET_WRONG_TYPE" };
  const meta = row["metadata"];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return { ok: false, reason: "ASSET_WRONG_PURPOSE" };
  if ((meta as Record<string, unknown>)["purpose"] !== CUSTOM_MEDIA_PURPOSE) return { ok: false, reason: "ASSET_WRONG_PURPOSE" };
  const mime = typeof row["mime_type"] === "string" ? (row["mime_type"] as string) : "";
  const transport = customMediaTransportForMime(mime);
  if (!transport || mime !== mime.toLowerCase()) return { ok: false, reason: "ASSET_WRONG_MIME" };
  const size = row["file_size_bytes"];
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > CUSTOM_MEDIA_MAX_BYTES) {
    return { ok: false, reason: "ASSET_BAD_SIZE" };
  }
  const w = row["width"];
  const h = row["height"];
  if (
    typeof w !== "number" || typeof h !== "number" || !Number.isInteger(w) || !Number.isInteger(h) ||
    w < 1 || h < 1 || w > CUSTOM_MEDIA_MAX_DIMENSION || h > CUSTOM_MEDIA_MAX_DIMENSION
  ) {
    return { ok: false, reason: "ASSET_BAD_DIMENSIONS" };
  }
  const expected = expectedCustomMediaPath(workspaceId, assetId, mime);
  if (!expected || row["storage_path"] !== expected) return { ok: false, reason: "ASSET_BAD_PATH" };
  return { ok: true, media: { assetId, storagePath: expected, mimeType: mime, transport, fileName: fileNameFor(mime) } };
}

/**
 * Validates a DURABLE snapshot (target / ledger) without trusting any current
 * selection. A nulled FK (deleted asset) is allowed: the immutable path + mime
 * are the identity. A non-null FK must agree with the path.
 */
export function validateCustomMediaSnapshot(
  workspaceId: string,
  assetId: unknown,
  storagePath: unknown,
  mime: unknown,
): { ok: true; media: ValidatedCustomMedia } | { ok: false; reason: string } {
  if (typeof storagePath !== "string" || typeof mime !== "string") return { ok: false, reason: "SNAPSHOT_MISSING" };
  const transport = customMediaTransportForMime(mime);
  if (!transport || mime !== mime.toLowerCase()) return { ok: false, reason: "SNAPSHOT_BAD_MIME" };
  const m = /^([0-9a-f-]{36})\/custom-message-media\/([0-9a-f-]{36})\.(png|jpg|gif)$/.exec(storagePath);
  if (!m || m[1] !== workspaceId) return { ok: false, reason: "SNAPSHOT_BAD_PATH" };
  const pathAssetId = m[2]!;
  if (expectedCustomMediaPath(workspaceId, pathAssetId, mime) !== storagePath) return { ok: false, reason: "SNAPSHOT_BAD_PATH" };
  if (assetId !== null && assetId !== undefined && assetId !== pathAssetId) return { ok: false, reason: "SNAPSHOT_BAD_PATH" };
  return { ok: true, media: { assetId: pathAssetId, storagePath, mimeType: mime, transport, fileName: fileNameFor(mime) } };
}

/** Reads brand_kits.metadata.custom_message_media.<slot>.asset_id. */
export function readPreparedSelection(
  metadata: unknown,
  slot: CustomMediaSlot,
): { state: "none" } | { state: "selected"; assetId: string } | { state: "invalid" } {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { state: "none" };
  const cmm = (metadata as Record<string, unknown>)["custom_message_media"];
  if (cmm === undefined || cmm === null) return { state: "none" };
  if (typeof cmm !== "object" || Array.isArray(cmm)) return { state: "invalid" };
  const entry = (cmm as Record<string, unknown>)[slot];
  if (entry === undefined || entry === null) return { state: "none" };
  if (typeof entry !== "object" || Array.isArray(entry)) return { state: "invalid" };
  const id = (entry as Record<string, unknown>)["asset_id"];
  if (id === undefined || id === null) return { state: "none" };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { state: "invalid" };
  return { state: "selected", assetId: id };
}

export function bytesMatchMime(b: Uint8Array, mime: string): boolean {
  if (mime === "image/png") return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === "image/jpeg") return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/gif") return b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
  return false;
}

/** Downloads exactly one validated object and re-checks size + signature. */
export async function downloadCustomMedia(
  admin: AdminLike,
  media: ValidatedCustomMedia,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  try {
    const { data, error } = await admin.storage.from(CUSTOM_MEDIA_BUCKET).download(media.storagePath);
    if (error || !data) return { ok: false, message: "The prepared custom media file could not be read." };
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.byteLength === 0) return { ok: false, message: "The prepared custom media file is empty." };
    if (bytes.byteLength > CUSTOM_MEDIA_MAX_BYTES) return { ok: false, message: "The prepared custom media file is larger than 2 MB." };
    if (!bytesMatchMime(bytes, media.mimeType)) return { ok: false, message: "The prepared custom media file does not match its recorded type." };
    return { ok: true, bytes };
  } catch {
    return { ok: false, message: "The prepared custom media file could not be read." };
  }
}

async function readSelection(admin: AdminLike, workspaceId: string, slot: CustomMediaSlot) {
  const { data, error } = await admin.from("brand_kits").select("workspace_id, metadata").eq("workspace_id", workspaceId).maybeSingle();
  if (error) return { state: "error" as const };
  if (!data) return { state: "none" as const };
  return readPreparedSelection((data as Record<string, unknown>)["metadata"], slot);
}

/**
 * Resolves the CURRENT prepared selection for a NEW send.
 * `none` only when no selection exists — the caller keeps its legacy path.
 * When `expected` is supplied (broadcast reviewed intent) the current selection
 * must equal it exactly.
 */
export async function loadPreparedCustomMedia(
  admin: AdminLike,
  workspaceId: string,
  slot: CustomMediaSlot,
  actorUserId: string,
  expected?: { assetId: string; mimeType: string },
): Promise<PreparedCustomMediaResult> {
  const err = (code: string, message: string): PreparedCustomMediaResult => ({ state: "error", code, message });
  try {
    const first = await readSelection(admin, workspaceId, slot);
    if (first.state === "error") return err("CUSTOM_MEDIA_UNAVAILABLE", "Could not read the prepared custom media selection. Nothing was sent.");
    if (first.state === "invalid") return err("CUSTOM_MEDIA_INVALID", "The prepared custom media selection is invalid. Clear or reselect it. Nothing was sent.");
    if (first.state === "none") {
      if (expected) return err("CUSTOM_MEDIA_CHANGED", "The prepared custom media changed since you reviewed it. Review again. Nothing was sent.");
      return { state: "none" };
    }

    // a) Pro / owner gate, fail closed.
    const { data: gate, error: gateError } = await admin.rpc("evaluate_commercial_access", {
      _workspace_id: workspaceId,
      _feature_key: CUSTOM_MEDIA_FEATURE_KEY,
      _user_id: actorUserId,
    });
    if (gateError || gate === null || gate === undefined) {
      return err("CUSTOM_MEDIA_PRO_REQUIRED", "Custom message media needs CARTEL Pro. Nothing was sent.");
    }
    const { data: gateOk, error: gateOkError } = await admin.rpc("custom_media_gate_ok", { _g: gate });
    if (gateOkError || gateOk !== true) {
      return err("CUSTOM_MEDIA_PRO_REQUIRED", "Custom message media needs CARTEL Pro. Nothing was sent.");
    }

    // b) Re-read the selection after the gate.
    const second = await readSelection(admin, workspaceId, slot);
    if (second.state !== "selected" || second.assetId !== first.assetId) {
      return err("CUSTOM_MEDIA_CHANGED", "The prepared custom media changed while sending. Review again. Nothing was sent.");
    }
    if (expected && expected.assetId !== second.assetId) {
      return err("CUSTOM_MEDIA_CHANGED", "The prepared custom media changed since you reviewed it. Review again. Nothing was sent.");
    }

    // c) + d) Exact same-workspace row with B1 invariants.
    const { data: row, error: rowError } = await admin
      .from("media_assets")
      .select("id, workspace_id, asset_type, storage_path, mime_type, file_size_bytes, width, height, metadata")
      .eq("id", second.assetId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (rowError) return err("CUSTOM_MEDIA_UNAVAILABLE", "Could not read the prepared custom media. Nothing was sent.");
    const checked = validateCustomMediaRow(row as Record<string, unknown> | null, workspaceId, second.assetId);
    if (!checked.ok) return err("CUSTOM_MEDIA_INVALID", `The prepared custom media is not usable (${checked.reason}). Nothing was sent.`);
    if (expected && expected.mimeType.toLowerCase() !== checked.media.mimeType) {
      return err("CUSTOM_MEDIA_CHANGED", "The prepared custom media changed since you reviewed it. Review again. Nothing was sent.");
    }

    // e) Private download, non-empty, <= 2 MiB, signature matches.
    const dl = await downloadCustomMedia(admin, checked.media);
    if (!dl.ok) return err("CUSTOM_MEDIA_UNAVAILABLE", `${dl.message} Nothing was sent.`);
    return { state: "ready", media: checked.media, bytes: dl.bytes };
  } catch {
    return err("CUSTOM_MEDIA_UNAVAILABLE", "Could not prepare the custom media. Nothing was sent.");
  }
}

/** Builds the single multipart body for sendPhoto / sendAnimation. */
export function customMediaForm(
  media: ValidatedCustomMedia,
  bytes: Uint8Array,
  chatId: string,
  caption: string,
  replyMarkup: unknown,
): { method: "sendPhoto" | "sendAnimation"; form: FormData } {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
  const field = media.transport === "ANIMATION" ? "animation" : "photo";
  form.append(field, new Blob([bytes as BlobPart], { type: media.mimeType }), media.fileName);
  return { method: media.transport === "ANIMATION" ? "sendAnimation" : "sendPhoto", form };
}
