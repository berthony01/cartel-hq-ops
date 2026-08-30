import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Phase 6 — public read-only logo proxy for the Cartel Network.
 *
 * Streams ONLY the selected logo of a Published Project Profile out of the
 * private `workspace-assets` bucket. It never returns or redirects to a raw
 * storage path, signed URL, workspace id or asset id, and it never reveals why
 * a request failed. The bucket stays private; there is no anonymous storage
 * policy anywhere in this design.
 */

const BUCKET = "workspace-assets";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "X-Content-Type-Options": "nosniff",
};

function fail(status: number) {
  return new Response(status === 404 ? "Not found" : "Unavailable", {
    status,
    headers: { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function isValidSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && SLUG_PATTERN.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: baseHeaders });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: baseHeaders });
  }

  const slug = (new URL(req.url).searchParams.get("slug") ?? "").trim().toLowerCase();
  if (!isValidSlug(slug)) return fail(404);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY) return fail(500);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: profile, error: profileError } = await admin
      .from("project_profiles")
      .select("workspace_id,logo_asset_id,discovery_status")
      .eq("public_slug", slug)
      .eq("discovery_status", "published")
      .maybeSingle();
    if (profileError) return fail(500);
    if (!profile || !profile.logo_asset_id) return fail(404);

    const { data: asset, error: assetError } = await admin
      .from("media_assets")
      .select("id,workspace_id,asset_type,storage_path,mime_type")
      .eq("id", profile.logo_asset_id)
      .eq("workspace_id", profile.workspace_id)
      .eq("asset_type", "logo")
      .maybeSingle();
    if (assetError) return fail(500);
    if (!asset || !asset.storage_path) return fail(404);

    const { data: blob, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(asset.storage_path);
    if (downloadError || !blob) return fail(404);

    const contentType = asset.mime_type || blob.type || "application/octet-stream";
    const headers = {
      ...baseHeaders,
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    };

    if (req.method === "HEAD") return new Response(null, { status: 200, headers });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new Response(bytes, { status: 200, headers });
  } catch {
    return fail(500);
  }
});
