/**
 * MINI-HQ B1 — Mini App prepared custom message media (Brand tab).
 *
 * Authority: signed Telegram initData -> operator-scoped workspace set ->
 * linked CARTEL HQ user (existing miniAppCommercialActor). No client actor,
 * chat id or storage path is ever honoured. Upload + select require Pro or
 * platform-owner unrestricted access (fail closed). Nothing here sends a
 * Telegram message; senders do not read these selections yet.
 */
import { createServerFn } from "@tanstack/react-start";
import { isUuid, validateTelegramInitData } from "./telegram-miniapp-auth.server";
import {
  adminClient,
  botToken,
  fail,
  miniAppCommercialActor,
  type AdminClient,
  type MiniAppFailure,
} from "./telegram-miniapp-bridge.functions";
import {
  CUSTOM_MEDIA_ASSET_TYPE,
  CUSTOM_MEDIA_FEATURE_KEY,
  CUSTOM_MEDIA_MAX_BYTES,
  CUSTOM_MEDIA_PURPOSE,
  customMediaEntitled,
  customMediaStoragePath,
  inspectCustomMedia,
  isCustomMediaSlot,
  isWorkspaceCustomMediaPath,
  type CustomMediaSlot,
} from "./custom-message-media";

export const CUSTOM_MEDIA_SELECT_RPC = "set_workspace_custom_message_media";
const BUCKET = "workspace-assets";
const LIST_LIMIT = 12;

export type MiniAppCustomMediaAsset = {
  id: string;
  mimeType: string;
  animated: boolean;
  width: number | null;
  height: number | null;
  bytes: number;
  previewDataUrl: string | null;
};
export type MiniAppCustomMediaState = {
  ok: true;
  entitled: boolean;
  assets: MiniAppCustomMediaAsset[];
  selection: Record<CustomMediaSlot, string | null>;
  brandKitReady: boolean;
};

async function gate(
  initData: unknown,
  workspaceId: unknown,
): Promise<{ ok: true; admin: AdminClient; actorUserId: string; workspaceId: string; entitled: boolean } | MiniAppFailure> {
  const auth = await validateTelegramInitData(initData as string, botToken());
  if (!auth.ok) return fail(auth.reason);
  if (!isUuid(workspaceId)) return fail("invalid_workspace_id");
  const admin = await adminClient();
  const actor = await miniAppCommercialActor(admin, auth.user.id, workspaceId);
  if (!actor.ok) return actor;
  const { data, error } = await admin.rpc("evaluate_commercial_access", {
    _workspace_id: workspaceId,
    _feature_key: CUSTOM_MEDIA_FEATURE_KEY,
    _user_id: actor.actorUserId,
  });
  const entitled = !error && customMediaEntitled(data);
  return { ok: true, admin, actorUserId: actor.actorUserId, workspaceId, entitled };
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(value: string): Uint8Array | null {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export const miniAppCustomMediaState = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string }) => input)
  .handler(async ({ data }): Promise<MiniAppCustomMediaState | MiniAppFailure> => {
    const g = await gate(data?.initData, data?.workspaceId);
    if (!g.ok) return g;
    const [{ data: rows, error: assetError }, { data: kit, error: kitError }] = await Promise.all([
      g.admin
        .from("media_assets")
        .select("id, storage_path, mime_type, width, height, file_size_bytes, metadata")
        .eq("workspace_id", g.workspaceId)
        .eq("asset_type", CUSTOM_MEDIA_ASSET_TYPE)
        .eq("metadata->>purpose", CUSTOM_MEDIA_PURPOSE)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
      g.admin.from("brand_kits").select("metadata").eq("workspace_id", g.workspaceId).maybeSingle(),
    ]);
    if (assetError || kitError) return fail("unavailable");
    const assets: MiniAppCustomMediaAsset[] = [];
    for (const row of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
      const path = String(row["storage_path"] ?? "");
      const bytes = Number(row["file_size_bytes"] ?? 0);
      if (!isWorkspaceCustomMediaPath(g.workspaceId, path) || !(bytes > 0 && bytes <= CUSTOM_MEDIA_MAX_BYTES)) continue;
      let previewDataUrl: string | null = null;
      const { data: blob } = await g.admin.storage.from(BUCKET).download(path);
      if (blob && blob.size <= CUSTOM_MEDIA_MAX_BYTES) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const check = inspectCustomMedia(buf);
        if (check.ok) previewDataUrl = `data:${check.mimeType};base64,${toBase64(buf)}`;
      }
      const meta = (row["metadata"] ?? {}) as Record<string, unknown>;
      assets.push({
        id: String(row["id"]),
        mimeType: String(row["mime_type"] ?? ""),
        animated: meta["animated"] === true,
        width: typeof row["width"] === "number" ? (row["width"] as number) : null,
        height: typeof row["height"] === "number" ? (row["height"] as number) : null,
        bytes,
        previewDataUrl,
      });
    }
    const media = (((kit as Record<string, unknown> | null)?.["metadata"] ?? {}) as Record<string, unknown>)[
      "custom_message_media"
    ] as Record<string, { asset_id?: unknown }> | undefined;
    const pick = (slot: CustomMediaSlot) => {
      const id = String(media?.[slot]?.asset_id ?? "");
      return isUuid(id) ? id : null;
    };
    return {
      ok: true,
      entitled: g.entitled,
      assets,
      selection: { mission: pick("mission"), broadcast: pick("broadcast") },
      brandKitReady: Boolean(kit),
    };
  });

export const miniAppCustomMediaUpload = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string; fileBase64: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; assetId: string } | MiniAppFailure> => {
    const raw = typeof data?.fileBase64 === "string" ? data.fileBase64 : "";
    if (raw.length === 0 || raw.length > Math.ceil((CUSTOM_MEDIA_MAX_BYTES * 4) / 3) + 4) return fail("too_large");
    const g = await gate(data?.initData, data?.workspaceId);
    if (!g.ok) return g;
    if (!g.entitled) return fail("pro_required");
    const bytes = fromBase64(raw);
    if (!bytes) return fail("corrupt");
    const check = inspectCustomMedia(bytes);
    if (!check.ok) return fail(check.reason);
    const assetId = crypto.randomUUID();
    const path = customMediaStoragePath(g.workspaceId, assetId, check.kind);
    const { error: upErr } = await g.admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: check.mimeType, upsert: false });
    if (upErr) return fail("unavailable");
    const { error: insErr } = await g.admin.from("media_assets").insert({
      id: assetId,
      workspace_id: g.workspaceId,
      uploaded_by: g.actorUserId,
      storage_path: path,
      asset_type: CUSTOM_MEDIA_ASSET_TYPE,
      mime_type: check.mimeType,
      width: check.width,
      height: check.height,
      file_size_bytes: check.bytes,
      metadata: { purpose: CUSTOM_MEDIA_PURPOSE, animated: check.animated, source: "mini_app" },
    });
    if (insErr) {
      await g.admin.storage.from(BUCKET).remove([path]);
      return fail("unavailable");
    }
    return { ok: true, assetId };
  });

export const miniAppCustomMediaSelect = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string; slot: string; assetId: string | null }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | MiniAppFailure> => {
    if (!isCustomMediaSlot(data?.slot)) return fail("invalid_slot");
    const assetId = data?.assetId ?? null;
    if (assetId !== null && !isUuid(assetId)) return fail("invalid_asset");
    const g = await gate(data?.initData, data?.workspaceId);
    if (!g.ok) return g;
    if (assetId !== null && !g.entitled) return fail("pro_required");
    const { data: result, error } = await g.admin.rpc(CUSTOM_MEDIA_SELECT_RPC, {
      _workspace_id: g.workspaceId,
      _actor_user_id: g.actorUserId,
      _slot: data.slot,
      _asset_id: assetId,
    });
    if (error || !result || typeof result !== "object") return fail("unavailable");
    const r = result as Record<string, unknown>;
    if (r["ok"] !== true) {
      const reason = String(r["reason"] ?? "unavailable");
      return fail(reason === "PRO_REQUIRED" ? "pro_required" : reason === "BRAND_KIT_REQUIRED" ? "brand_kit_required" : reason === "ASSET_NOT_FOUND" ? "invalid_asset" : "unavailable");
    }
    return { ok: true };
  });
