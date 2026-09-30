/** MINI-HQ B1 — custom message media regression. No network, no database, no sends. */
import { readFileSync } from "node:fs";
import {
  CUSTOM_MEDIA_MAX_BYTES,
  customMediaEntitled,
  customMediaStoragePath,
  inspectCustomMedia,
  isCustomMediaSlot,
  isWorkspaceCustomMediaPath,
} from "../src/lib/custom-message-media";

let passed = 0;
const failures: string[] = [];
const check = (n: string, c: boolean) => (c ? passed++ : failures.push(n));

// ---- payload fixtures
const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const jpeg = (w: number, h: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xff, 0xd9]);
const gifFrame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
const gif = (frames: number) =>
  new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, ...Array(frames).fill(gifFrame).flat(), 0x3b]);

const p = inspectCustomMedia(png(512, 256));
check("PNG accepted with dimensions", p.ok && p.kind === "png" && p.width === 512 && p.height === 256 && !p.animated);
const j = inspectCustomMedia(jpeg(640, 480));
check("JPEG accepted with SOF dimensions", j.ok && j.kind === "jpeg" && j.width === 640 && j.height === 480);
const g1 = inspectCustomMedia(gif(1));
check("static GIF accepted, not animated", g1.ok && g1.kind === "gif" && !g1.animated);
const g2 = inspectCustomMedia(gif(3));
check("animated GIF detected", g2.ok && g2.animated);
check("SVG rejected", !inspectCustomMedia(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')).ok);
check("WebP/unknown rejected", !inspectCustomMedia(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")).ok);
check("empty rejected", (inspectCustomMedia(new Uint8Array()) as { reason?: string }).reason === "empty");
const big = new Uint8Array(CUSTOM_MEDIA_MAX_BYTES + 1); big.set(png(10, 10));
check("over 2 MiB rejected", (inspectCustomMedia(big) as { reason?: string }).reason === "too_large");
check("zero dimension rejected", (inspectCustomMedia(png(0, 10)) as { reason?: string }).reason === "bad_dimensions");
check("huge dimension rejected", (inspectCustomMedia(png(5000, 10)) as { reason?: string }).reason === "bad_dimensions");
check("truncated PNG rejected", !inspectCustomMedia(png(10, 10).subarray(0, 12)).ok);
check("truncated GIF rejected", !inspectCustomMedia(gif(1).subarray(0, 20)).ok);

// ---- entitlement (fail closed)
check("owner UNRESTRICTED allowed", customMediaEntitled({ allowed: true, reason: "UNRESTRICTED", mode: "unrestricted" }));
check("Pro enforced allowed", customMediaEntitled({ allowed: true, plan_code: "cartel_49", mode: "enforce", would_block: false }));
check("Free denied", !customMediaEntitled({ allowed: false, plan_code: "cartel_free", reason: "FEATURE_NOT_INCLUDED" }));
check("observe would_block denied", !customMediaEntitled({ allowed: true, plan_code: "cartel_free", mode: "observe", would_block: true }));
check("observe Pro with would_block denied", !customMediaEntitled({ allowed: true, plan_code: "cartel_49", mode: "observe", would_block: true }));
check("allowed but non-Pro plan denied", !customMediaEntitled({ allowed: true, plan_code: "cartel_free", mode: "enforce" }));
check("UNRESTRICTED without allowed denied", !customMediaEntitled({ allowed: false, reason: "UNRESTRICTED", mode: "unrestricted" }));
check("null/array/string denied", !customMediaEntitled(null) && !customMediaEntitled([]) && !customMediaEntitled("true"));
check("NOT_MEMBER denied", !customMediaEntitled({ allowed: false, reason: "NOT_MEMBER" }));

// ---- isolation helpers
const ws = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const aid = "33333333-3333-4333-8333-333333333333";
const path = customMediaStoragePath(ws, aid, "gif");
check("generated path is workspace-scoped", path === `${ws}/custom-message-media/${aid}.gif`);
check("path accepted for own workspace", isWorkspaceCustomMediaPath(ws, path));
check("path rejected for foreign workspace", !isWorkspaceCustomMediaPath(other, path));
check("traversal path rejected", !isWorkspaceCustomMediaPath(ws, `${ws}/custom-message-media/../x.png`));
check("slot allowlist", isCustomMediaSlot("mission") && isCustomMediaSlot("broadcast") && !isCustomMediaSlot("inbox") && !isCustomMediaSlot(null));

// ---- server function source invariants
const bridgeAll = readFileSync("src/lib/telegram-miniapp-bridge.functions.ts", "utf8");
const fn = bridgeAll.slice(bridgeAll.indexOf("MINI-HQ B1 — prepared custom message media"));
check("B1 section present in existing bridge", fn.length > 100);
const ui = readFileSync("src/components/telegram-miniapp/MiniAppCustomMedia.tsx", "utf8");
const home = readFileSync("src/routes/tg.index.tsx", "utf8");
const sql = readFileSync("docs/sql/MINI_HQ_B1_custom_message_media.sql", "utf8");
check("initData validated before anything", /validateTelegramInitData[\s\S]*miniAppCommercialActor/.test(fn));
check("actor resolved via operator workspace RPC helper", /miniAppCommercialActor\(admin, auth\.user\.id, workspaceId\)/.test(fn));
check("upload requires entitlement", /miniAppCustomMediaUpload[\s\S]*if \(!g\.entitled\) return fail\("pro_required"\)/.test(fn));
check("select requires entitlement for non-null asset", /assetId !== null && !g\.entitled/.test(fn));
check("upload validates decoded bytes", /inspectCustomMedia\(bytes\)/.test(fn));
check("upload uses generated path, no upsert", /customMediaStoragePath\(g\.workspaceId, assetId/.test(fn) && /upsert: false/.test(fn));
check("existing private bucket reused", /"workspace-assets"/.test(fn));
check("listing workspace-bound", /eq\("workspace_id", g\.workspaceId\)/.test(fn) && /isWorkspaceCustomMediaPath\(g\.workspaceId/.test(fn));
check("no client actor/chat/path inputs", !/inputValidator\(\(input: \{[^}]*(actor|chat|path|userId)/i.test(fn) && !/telegram_chat_id/.test(fn));
check("no Telegram send in B1", !/sendPhoto|sendAnimation|sendMessage|api\.telegram\.org|functions\/v1/.test(fn + ui));
check("UI labels prepared/pending", /Prepared media only/.test(ui) && /coming later/.test(ui));
check("UI accepts only PNG/JPEG/GIF", /accept="image\/png,image\/jpeg,image\/gif"/.test(ui));
check("UI has accessible label + status", /htmlFor="miniapp-custom-media-file"/.test(ui) && /role="status"/.test(ui));
check("five primary tabs retained", /\["home", "missions", "inbox", "brand", "more"\]/.test(home));
check("panel resets per workspace", /<MiniAppCustomMedia key=\{workspaceId\}/.test(home));
check("SQL service-only", /REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/.test(sql) && /TO service_role;/.test(sql) && !/TO authenticated/.test(sql.replace(/FROM PUBLIC, anon, authenticated/, "")));
check("SQL fixed empty search_path + definer", /SECURITY DEFINER/.test(sql) && /SET search_path TO ''/.test(sql));
check("SQL operator or owner check", /has_platform_unrestricted_access\(_actor_user_id\)[\s\S]*is_workspace_operator\(_workspace_id, _actor_user_id\)/.test(sql));
check("SQL Pro gate fail-closed incl. would_block", /evaluate_commercial_access\(_workspace_id, 'official_broadcasts'/.test(sql) && /would_block/.test(sql));
check("SQL asset same workspace + purpose + size", /workspace_id = _workspace_id/.test(sql) && /'custom_message_media'/.test(sql) && /2097152/.test(sql));
check("SQL atomic narrow JSON update", /jsonb_set\([\s\S]*'\{custom_message_media\}'/.test(sql) && !/SET metadata = '\{/.test(sql));
check("SQL no schema/RLS change", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY/.test(sql));
check("SQL has rollback", /Rollback:[\s\S]*DROP FUNCTION IF EXISTS public\.set_workspace_custom_message_media/.test(sql));

// ---- senders untouched
for (const f of ["telegram-group", "social-mission-telegram", "social-mission-runner"]) {
  const src = readFileSync(`backend-source/edge-functions/${f}/index.ts`, "utf8");
  check(`${f} does not read custom media yet`, !/custom_message_media/.test(src));
}

console.log(failures.length ? `FAIL\n- ${failures.join("\n- ")}` : "");
console.log(`${passed}/${passed + failures.length} MINI-HQ B1 checks passed`);
if (failures.length) process.exit(1);
