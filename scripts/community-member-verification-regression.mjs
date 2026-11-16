/**
 * Source-only verification guardrails. No Telegram API, Supabase network,
 * paid model, or production calls. This is NOT an integration acceptance test.
 *
 * Run: node scripts/community-member-verification-regression.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL("../" + name, import.meta.url),"utf8");
const webhook = read("supabase/functions/telegram-webhook/index.ts");
const group = read("supabase/functions/telegram-group/index.ts");
const migration = read("supabase/migrations/20261116220000_telegram_member_verification.sql");
const client = read("src/lib/telegram-group.ts");
const dialog = read("src/components/cartel/CommunityVerificationDialog.tsx");
const groupCard = read("src/components/cartel/TelegramGroupCard.tsx");

const tests = [
  ["historical webhook events retained",
    () => ["\"message\"","\"my_chat_member\"","\"callback_query\""].every(e=>webhook.includes(e))],
  ["join event gated by global rollout flag",
    () => webhook.includes('CARTEL_MEMBER_VERIFICATION_ENABLED') && webhook.includes('["chat_join_request"]')],
  ["Telegram webhook secret still validated",
    () => webhook.includes('X-Telegram-Bot-Api-Secret-Token') &&
      webhook.indexOf('if (!supplied || supplied !== expected)') < webhook.indexOf("const join = update?.chat_join_request")],
  ["join requests bound to managed invite",
    () => webhook.includes('usedLink!==managed.invite_link') &&
      webhook.includes('invite_link_fingerprint:inviteFingerprint') &&
      webhook.includes("memberVerificationInviteFingerprint(link.invite_link)")],
  ["callbacks bound to Telegram identity, private context and claim RPC",
    () => webhook.includes('callbackChat?.type!=="private"') &&
      webhook.includes("_telegram_user_id:actorId") &&
      webhook.includes('admin.rpc("member_verification_attempt"')],
  ["no approval before atomic claim succeeds",
    () => webhook.indexOf('result!=="correct"') < webhook.indexOf('"approveChatJoinRequest"')],
  ["ambiguous approval reconciled rather than auto-retried",
    () => webhook.includes('"getChatMember"') && webhook.includes('"telegram_approval_uncertain"')],
  ["legacy welcomes and missions preserved",
    () => webhook.includes("new_chat_members") && webhook.includes("social_mission_control_workspaces")],
  ["private storage and safe default",
    () => migration.includes("verification_enabled boolean NOT NULL DEFAULT false") &&
      migration.includes("REVOKE ALL ON public.telegram_member_verification_challenges FROM PUBLIC, anon, authenticated") &&
      migration.includes("GRANT EXECUTE ON FUNCTION public.member_verification_attempt")],
  ["atomic limited attempts",
    () => migration.includes("FOR UPDATE") && migration.includes("attempts BETWEEN 0 AND 3") &&
      migration.includes("status='approving'")],
  ["concurrent active requests deduplicated",
    () => migration.includes("telegram_member_verification_one_open_request") &&
      migration.includes("telegram_update_id bigint NOT NULL UNIQUE")],
  ["owner-only permissions and emergency opt-out",
    () => group.includes('membership.role !== "owner"') &&
      group.includes("memberVerificationDisable") &&
      group.includes('body.enabled === false')],
  ["no direct browser bot-token access",
    () => !client.includes("TELEGRAM_BOT_TOKEN") && !dialog.includes("TELEGRAM_BOT_TOKEN")],
  ["owner sees verification alongside existing welcome",
    () => groupCard.includes("<CommunityWelcomeDialog") &&
      groupCard.includes("<CommunityVerificationDialog") &&
      groupCard.includes("isProjectOwner && verificationOpen")],
  ["no automated link creation from UI mount",
    () => dialog.includes("fetchCommunityVerificationStatus") &&
      dialog.includes("onClick={() => void perform(() => prepareCommunityVerificationLink")],
  ["no all-paths-protected misstatement",
    () => dialog.includes("other invite links") && group.includes("wholeGroupVerified:false")],
];

let passed=0;
for (const [label,test] of tests) {
  try {
    assert.equal(test(),true,label);
    process.stdout.write("PASS  "+label+"\n");
    passed++;
  } catch(error) {
    process.stderr.write("FAIL  "+label+"\n");
    process.stderr.write(String(error)+"\n");
    process.exitCode=1;
  }
}
process.stdout.write(passed+"/"+tests.length+" static checks passed. No network or Telegram calls performed.\n");
