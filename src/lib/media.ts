import { supabase } from "@/integrations/supabase/client";

export const ASSETS_BUCKET = "workspace-assets";

/** Asset types supported by media_assets in Phase 1A. */
export const ASSET_TYPES = [
  "logo",
  "mascot",
  "reference_image",
  "generated_sticker",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  logo: "Logo",
  mascot: "Mascot",
  reference_image: "Reference image",
  generated_sticker: "Generated sticker",
  other: "Other",
};

/** Bucket limit is 25MB; keep the UI at or below it. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

export type MediaAsset = {
  id: string;
  workspace_id: string;
  storage_path: string;
  asset_type: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  created_at: string;
};

/** Storage folder for an asset type. Paths are always `{workspace_id}/{kind}/{uuid}.{ext}`. */
function folderFor(assetType: AssetType): string {
  return assetType === "reference_image" ? "reference" : assetType;
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop();
  if (fromName && /^[a-z0-9]{1,5}$/i.test(fromName)) return fromName.toLowerCase();
  const fromType = file.type.split("/").pop();
  return fromType && /^[a-z0-9]{1,5}$/i.test(fromType) ? fromType.toLowerCase() : "bin";
}

async function readDimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  if (typeof window === "undefined" || typeof createImageBitmap !== "function") {
    return { width: null, height: null };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  } catch {
    return { width: null, height: null };
  }
}

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Only image files can be uploaded in this phase.";
  if (file.size > MAX_UPLOAD_BYTES) return "That file is larger than the 25MB limit.";
  return null;
}

/**
 * Uploads to the private bucket under the active workspace prefix and records a
 * media_assets row. Raw paths are never user supplied.
 */
export async function uploadWorkspaceAsset(params: {
  workspaceId: string;
  userId: string;
  file: File;
  assetType: AssetType;
}): Promise<MediaAsset> {
  const { workspaceId, userId, file, assetType } = params;

  const invalid = validateImageFile(file);
  if (invalid) throw new Error(invalid);

  const path = `${workspaceId}/${folderFor(assetType)}/${crypto.randomUUID()}.${extensionFor(file)}`;

  const { error: uploadError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { width, height } = await readDimensions(file);

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      workspace_id: workspaceId,
      uploaded_by: userId,
      storage_path: path,
      asset_type: assetType,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      width,
      height,
    })
    .select("id,workspace_id,storage_path,asset_type,mime_type,width,height,file_size_bytes,created_at")
    .single();

  if (error) {
    // Best effort cleanup so we never leave an orphan object behind.
    await supabase.storage.from(ASSETS_BUCKET).remove([path]);
    throw error;
  }

  return data as MediaAsset;
}

export async function listWorkspaceAssets(workspaceId: string): Promise<MediaAsset[]> {
  const { data, error } = await supabase
    .from("media_assets")
    .select("id,workspace_id,storage_path,asset_type,mime_type,width,height,file_size_bytes,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as MediaAsset[];
}

/** Short-lived signed URL (60 seconds). */
export async function signedUrl(path: string, expiresIn = 60): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function signedUrlMap(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (paths.length === 0) return out;
  const { data } = await supabase.storage
    .from(ASSETS_BUCKET)
    .createSignedUrls(paths, 60);
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) out[entry.path] = entry.signedUrl;
  }
  return out;
}

export async function deleteWorkspaceAsset(asset: MediaAsset): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(ASSETS_BUCKET)
    .remove([asset.storage_path]);
  if (storageError) throw storageError;
  const { error } = await supabase.from("media_assets").delete().eq("id", asset.id);
  if (error) throw error;
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
