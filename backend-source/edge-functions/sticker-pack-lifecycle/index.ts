// CARTEL HQ — Sticker pack lifecycle (inspect / archive / restore / delete).
//
// All authorization and eligibility lives in SECURITY DEFINER RPCs called with
// the CALLER's own token, so the UI cannot bypass any rule. The service-role
// client is used for exactly one thing: removing the storage objects that the
// delete RPC already committed as removable.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ASSETS_BUCKET = "workspace-assets";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Postgres errcode -> stable client-facing shape. */
function rpcFailure(error: { code?: string; message?: string } | null) {
  const code = error?.code ?? "";
  if (code === "42501") return respond({ error: "FORBIDDEN", message: "Only project owners and admins can do that." }, 403);
  if (code === "P0002") return respond({ error: "NOT_FOUND", message: "That pack no longer exists." }, 404);
  if (code === "22023") return respond({ error: "NOT_ALLOWED", message: error?.message ?? "That action is not allowed right now." }, 409);
  console.error("sticker-pack-lifecycle rpc failure", error);
  return respond({ error: "OPERATION_FAILED", message: "That action could not be completed." }, 500);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return respond({ error: "UNAUTHENTICATED", message: "Sign in to CARTEL HQ first." }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return respond({ error: "UNAUTHENTICATED", message: "Your session expired. Sign in again." }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return respond({ error: "INVALID_BODY", message: "Invalid request." }, 400);
  }

  const action = String(body.action ?? "inspect");
  const packId = String(body.packId ?? "");
  if (!UUID_RE.test(packId)) {
    return respond({ error: "PACK_REQUIRED", message: "A valid pack is required." }, 400);
  }

  // Every action starts from server truth.
  const stateRes = await userClient.rpc("sticker_pack_lifecycle_state", { _pack_id: packId });
  if (stateRes.error) return rpcFailure(stateRes.error);
  const state = stateRes.data as Record<string, unknown>;

  if (action === "inspect") {
    return respond({ ok: true, state });
  }

  if (action === "archive") {
    const { data, error } = await userClient.rpc("archive_sticker_pack", { _pack_id: packId });
    if (error) return rpcFailure(error);
    const after = await userClient.rpc("sticker_pack_lifecycle_state", { _pack_id: packId });
    return respond({ ok: true, result: data, state: after.error ? state : after.data });
  }

  if (action === "restore") {
    const { data, error } = await userClient.rpc("restore_sticker_pack", { _pack_id: packId });
    if (error) return rpcFailure(error);
    const after = await userClient.rpc("sticker_pack_lifecycle_state", { _pack_id: packId });
    return respond({ ok: true, result: data, state: after.error ? state : after.data });
  }

  if (action === "delete") {
    const { data, error } = await userClient.rpc("delete_sticker_pack_if_eligible", { _pack_id: packId });
    if (error) return rpcFailure(error);

    const result = (data ?? {}) as { deleted?: boolean; archive_required?: boolean; blocking_reasons?: string[]; storage_paths?: string[] };
    if (!result.deleted) {
      return respond({
        ok: false,
        deleted: false,
        archive_required: true,
        blocking_reasons: result.blocking_reasons ?? [],
        message: "This pack has published or delivered history. Archive it instead.",
      }, 409);
    }

    // DB delete is already committed. Storage cleanup is best effort: an orphaned
    // private object is strictly safer than reporting a completed delete as failed.
    let storageCleanupPending = false;
    const paths = (result.storage_paths ?? []).filter((p) => typeof p === "string" && p.length > 0);
    if (paths.length > 0) {
      try {
        const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error: storageError } = await admin.storage.from(ASSETS_BUCKET).remove(paths);
        if (storageError) {
          storageCleanupPending = true;
          console.error("sticker-pack-lifecycle storage cleanup failed", packId, storageError);
        }
      } catch (err) {
        storageCleanupPending = true;
        console.error("sticker-pack-lifecycle storage cleanup threw", packId, err);
      }
    }

    return respond({
      ok: true,
      deleted: true,
      removed_images: paths.length,
      storage_cleanup_pending: storageCleanupPending,
    });
  }

  return respond({ error: "UNKNOWN_ACTION", message: "Unsupported action." }, 400);
});
