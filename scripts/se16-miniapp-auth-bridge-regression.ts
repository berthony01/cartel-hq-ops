/**
 * SE-16.0 — Telegram Mini App auth bridge regression (repo-only).
 *
 * Zero network, zero database, zero Telegram, zero provider access. The pure
 * validator is imported and executed against locally generated HMAC fixtures
 * with a fake bot token; the server-function module is asserted statically,
 * because importing it would pull the TanStack server runtime.
 */

import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  buildDataCheckString,
  computeInitDataHash,
  constantTimeEqualHex,
  isRequestId,
  isUuid,
  miniAppIdempotencyKey,
  validateTelegramInitData,
  INIT_DATA_MAX_LENGTH,
} from "../src/lib/telegram-miniapp-auth.server.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const authSrc = readFileSync("src/lib/telegram-miniapp-auth.server.ts", "utf8");
const bridgeSrc = readFileSync("src/lib/telegram-miniapp-bridge.functions.ts", "utf8");

/** Comments must never satisfy or break a structural assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const authCode = stripComments(authSrc);
const bridgeCode = stripComments(bridgeSrc);

/* --------------------------------------------- 1. fixture generation */

const FAKE_TOKEN = "123456:FAKE-TEST-TOKEN-se16";

/** Independent reference implementation of the official bot-token algorithm. */
function referenceHash(fields: Record<string, string>, token: string): string {
  const dcs = Object.keys(fields)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return createHmac("sha256", secret).update(dcs).digest("hex");
}

function encode(fields: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.append(k, v);
  return params.toString();
}

const NOW_MS = 1_760_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function fixture(overrides: Record<string, string> = {}, token = FAKE_TOKEN) {
  const fields: Record<string, string> = {
    auth_date: String(NOW_S - 30),
    query_id: "AAF_test",
    user: JSON.stringify({ id: 777000123, first_name: "Bert", username: "bert" }),
    ...overrides,
  };
  delete fields["hash"];
  const signed = { ...fields, hash: referenceHash(fields, token) };
  return { fields: signed, raw: encode(signed) };
}

const opts = { now: NOW_MS };

/* --------------------------------------------- 2. validator behavior */

{
  const ok = await validateTelegramInitData(fixture().raw, FAKE_TOKEN, opts);
  check("2.1 valid signed initData accepted", ok.ok === true);
  check("2.2 validated user id returned", ok.ok === true && ok.user.id === 777000123);
  check("2.3 result carries no secret", JSON.stringify(ok).includes(FAKE_TOKEN) === false);
  // Exact success envelope: bounded fields only, no signed payload, no secret.
  const topKeys = Object.keys(ok).sort();
  check(
    "2.4a success result exposes exactly ok/authDate/user",
    JSON.stringify(topKeys) === JSON.stringify(["authDate", "ok", "user"]),
    topKeys.join(","),
  );
  const userKeys = ok.ok === true ? Object.keys(ok.user).sort() : [];
  check(
    "2.4b validated user exposes exactly the bounded profile fields",
    JSON.stringify(userKeys) ===
      JSON.stringify(["firstName", "id", "isPremium", "languageCode", "lastName", "username"]),
    userKeys.join(","),
  );
  const flat = JSON.stringify(ok);
  check(
    "2.4c success result leaks no hash, raw init data, query id or token",
    !topKeys.includes("hash") &&
      !topKeys.includes("initData") &&
      !topKeys.includes("query_id") &&
      !/[0-9a-f]{64}/.test(flat) &&
      !flat.includes("query_id") &&
      !flat.includes("AAF_test") &&
      !flat.includes(FAKE_TOKEN) &&
      !flat.includes("FAKE-TEST-TOKEN"),
  );
}

{
  const f = fixture();
  const tampered = f.raw.replace("Bert", "Evil");
  const res = await validateTelegramInitData(tampered, FAKE_TOKEN, opts);
  check("2.5 tampered user rejected", res.ok === false && res.reason === "bad_signature");
}

{
  const f = fixture();
  const params = new URLSearchParams(f.raw);
  params.set("auth_date", String(NOW_S - 10));
  const res = await validateTelegramInitData(params.toString(), FAKE_TOKEN, opts);
  check("2.6 tampered auth_date rejected", res.ok === false && res.reason === "bad_signature");
}

{
  const f = fixture();
  const params = new URLSearchParams(f.raw);
  const hash = params.get("hash")!;
  params.set("hash", hash.slice(0, 63) + (hash.endsWith("a") ? "b" : "a"));
  const res = await validateTelegramInitData(params.toString(), FAKE_TOKEN, opts);
  check("2.7 tampered hash rejected", res.ok === false && res.reason === "bad_signature");
}

{
  const stale = fixture({ auth_date: String(NOW_S - 16 * 60) });
  const res = await validateTelegramInitData(stale.raw, FAKE_TOKEN, opts);
  check("2.8 stale auth_date rejected", res.ok === false && res.reason === "stale_auth_date");
  const edge = fixture({ auth_date: String(NOW_S - 14 * 60) });
  const okEdge = await validateTelegramInitData(edge.raw, FAKE_TOKEN, opts);
  check("2.9 fresh payload inside the window accepted", okEdge.ok === true);
}

{
  const future = fixture({ auth_date: String(NOW_S + 600) });
  const res = await validateTelegramInitData(future.raw, FAKE_TOKEN, opts);
  check("2.10 excessive future skew rejected", res.ok === false && res.reason === "future_auth_date");
  const small = fixture({ auth_date: String(NOW_S + 30) });
  const okSmall = await validateTelegramInitData(small.raw, FAKE_TOKEN, opts);
  check("2.11 small future skew tolerated", okSmall.ok === true);
}

{
  const params = new URLSearchParams(fixture().raw);
  params.delete("hash");
  const res = await validateTelegramInitData(params.toString(), FAKE_TOKEN, opts);
  check("2.12 missing hash rejected", res.ok === false && res.reason === "missing_hash");
}

{
  const params = new URLSearchParams(fixture().raw);
  params.delete("user");
  const res = await validateTelegramInitData(params.toString(), FAKE_TOKEN, opts);
  check("2.13 missing user rejected", res.ok === false && res.reason === "missing_user");

  const bad = fixture({ user: "{not json" });
  const res2 = await validateTelegramInitData(bad.raw, FAKE_TOKEN, opts);
  check("2.14 malformed user rejected", res2.ok === false && res2.reason === "malformed_user");

  const arr = fixture({ user: JSON.stringify([1, 2]) });
  const res3 = await validateTelegramInitData(arr.raw, FAKE_TOKEN, opts);
  check("2.15 array user rejected", res3.ok === false && res3.reason === "malformed_user");
}

{
  const params = new URLSearchParams(fixture().raw);
  params.delete("auth_date");
  const res = await validateTelegramInitData(params.toString(), FAKE_TOKEN, opts);
  check("2.16 missing auth_date rejected", res.ok === false && res.reason === "missing_auth_date");

  const bad = fixture({ auth_date: "not-a-number" });
  const res2 = await validateTelegramInitData(bad.raw, FAKE_TOKEN, opts);
  check("2.17 non-numeric auth_date rejected", res2.ok === false && res2.reason === "invalid_auth_date");
}

{
  const big = fixture({ user: JSON.stringify({ id: 8_000_000_000, first_name: "Big" }) });
  const res = await validateTelegramInitData(big.raw, FAKE_TOKEN, opts);
  check("2.18 >32-bit safe Telegram id accepted", res.ok === true && res.user.id === 8_000_000_000);

  const unsafe = fixture({ user: '{"id":9007199254740993,"first_name":"X"}' });
  const res2 = await validateTelegramInitData(unsafe.raw, FAKE_TOKEN, opts);
  check("2.19 unsafe integer id rejected", res2.ok === false && res2.reason === "invalid_user_id");

  const negative = fixture({ user: JSON.stringify({ id: -5 }) });
  const res3 = await validateTelegramInitData(negative.raw, FAKE_TOKEN, opts);
  check("2.20 non-positive id rejected", res3.ok === false && res3.reason === "invalid_user_id");
}

{
  for (const key of ["hash", "auth_date", "user"]) {
    const f = fixture();
    const raw = `${f.raw}&${key}=${encodeURIComponent("duplicate")}`;
    const res = await validateTelegramInitData(raw, FAKE_TOKEN, opts);
    check(`2.21 duplicate ${key} rejected`, res.ok === false && res.reason === "duplicate_field");
  }
}

{
  const res = await validateTelegramInitData(fixture().raw, "", opts);
  check("2.22 missing bot token fails closed", res.ok === false && res.reason === "missing_bot_token");
  const res2 = await validateTelegramInitData("", FAKE_TOKEN, opts);
  check("2.23 empty initData rejected", res2.ok === false && res2.reason === "missing_init_data");
  const res3 = await validateTelegramInitData("x".repeat(INIT_DATA_MAX_LENGTH + 1), FAKE_TOKEN, opts);
  check("2.24 oversized initData rejected", res3.ok === false && res3.reason === "init_data_too_large");
  const res4 = await validateTelegramInitData(fixture().raw, "different-token", opts);
  check("2.25 wrong bot token rejected", res4.ok === false && res4.reason === "bad_signature");
}

/* --------------------------------- 3. data-check-string: hash out, signature IN */

{
  const withSig = fixture({ signature: "ed25519-third-party-value" });
  const res = await validateTelegramInitData(withSig.raw, FAKE_TOKEN, opts);
  check("3.1 signature field is part of the bot-token HMAC input", res.ok === true);

  const dcs = buildDataCheckString(new URLSearchParams(withSig.raw));
  check("3.2 data-check-string excludes hash", !dcs.includes("hash="));
  check("3.3 data-check-string includes signature", dcs.includes("signature=ed25519-third-party-value"));
  const lines = dcs.split("\n");
  check("3.4 data-check-string sorted alphabetically", lines.join("\n") === [...lines].sort().join("\n"));
  check("3.5 data-check-string joined with newlines as key=value", lines.every((l) => l.includes("=")));

  const computed = await computeInitDataHash(dcs, FAKE_TOKEN);
  check("3.6 computed hash matches independent reference", computed === referenceHash(withSig.fields, FAKE_TOKEN));
  check(
    "3.7 secret key derived from raw HMAC bytes, not hex",
    /hmacSha256\("WebAppData", botToken\)/.test(authCode) && !/toHex\(await hmacSha256\("WebAppData"/.test(authCode),
  );
}

/* ----------------------------------------- 4. constant-time comparison */

{
  check("4.1 equal digests compare equal", constantTimeEqualHex("abcd", "ABCD"));
  check("4.2 different digests compare unequal", !constantTimeEqualHex("abcd", "abce"));
  check("4.3 different lengths compare unequal", !constantTimeEqualHex("abcd", "abcde"));
  check(
    "4.4 validator uses the constant-time comparison for the hash",
    /constantTimeEqualHex\(expected, hash\)/.test(authCode),
  );
  check(
    "4.5 no naive equality on the secret-derived hash",
    !/expected\s*===\s*hash|hash\s*===\s*expected/.test(authCode),
  );
  check(
    "4.6 comparison is not short-circuited per character",
    /diff \|=/.test(authCode) && !/return false;[\s\S]{0,40}charCodeAt/.test(authCode),
  );
}

/* ------------------------------------ 5. no initDataUnsafe / client identity */

{
  check("5.1 validator never references initDataUnsafe", !/initDataUnsafe/.test(authCode));
  check("5.2 bridge never references initDataUnsafe", !/initDataUnsafe/.test(bridgeCode));
  check(
    "5.3 bridge never accepts a client telegram user id",
    !/telegramUserId\s*[:=]\s*(data|input)\b/.test(bridgeCode) &&
      !/_telegram_user_id:\s*data\./.test(bridgeCode),
  );
  check(
    "5.4 every RPC call passes the validated telegram user id",
    (bridgeCode.match(/_telegram_user_id:/g) ?? []).length ===
      (bridgeCode.match(/_telegram_user_id:\s*(auth\.user\.id|telegramUserId)/g) ?? []).length,
  );
}

/* ---------------------------------------------- 6. secret handling */

{
  check(
    "6.1 bot token read per-request from server env inside a function",
    /function botToken\(\)[\s\S]{0,120}process\.env\["TELEGRAM_BOT_TOKEN"\]/.test(bridgeCode),
  );
  check(
    "6.2 no module-scope env read in the bridge",
    !/^const\s+\w+\s*=\s*process\.env/m.test(bridgeCode),
  );
  check(
    "6.3 service-role client loaded inside a handler, not at module scope",
    /await import\("@\/integrations\/supabase\/client\.server"\)/.test(bridgeCode) &&
      !/^import[\s\S]{0,80}client\.server/m.test(bridgeCode),
  );
  check("6.4 bridge never reads the service role key directly", !/SUPABASE_SERVICE_ROLE_KEY/.test(bridgeCode));
  check("6.5 no console logging in the bridge", !/console\./.test(bridgeCode));
  check("6.6 no console logging in the auth module", !/console\./.test(authCode));
  check("6.7 token never returned by the validator", !/return[^\n]*botToken/.test(authCode));
  check(
    "6.8 telegram response is never returned raw",
    /return status === "administrator" \|\| status === "creator";/.test(authCode) &&
      !/return payload/.test(authCode),
  );
}

/* ------------------------------ 7. reuse of existing SE-15 RPCs only */

{
  const expected = [
    "social_mission_control_workspaces",
    "social_mission_control_missions",
    "social_mission_control_panel",
    "social_mission_apply_target_override",
    "social_mission_apply_duration_override",
  ];
  for (const name of expected) {
    check(`7.1 reuses existing RPC ${name}`, bridgeCode.includes(name));
  }
  const rpcNames = [...bridgeCode.matchAll(/"(social_mission_[a-z_]+|end_social_mission_[a-z_]+|cancel_social_mission_[a-z_]+)"/g)].map(
    (m) => m[1]!,
  );
  check(
    "7.2 no RPC outside the approved SE-15 set",
    rpcNames.every((n) => expected.includes(n)),
    rpcNames.filter((n) => !expected.includes(n)).join(", "),
  );
  check(
    "7.3 bridge defines no SQL/schema change",
    !/CREATE TABLE|ALTER TABLE|CREATE FUNCTION|CREATE POLICY|GRANT /i.test(bridgeSrc),
  );
  check("7.4 only the one snapshots table is read", (bridgeCode.match(/\.from\("/g) ?? []).length === 1);
  check("7.5 the table read is social_metric_snapshots", bridgeCode.includes('.from("social_metric_snapshots")'));
}

/* ------------------------------ 8. authorization chain per mission request */

{
  check(
    "8.1 mission binding resolved through operator-scoped RPCs",
    /async function resolveBinding\([\s\S]{0,900}MINIAPP_RPC\.workspaces[\s\S]{0,900}MINIAPP_RPC\.missions/.test(
      bridgeCode,
    ),
  );
  check(
    "8.2 chat id comes from the resolved binding, never the client",
    /chatId: String\(hit\["telegram_chat_id"\]/.test(bridgeCode) &&
      !/chatId\s*[:=]\s*data\./.test(bridgeCode) &&
      !/chat_id.*data\./.test(bridgeCode),
  );
  check(
    "8.3 live getChatMember check on the resolved chat",
    /isCurrentChatAdmin\(token, binding\.chatId, auth\.user\.id\)/.test(bridgeCode),
  );
  check(
    "8.4 administrator/creator required, fail closed",
    /if \(!isAdmin\) return fail\("not_group_admin"\);/.test(bridgeCode) &&
      /status === "administrator" \|\| status === "creator"/.test(authCode) &&
      /catch \{\s*return false;/.test(authCode),
  );
  check(
    "8.5 getChatMember is bounded by a hard timeout",
    /AbortSignal\.timeout\(TELEGRAM_TIMEOUT_MS\)/.test(authCode),
  );
  const missionActions = ["miniAppMissionPanel", "miniAppApplyTargets", "miniAppApplyDuration"];
  for (const action of missionActions) {
    const start = bridgeCode.indexOf(`export const ${action}`);
    const region = bridgeCode.slice(start, start + 2600);
    check(`8.6 ${action} runs the full authorization gate`, start > 0 && /authorizeMission\(/.test(region));
    check(
      `8.7 ${action} passes the verified chat id to the RPC`,
      /_verified_chat_id: Number\(binding\.chatId\)/.test(region),
    );
  }
  check(
    "8.8 mission id validated as a UUID before any lookup",
    /if \(!isUuid\(missionId\)\) return fail\("invalid_mission_id"\);/.test(bridgeCode),
  );
  check("8.9 workspace id validated as a UUID", /isUuid\(data\?\.workspaceId\)/.test(bridgeCode));
}

/* -------------------------------- 9. stored snapshots only, zero provider reads */

{
  const start = bridgeCode.indexOf("export const miniAppMissionPanel");
  const region = bridgeCode.slice(start, bridgeCode.indexOf("MUTATIONS"));
  check("9.1 panel region located", start > 0 && region.length > 200);
  check(
    "9.2 panel reads the latest stored snapshot for the exact mission and workspace",
    /\.eq\("mission_id", binding\.missionId\)/.test(region) &&
      /\.eq\("workspace_id", binding\.workspaceId\)/.test(region) &&
      /\.limit\(1\)/.test(region),
  );
  check(
    "9.3 snapshot ordering is observed_at then created_at desc",
    /order\("observed_at", \{ ascending: false \}\)[\s\S]{0,80}order\("created_at", \{ ascending: false \}\)/.test(
      region,
    ),
  );
  check(
    "9.4 panel performs zero provider / X reads",
    !/api\.x\.com|api\.twitter\.com|socialRead|social-read|fetchXMetrics|refetch_social/i.test(region),
  );
  check("9.5 panel issues no outbound fetch", !/\bfetch\(/.test(region));
  check(
    "9.6 metric mapping is views/likes/comments/shares/saves",
    /views: "views"[\s\S]{0,160}likes: "likes"[\s\S]{0,160}replies: "comments"[\s\S]{0,160}reposts: "shares"[\s\S]{0,160}bookmarks: "saves"/.test(
      bridgeCode,
    ),
  );
  check(
    "9.7 missing metrics stay null and are never coerced to 0",
    /if \(raw === null \|\| raw === undefined\) return null;/.test(bridgeCode) &&
      /if \(!row\) return null;/.test(bridgeCode),
  );
}

/* ------------------------- 10. request id + deterministic idempotency */

{
  check("10.1 valid v4 uuid accepted", isRequestId("6f3b3a2e-1b2c-4d5e-8f9a-0b1c2d3e4f50"));
  check("10.2 non-uuid rejected", !isRequestId("not-a-uuid"));
  check("10.3 non-string rejected", !isRequestId(42 as unknown));
  check("10.4 plain uuid helper works", isUuid("6f3b3a2e-1b2c-4d5e-8f9a-0b1c2d3e4f50") && !isUuid("x"));

  const a = await miniAppIdempotencyKey(777000123, "apply_targets", "6f3b3a2e-1b2c-4d5e-8f9a-0b1c2d3e4f50");
  const b = await miniAppIdempotencyKey(777000123, "apply_targets", "6f3b3a2e-1b2c-4d5e-8f9a-0b1c2d3e4f50");
  const c = await miniAppIdempotencyKey(777000123, "apply_duration", "6f3b3a2e-1b2c-4d5e-8f9a-0b1c2d3e4f50");
  const d = await miniAppIdempotencyKey(999, "apply_targets", "6f3b3a2e-1b2c-4d5e-8f9a-0b1c2d3e4f50");
  check("10.5 idempotency key is deterministic for the same request", a === b);
  check("10.6 idempotency key varies by action", a !== c);
  check("10.7 idempotency key varies by telegram user", a !== d);
  check("10.8 idempotency key is bounded to 40 chars", a.length === 40 && /^[0-9a-f]{40}$/.test(a));

  for (const action of ["miniAppApplyTargets", "miniAppApplyDuration"]) {
    const start = bridgeCode.indexOf(`export const ${action}`);
    const region = bridgeCode.slice(start, start + 2600);
    check(`10.9 ${action} validates the request id`, /isRequestId\(data\?\.requestId\)/.test(region));
    check(
      `10.10 ${action} passes the derived idempotency key to the RPC`,
      /_idempotency_key: await miniAppIdempotencyKey\(/.test(region),
    );
    check(
      `10.11 ${action} rejects an invalid request id before authorizing or mutating`,
      region.indexOf("isRequestId") < region.indexOf("authorizeMission"),
    );
  }
  check(
    "10.12 no global one-use replay cache keyed by initData",
    !/replayCache|usedHashes|seenInitData/i.test(bridgeCode) && !/replayCache|usedHashes/i.test(authCode),
  );
}

/* ------------------------------ 11. end/cancel not enabled in bridge V1 */

{
  check("11.1 end RPC is never called from the bridge", !/end_social_mission_from_control/.test(bridgeCode));
  check("11.2 cancel RPC is never called from the bridge", !/cancel_social_mission_from_control/.test(bridgeCode));
  check(
    "11.3 end/cancel reported as bot-finalized capabilities",
    /end_now: "bot_finalize_required"/.test(bridgeCode) && /cancel: "bot_finalize_required"/.test(bridgeCode),
  );
  check("11.4 bridge exposes the not-enabled constant", /not_enabled_in_bridge_v1/.test(bridgeCode));
  check(
    "11.5 bridge exports no end/cancel server function",
    !/export const miniAppEnd/.test(bridgeCode) && !/export const miniAppCancel/.test(bridgeCode),
  );
  check(
    "11.6 no second Telegram finalization path (no card edit, pin or unpin)",
    !/editMessage|unpinChatMessage|pinChatMessage|sendMessage/i.test(bridgeCode),
  );
  check(
    "11.7 only getChatMember is called against the Telegram API",
    (authCode.match(/api\.telegram\.org/g) ?? []).length === 1 && authCode.includes("/getChatMember"),
  );
}

/* --------------------------------------- 12. bridge structure / no UI */

{
  check("12.1 bridge uses createServerFn", /from "@tanstack\/react-start"/.test(bridgeCode) && /createServerFn\(/.test(bridgeCode));
  check(
    "12.2 all endpoints are POST",
    (bridgeCode.match(/createServerFn\(/g) ?? []).length ===
      (bridgeCode.match(/createServerFn\(\{ method: "POST" \}\)/g) ?? []).length,
  );
  check(
    "12.3 every endpoint declares an input validator",
    (bridgeCode.match(/createServerFn\(/g) ?? []).length ===
      (bridgeCode.match(/\.inputValidator\(/g) ?? []).length,
  );
  check("12.4 no JSX / UI in the bridge", !/<\/[A-Za-z]|\/>|React|jsx/.test(bridgeSrc));
  check("12.5 no browser globals in the bridge", !/\bwindow\.|document\.|localStorage/.test(bridgeCode));
  check("12.6 auth module has no Deno or Supabase Edge dependency", !/Deno\./.test(authCode) && !/deno\.land/.test(authSrc));
}

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS — ${passed}/${passed} SE-16.0 mini app auth bridge checks passed`);
