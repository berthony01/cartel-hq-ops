/**
 * Behavioral regressions for:
 *  A/B – telegram-message-cleanup handler (fast lane + scheduler lane, desired
 *        state vs persistence separation) executed with the EXACT bridge headers.
 *  C   – platform plain-text / caption / FormData branding, limits, entities,
 *        unicode, URLs, escaping, duplicate prefix, authored/frozen untouched.
 * No network, no Telegram, no database: deps are controlled fakes.
 */
import { handleCleanupRequest, type CleanupDeps } from "../backend-source/edge-functions/telegram-message-cleanup/handler";
import {
  CARTEL_CUSTOM_EMOJI,
  PLAIN_BRANDED_HEADER,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_TEXT_LIMIT,
  presentTelegramFormData,
  presentTelegramPayload,
  telegramHtmlVisibleLength,
} from "../backend-source/edge-functions/_shared/telegram-presentation";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  ok ? passed++ : failed++;
}

// ---------------------------------------------------------------- A / B
const SERVICE = "service-role-key-value";
const JOB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, TELEGRAM_BOT_TOKEN: "bot" };

type World = {
  rpcCalls: string[];
  updates: Array<Record<string, unknown>>;
  scheduled: Promise<unknown>[];
  telegram: Array<{ status: number; body: unknown } | "throw">;
  claimFast: unknown[];
  claimBatch: unknown[];
  secretOk: boolean;
  updateError: boolean;
  logs: string[];
  createdAdmin: number;
};

function world(partial: Partial<World> = {}): World {
  return { rpcCalls: [], updates: [], scheduled: [], telegram: [], claimFast: [], claimBatch: [], secretOk: true, updateError: false, logs: [], createdAdmin: 0, ...partial };
}

function deps(w: World, opts: { waitUntil?: unknown } = { waitUntil: "default" }): CleanupDeps {
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      w.rpcCalls.push(`${name}:${JSON.stringify(args)}`);
      if (name === "claim_mission_control_launcher_cleanup_job") return { data: w.claimFast, error: null };
      if (name === "claim_telegram_message_cleanup_jobs") return { data: w.claimBatch, error: null };
      if (name === "telegram_message_cleanup_scheduler_secret_matches") return { data: w.secretOk, error: null };
      return { data: null, error: { message: "unknown" } };
    },
    from: () => ({
      update: (row: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => {
          w.updates.push({ ...row, id });
          return { error: w.updateError ? { message: "db down" } : null };
        },
      }),
    }),
  };
  return {
    env,
    createAdmin: () => { w.createdAdmin += 1; return admin; },
    sleep: async () => {},
    log: (m) => w.logs.push(m),
    fetchImpl: (async () => {
      const next = w.telegram.shift();
      if (!next || next === "throw") throw new Error("network");
      return new Response(JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof fetch,
    waitUntil: opts.waitUntil === "default" ? (p: Promise<unknown>) => { w.scheduled.push(p); } : opts.waitUntil,
  };
}

/** EXACT headers sent by miniAppCloseCommunityLaunch. */
function bridgeRequest(jobId = JOB, extra: Record<string, string> = {}, bearer = SERVICE) {
  return new Request("https://x/functions/v1/telegram-message-cleanup", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "x-cartel-cleanup-job-id": jobId, ...extra },
  });
}
const launcherJob = { job_id: JOB, telegram_chat_id: -1001, telegram_message_id: 88, attempt_count: 1, cleanup_kind: "mission_control_launcher" };

{
  const w = world({ claimFast: [launcherJob], telegram: [{ status: 200, body: { ok: true } }] });
  const res = await handleCleanupRequest(bridgeRequest(), deps(w));
  check("A1 exact bridge headers (no scheduler secret) are accepted with 202", res.status === 202);
  check("A1 nothing claimed before the delayed task runs synchronously", w.scheduled.length === 1);
  await Promise.all(w.scheduled);
  check("A1 delayed task claims exactly the requested job", w.rpcCalls.length === 1 && w.rpcCalls[0] === `claim_mission_control_launcher_cleanup_job:{"_job_id":"${JOB}"}`);
  check("A1 fast lane never consults the scheduler secret RPC", !w.rpcCalls.some((c) => c.startsWith("telegram_message_cleanup_scheduler_secret_matches")));
  check("A1 deleted state persisted once", w.updates.length === 1 && w.updates[0]?.status === "deleted" && w.updates[0]?.id === JOB);
}
{
  const w = world();
  const res = await handleCleanupRequest(bridgeRequest(JOB, {}, "wrong-key"), deps(w));
  check("A2 wrong bearer is 401 and schedules nothing", res.status === 401 && w.scheduled.length === 0 && w.createdAdmin === 0);
}
{
  const w = world();
  const res = await handleCleanupRequest(new Request("https://x", { method: "POST", headers: { "x-cartel-cleanup-job-id": JOB } }), deps(w));
  check("A3 missing bearer is 401", res.status === 401 && w.scheduled.length === 0);
}
{
  const w = world();
  const res = await handleCleanupRequest(bridgeRequest(JOB, { "x-cartel-cleanup-scheduler-secret": "s" }), deps(w));
  check("A4 fast lane with a scheduler secret attached is rejected 401", res.status === 401 && w.scheduled.length === 0);
}
for (const bad of ["", "not-a-uuid", `${JOB}x`, "../../etc", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee"]) {
  const w = world();
  const res = await handleCleanupRequest(bridgeRequest(bad), deps(w));
  check(`A5 malformed job id ${JSON.stringify(bad)} rejected 400 without scheduling`, res.status === 400 && w.scheduled.length === 0);
}
{
  const w = world();
  const res = await handleCleanupRequest(bridgeRequest(), deps(w, { waitUntil: undefined }));
  check("A6 absent EdgeRuntime.waitUntil returns 503, not 202", res.status === 503 && w.createdAdmin === 0);
  const w2 = world();
  const res2 = await handleCleanupRequest(bridgeRequest(), deps(w2, { waitUntil: { notAFunction: true } }));
  check("A6 non-function waitUntil returns 503", res2.status === 503);
  const w3 = world();
  const res3 = await handleCleanupRequest(bridgeRequest(), deps(w3, { waitUntil: () => { throw new Error("x"); } }));
  check("A6 throwing waitUntil returns 503", res3.status === 503);
}
{
  const w = world({ claimFast: [{ ...launcherJob, cleanup_kind: "social_mission_card" }], telegram: [{ status: 200, body: { ok: true } }] });
  await handleCleanupRequest(bridgeRequest(), deps(w));
  await Promise.all(w.scheduled);
  check("A7 fast lane never deletes a non-launcher kind", w.updates.length === 0 && w.telegram.length === 1);
  const w2 = world({ claimFast: [] });
  await handleCleanupRequest(bridgeRequest(), deps(w2));
  await Promise.all(w2.scheduled);
  check("A7 unclaimable job (done/not due) is a no-op; cron remains fallback", w2.updates.length === 0);
}
{
  const w = world();
  const res = await handleCleanupRequest(new Request("https://x", { method: "POST" }), deps(w));
  check("A8 cron request without secret is 401", res.status === 401 && w.rpcCalls.length === 0);
  const w2 = world({ secretOk: false });
  const res2 = await handleCleanupRequest(new Request("https://x", { method: "POST", headers: { "x-cartel-cleanup-scheduler-secret": "bad" } }), deps(w2));
  check("A8 cron wrong secret is 401 and claims nothing", res2.status === 401 && !w2.rpcCalls.some((c) => c.startsWith("claim_")));
  const w3 = world({ claimBatch: [{ job_id: "j1", telegram_chat_id: -1, telegram_message_id: 1, attempt_count: 1 }], telegram: [{ status: 400, body: { ok: false, description: "Bad Request: message to delete not found" } }] });
  const res3 = await handleCleanupRequest(new Request("https://x", { method: "POST", headers: { "x-cartel-cleanup-scheduler-secret": "good" } }), deps(w3));
  const body3 = await res3.json() as Record<string, number>;
  check("A8 valid cron secret lane still claims batch and treats already-gone as deleted", res3.status === 200 && body3["deleted"] === 1 && w3.rpcCalls.some((c) => c.startsWith("claim_telegram_message_cleanup_jobs")));
  const res4 = await handleCleanupRequest(new Request("https://x", { method: "GET" }), deps(world()));
  check("A8 non-POST is 405", res4.status === 405);
}
{
  // B: Telegram delete succeeded but DB persist failed -> NOT reclassified as network_error retry.
  const w = world({ claimBatch: [{ job_id: "j1", telegram_chat_id: -1, telegram_message_id: 1, attempt_count: 1 }], telegram: [{ status: 200, body: { ok: true } }], updateError: true });
  const res = await handleCleanupRequest(new Request("https://x", { method: "POST", headers: { "x-cartel-cleanup-scheduler-secret": "good" } }), deps(w));
  const body = await res.json() as Record<string, number>;
  check("B1 DB persistence failure makes exactly one write attempt (desired=deleted)", w.updates.length === 1 && w.updates[0]?.status === "deleted");
  check("B1 persistence failure is never rewritten as network_error/retry", !w.updates.some((u) => u.error_class === "network_error" || u.status === "retry"));
  check("B1 counters only advance after confirmed persistence", body["deleted"] === 0 && body["retry"] === 0 && body["failed"] === 0 && body["claimed"] === 1);
  check("B1 persistence failure logged", w.logs.includes("[telegram-message-cleanup] cleanup state update failed"));
}
{
  const w = world({ claimBatch: [{ job_id: "j1", telegram_chat_id: -1, telegram_message_id: 1, attempt_count: 1 }], telegram: ["throw"] });
  await handleCleanupRequest(new Request("https://x", { method: "POST", headers: { "x-cartel-cleanup-scheduler-secret": "good" } }), deps(w));
  check("B2 real Telegram network failure -> one retry write with network_error", w.updates.length === 1 && w.updates[0]?.status === "retry" && w.updates[0]?.error_class === "network_error");
  const w2 = world({ claimBatch: [{ job_id: "j1", telegram_chat_id: -1, telegram_message_id: 1, attempt_count: 5 }], telegram: [{ status: 502, body: {} }] });
  await handleCleanupRequest(new Request("https://x", { method: "POST", headers: { "x-cartel-cleanup-scheduler-secret": "good" } }), deps(w2));
  check("B2 capped attempts -> failed telegram_server_error", w2.updates[0]?.status === "failed" && w2.updates[0]?.error_class === "telegram_server_error");
  const w3 = world({ claimBatch: [{ job_id: "j1", telegram_chat_id: -1, telegram_message_id: 1, attempt_count: 1 }], telegram: [{ status: 403, body: { ok: false, description: "Forbidden" } }] });
  await handleCleanupRequest(new Request("https://x", { method: "POST", headers: { "x-cartel-cleanup-scheduler-secret": "good" } }), deps(w3));
  check("B2 explicit 4xx -> failed telegram_rejected, no blind retry", w3.updates[0]?.status === "failed" && w3.updates[0]?.error_class === "telegram_rejected");
  const w4 = world({ claimFast: [launcherJob], telegram: [{ status: 200, body: { ok: true } }], updateError: true });
  await handleCleanupRequest(bridgeRequest(), deps(w4));
  await Promise.all(w4.scheduled);
  check("B3 fast lane shares the same processor (persist failure not reclassified)", w4.updates.length === 1 && w4.updates[0]?.status === "deleted");
}

// ---------------------------------------------------------------- C
const accent = CARTEL_CUSTOM_EMOJI.energy;
const PREFIX = `${PLAIN_BRANDED_HEADER}\n\n`;
{
  const p = presentTelegramPayload("sendMessage", { chat_id: 1, text: "Mission live" }, "platform") as any;
  check("C1 plain platform text gets visible branded header", p.text === `${PREFIX}Mission live` && p.parse_mode === undefined);
  check("C1 animated custom-emoji ENTITY attached with real id at offset 0", p.entities?.[0]?.type === "custom_emoji" && p.entities[0].offset === 0 && p.entities[0].length === 2 && p.entities[0].custom_emoji_id === accent.id);
  check("C1 bold entity covers exactly the label", p.entities?.[1]?.type === "bold" && p.text.substr(p.entities[1].offset, p.entities[1].length) === "PEPECARTEL · CARTEL HQ");
  const again = presentTelegramPayload("sendMessage", { chat_id: 1, text: p.text, entities: p.entities }, "platform") as any;
  check("C2 duplicate prefix never added", again.text === p.text && again.entities.length === p.entities.length);
}
{
  const raw = "Go 🐸 <b>not markup</b> & https://example.com/🔥?a=1&b=2";
  const ents = [{ type: "url", offset: raw.indexOf("https"), length: "https://example.com/🔥?a=1&b=2".length }, { type: "bold", offset: 3, length: 2 }];
  const p = presentTelegramPayload("sendMessage", { chat_id: 1, text: raw, entities: ents }, "platform") as any;
  check("C3 plain text is never escaped or reinterpreted", p.text === `${PREFIX}${raw}`);
  const urlEnt = p.entities.find((e: any) => e.type === "url");
  check("C3 existing URL entity shifted by exact UTF-16 prefix and still covers the URL", p.text.substr(urlEnt.offset, urlEnt.length) === "https://example.com/🔥?a=1&b=2");
  const boldEnt = p.entities.filter((e: any) => e.type === "bold")[1];
  check("C3 existing astral-emoji entity still covers 🐸", p.text.substr(boldEnt.offset, boldEnt.length) === "🐸");
  check("C3 input entities array not mutated", ents[0]!.offset === raw.indexOf("https"));
}
{
  const fits = "a".repeat(TELEGRAM_TEXT_LIMIT - PREFIX.length);
  const over = "a".repeat(TELEGRAM_TEXT_LIMIT - PREFIX.length + 1);
  const p1 = presentTelegramPayload("sendMessage", { text: fits }, "platform") as any;
  const p2 = presentTelegramPayload("sendMessage", { text: over }, "platform") as any;
  check("C4 plain text exactly at 4096 with header is decorated", p1.text.length === TELEGRAM_TEXT_LIMIT);
  check("C4 plain text one over capacity: decoration omitted, content untouched", p2.text === over && p2.entities === undefined);
  const full = "b".repeat(TELEGRAM_TEXT_LIMIT);
  check("C4 valid full 4096 text is never pushed over the limit", (presentTelegramPayload("sendMessage", { text: full }, "platform") as any).text === full);
  const capFits = "c".repeat(TELEGRAM_CAPTION_LIMIT - PREFIX.length);
  const capFull = "c".repeat(TELEGRAM_CAPTION_LIMIT);
  check("C4 caption at 1024 with header is decorated via caption_entities", (presentTelegramPayload("sendPhoto", { caption: capFits }, "platform") as any).caption.length === TELEGRAM_CAPTION_LIMIT);
  const pc = presentTelegramPayload("sendPhoto", { caption: capFull }, "platform") as any;
  check("C4 full 1024 caption untouched (no overflow)", pc.caption === capFull && pc.caption_entities === undefined);
  const astral = "🐸".repeat(Math.floor((TELEGRAM_TEXT_LIMIT - PREFIX.length) / 2) + 1);
  check("C4 astral unicode budget counted in UTF-16 (omits when over)", (presentTelegramPayload("sendMessage", { text: astral }, "platform") as any).text === astral);
}
{
  const body = "&amp;".repeat(TELEGRAM_TEXT_LIMIT - PREFIX.length);
  check("C5 HTML visible length decodes references", telegramHtmlVisibleLength("<b>&lt;x&gt;</b> &#128056;") === 5);
  const h1 = presentTelegramPayload("sendMessage", { text: `<b>${body}</b>`, parse_mode: "HTML" }, "platform") as any;
  check("C5 HTML at visible capacity is decorated (tags/escapes not counted raw)", h1.text.startsWith("<tg-emoji") && h1.text.endsWith(`<b>${body}</b>`));
  const h2 = presentTelegramPayload("sendMessage", { text: `<b>${body}&amp;</b>`, parse_mode: "HTML" }, "platform") as any;
  check("C5 HTML one over capacity: decoration omitted, authored HTML untouched", h2.text === `<b>${body}&amp;</b>`);
  const cap = presentTelegramPayload("sendPhoto", { caption: "x".repeat(TELEGRAM_CAPTION_LIMIT), parse_mode: "HTML" }, "platform") as any;
  check("C5 HTML caption full 1024 untouched", cap.caption === "x".repeat(TELEGRAM_CAPTION_LIMIT));
  const md = presentTelegramPayload("sendMessage", { text: "*hi*", parse_mode: "MarkdownV2" }, "platform") as any;
  check("C5 MarkdownV2 left untouched (no unsafe rewrite)", md.text === "*hi*" && md.entities === undefined);
}
{
  const authored = presentTelegramPayload("sendMessage", { text: "Tenant words" }, "authored") as any;
  const frozen = presentTelegramPayload("sendPhoto", { caption: "Frozen snapshot" }, "frozen") as any;
  check("C6 authored plain text byte-identical", authored.text === "Tenant words" && authored.entities === undefined);
  check("C6 frozen caption byte-identical", frozen.caption === "Frozen snapshot" && frozen.caption_entities === undefined);
}
{
  const form = new FormData();
  form.append("chat_id", "-100");
  form.append("caption", "🎯 Mission: follow @x");
  form.append("reply_markup", JSON.stringify({ inline_keyboard: [[{ text: "Open mission", url: "https://t.me/x?start=a&b=1" }]] }));
  const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
  form.append("photo", file);
  const out = presentTelegramFormData("sendPhoto", form, "platform");
  check("C7 photo mission card caption visibly branded", out.get("caption") === `${PREFIX}🎯 Mission: follow @x`);
  const ents = JSON.parse(String(out.get("caption_entities")));
  check("C7 photo mission card carries animated custom-emoji entity", ents[0].type === "custom_emoji" && ents[0].custom_emoji_id === accent.id);
  const rm = JSON.parse(String(out.get("reply_markup")));
  check("C7 mission card URL byte-identical and button styled", rm.inline_keyboard[0][0].url === "https://t.me/x?start=a&b=1" && rm.inline_keyboard[0][0].style === "success");
  const photo = out.get("photo");
  check("C7 file part preserved with filename", photo instanceof File && photo.name === "logo.png" && photo.size === 3);
  check("C7 chat_id preserved", out.get("chat_id") === "-100");
  check("C7 authored FormData returned as-is", presentTelegramFormData("sendPhoto", form, "authored") === form);
  const twice = presentTelegramFormData("sendPhoto", out, "platform");
  check("C7 FormData presentation idempotent", twice.get("caption") === out.get("caption") && JSON.parse(String(twice.get("caption_entities"))).length === ents.length);
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
