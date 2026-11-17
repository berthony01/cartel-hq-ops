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
  ["OFF blocks all join-query Telegram calls",
    () => {
      const start=webhook.indexOf("const join = update?.chat_join_request;");
      const guard=webhook.indexOf('if (Deno.env.get("CARTEL_MEMBER_VERIFICATION_ENABLED") !== "true") return json({ok:true});',start);
      const query=webhook.indexOf('"answerChatJoinRequestQuery"',start);
      const approve=webhook.indexOf('"approveChatJoinRequest"',start);
      return start >= 0 && guard > start && query > guard && approve > query;
    }],

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
  ["preview does not request an uninstalled verification backend",
    () => dialog.includes('import.meta.env.VITE_CARTEL_MEMBER_VERIFICATION_BACKEND_READY === "true"') &&
      dialog.includes("if (!open || !workspaceId || !VERIFICATION_BACKEND_READY) return;") &&
      dialog.includes("{!VERIFICATION_BACKEND_READY ? (") &&
      dialog.includes("const canPrepare = VERIFICATION_BACKEND_READY &&")],

  ["single SQL definitions, private invoker, fingerprint",
    () => migration.split("CREATE FUNCTION public.member_verification_attempt").length===2 &&
      migration.split("CREATE FUNCTION public.member_verification_check_group_scope").length===2 &&
      migration.split("CREATE TRIGGER member_verification_").length===3 &&
      migration.includes("SECURITY INVOKER") && !migration.includes("SECURITY DEFINER") &&
      migration.includes("invite_link_fingerprint text NOT NULL")],
  ["unrecognized join route cancels stale pending challenge",
    () => webhook.includes('last_error_code:"alternate_join_route"') &&
      webhook.includes('usedLink!==managed.invite_link') &&
      webhook.includes('.eq("status","pending")')],
  ["failed DM and manual-review rows do not permanently block new challenges",
    () => migration.includes("WHERE status IN ('pending','approving');") &&
      !migration.includes("WHERE status IN ('pending','approving','delivery_failed','needs_review');")],
  ["new same-link join invalidates previous challenge",
    () => webhook.includes('telegram_update_id").eq("group_connection_id"') &&
      webhook.includes('Number(active.telegram_update_id)===updateId') &&
      webhook.includes('"superseded_join_request"')],

  ["PR18 single connect CTA retained in stacked branch",
    () => groupCard.includes("showConnectButton = true") &&
      groupCard.includes("useImperativeHandle") &&
      groupCard.includes("<CommunityVerificationDialog")],
  ["Live Telegram admin and global flag required",
    () => group.includes("actorIsTelegramAdmin") &&
      group.includes("CARTEL_MEMBER_VERIFICATION_ENABLED")],

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
