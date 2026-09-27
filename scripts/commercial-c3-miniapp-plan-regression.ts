/** COMMERCIAL C3 — Mini App plan visibility + Pro lock UX (static regression). */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const bridge = readFileSync("src/lib/telegram-miniapp-bridge.functions.ts", "utf8");
const ui = readFileSync("src/routes/tg.index.tsx", "utf8");
const start = bridge.indexOf("export const miniAppCommercialStatus");
const fn = bridge.slice(start, bridge.indexOf("export const miniAppCapabilities"));
let pass = 0, failN = 0;
const check = (n: string, ok: boolean) => { ok ? pass++ : failN++; console.log(`${ok ? "PASS" : "FAIL"} ${n}`); };
const idx = (s: string) => fn.indexOf(s);
check("S1 status fn exists", start > 0);
check("S2 initData validated first", idx("validateTelegramInitData") > 0 && idx("validateTelegramInitData") < idx("isUuid(data?.workspaceId)"));
check("S3 workspace authorized via operator RPC before any commercial/link read",
  idx("MINIAPP_RPC.workspaces") > 0 && idx('return fail("not_found")') < idx("telegram_connections") && idx("telegram_connections") < idx("MINIAPP_COMMERCIAL_RPC.billingStatus"));
check("S4 input type accepts only initData + workspaceId (no actor id)", /inputValidator\(\(input: \{ initData: string; workspaceId: string \}\)/.test(fn) && !/data\??\.(userId|user_id|actorUserId)/.test(fn));
check("S5 actor from telegram_connections by validated telegram user", /\.eq\("telegram_user_id", auth\.user\.id\)/.test(fn) && /_user_id: actorUserId/.test(fn));
check("S6 reuses existing authoritative DB fns", /billingStatus: "get_workspace_billing_status"/.test(bridge) && /access: "evaluate_commercial_access"/.test(bridge));
check("S7 features exactly x_missions/project_inbox/sticker_drops", /MINIAPP_COMMERCIAL_FEATURES = \["x_missions", "project_inbox", "sticker_drops"\]/.test(bridge));
check("S8 fails closed on errors/non-ok", /status\["ok"\] !== true\) return fail\("unavailable"\)/.test(fn) && /accessError\) return fail\("unavailable"\)/.test(fn) && /!isUuid\(actorUserId\)\) return fail/.test(fn));
check("S9 no Stripe ids / provider details returned, no writes", !/stripe_|customer_id|subscription_id|\.insert\(|\.update\(|\.upsert\(|\.delete\(|fetch\(/.test(fn));
check("U1 missions query disabled when denied", /enabled: Boolean\(initData && workspaceId && commercialSettled && !missionsLocked\)/.test(ui));
check("U2 inbox summary disabled when denied", /enabled: Boolean\(initData && workspaceId && commercialSettled && !inboxLocked\)/.test(ui));
check("U3 inbox component not mounted when denied", /activeTab === "inbox" && !inboxLocked && commercialSettled \? \(\s*<MiniAppInbox/.test(ui));
check("U4 locks only on explicit false (Pro/unrestricted/unknown keep behaviour)", /missionsLocked = missionsAllowed === false/.test(ui) && /inboxLocked = inboxAllowed === false/.test(ui));
check("U5 Sticker Drops lock follows sticker_drops", /stickerDropsAllowed = commercial \? commercial\.features\.sticker_drops/.test(ui) && /stickerDropsAllowed === false \?[\s\S]{0,120}to="\/settings"/.test(ui));
check("U6 plan labels", ui.includes("Platform Owner / Unrestricted") && ui.includes("Cartel HQ Pro ($49/month)"));
check("U7 upgrade routes to Settings, no checkout in Mini App", !/checkout|createCheckout|stripe/i.test(ui) && /Upgrade to Pro — Settings & billing/.test(ui));
check("U8 Launch Control / Community Command not locked", /<FullAppLink to="\/launch-control" label="Launch Control" \/>/.test(ui) && /<FullAppLink to="\/telegram" label="Community Command" \/>/.test(ui));
const changed = execSync("git diff --name-only HEAD; git ls-files --others --exclude-standard", { encoding: "utf8" });
check("F1 no migrations/Stripe/C1/C2/launcher/PCART/chain/liquidity/treasury files changed",
  !/supabase\/migrations|stripe|billing|COMMERCIAL_C1|COMMERCIAL_C2|self-service|launcher|pcart|chain|liquidity|treasury/i.test(changed));
console.log(`\nC3 ${pass}/${pass + failN} passed`);
if (failN) process.exit(1);
