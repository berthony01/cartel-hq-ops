/**
 * Source-only verification guardrails. No Telegram API, Supabase network,
 * paid model, or production calls. This is NOT an integration acceptance test.
 *
 * Run: node scripts/community-member-verification-regression.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");
const webhook = read("supabase/functions/telegram-webhook/index.ts");
const group = read("supabase/functions/telegram-group/index.ts");
const migration = read("supabase/migrations/20261116220000_telegram_member_verification.sql");
const client = read("src/lib/telegram-group.ts");
const dialog = read("src/components/cartel/CommunityVerificationDialog.tsx");
const groupCard = read("src/components/cartel/TelegramGroupCard.tsx");

const webhookLines = webhook.replace(/\s+/g, " ");
const tests = [
  [
    "historical webhook events retained",
    () => ['"message"', '"my_chat_member"', '"callback_query"'].every((e) => webhook.includes(e)),
  ],
  [
    "join event gated by global rollout flag",
    () =>
      webhook.includes("CARTEL_MEMBER_VERIFICATION_ENABLED") &&
      webhook.includes('["chat_join_request"]'),
  ],
  [
    "only per-group opt-in handles join request queries",
    () => {
      const start = webhookLines.indexOf("const join = update?.chat_join_request;");
      const groupGuard = webhookLines.indexOf(
        "if (settingsError || managedError || settings?.verification_enabled !== true) return json({ ok: true });",
        start,
      );
      const query = webhookLines.indexOf('"answerChatJoinRequestQuery"', start);
      return start >= 0 && groupGuard > start && query > groupGuard;
    },
  ],
  [
    "stale approving requests remain reviewable without blocking re-join",
    () =>
      webhook.includes('last_error_code: "stale_approval_manual_review"') &&
      webhook.includes('if (active.status === "approving") {') &&
      webhook.includes("staleError || !stale?.id") &&
      webhookLines.includes('.eq("id", active.id) .eq("status", "approving")'),
  ],
  [
    "OFF blocks all join-query Telegram calls",
    () => {
      const start = webhook.indexOf("const join = update?.chat_join_request;");
      const guard = webhook.indexOf(
        'if (Deno.env.get("CARTEL_MEMBER_VERIFICATION_ENABLED") !== "true") return json({ ok: true });',
        start,
      );
      const query = webhook.indexOf('"answerChatJoinRequestQuery"', start);
      const approve = webhook.indexOf('"approveChatJoinRequest"', start);
      return start >= 0 && guard > start && query > guard && approve > query;
    },
  ],

  [
    "Telegram webhook secret still validated",
    () =>
      webhook.includes("X-Telegram-Bot-Api-Secret-Token") &&
      webhook.indexOf("if (!supplied || supplied !== expected)") <
        webhook.indexOf("const join = update?.chat_join_request"),
  ],
  [
    "join requests bound to managed invite",
    () =>
      webhook.includes("usedLink !== managed.invite_link") &&
      webhook.includes("invite_link_fingerprint: inviteFingerprint") &&
      webhook.includes("memberVerificationInviteFingerprint(link.invite_link)"),
  ],
  [
    "callbacks bound to Telegram identity, private context and claim RPC",
    () =>
      webhook.includes('callbackChat?.type !== "private"') &&
      webhook.includes("_telegram_user_id: actorId") &&
      webhook.includes('admin.rpc("member_verification_attempt"'),
  ],
  [
    "no approval before atomic claim succeeds",
    () => {
      const claim = webhook.indexOf('admin.rpc("member_verification_attempt"');
      const guard = webhook.indexOf('if (claimError || result !== "correct")', claim);
      const approval = webhook.indexOf('"approveChatJoinRequest"', guard);
      return claim >= 0 && guard > claim && approval > guard;
    },
  ],
  [
    "ambiguous approval reconciled rather than auto-retried",
    () => webhook.includes('"getChatMember"') && webhook.includes('"telegram_approval_uncertain"'),
  ],
  [
    "legacy welcomes and missions preserved",
    () =>
      webhook.includes("new_chat_members") && webhook.includes("social_mission_control_workspaces"),
  ],
  [
    "private storage and safe default",
    () =>
      migration.includes("verification_enabled boolean NOT NULL DEFAULT false") &&
      migration.includes(
        "REVOKE ALL ON public.telegram_member_verification_challenges FROM PUBLIC, anon, authenticated",
      ) &&
      migration.includes("GRANT EXECUTE ON FUNCTION public.member_verification_attempt"),
  ],
  [
    "atomic limited attempts",
    () =>
      migration.includes("FOR UPDATE") &&
      migration.includes("attempts BETWEEN 0 AND 3") &&
      migration.includes("status='approving'"),
  ],
  [
    "concurrent active requests deduplicated",
    () =>
      migration.includes("telegram_member_verification_one_open_request") &&
      migration.includes("telegram_update_id bigint NOT NULL UNIQUE"),
  ],
  [
    "owner-only permissions and emergency opt-out",
    () =>
      group.includes('membership.role !== "owner"') &&
      group.includes("memberVerificationDisable") &&
      group.includes("body.enabled === false"),
  ],
  [
    "no direct browser bot-token access",
    () => !client.includes("TELEGRAM_BOT_TOKEN") && !dialog.includes("TELEGRAM_BOT_TOKEN"),
  ],
  [
    "owner sees verification alongside existing welcome",
    () =>
      groupCard.includes("<CommunityWelcomeDialog") &&
      groupCard.includes("<CommunityVerificationDialog") &&
      groupCard.includes("isProjectOwner && verificationOpen"),
  ],
  [
    "no automated link creation from UI mount",
    () =>
      dialog.includes("fetchCommunityVerificationStatus") &&
      /onClick=\{\(\) =>\s*void perform\(\s*\(\) =>\s*prepareCommunityVerificationLink/.test(
        dialog,
      ),
  ],
  [
    "no all-paths-protected misstatement",
    () => dialog.includes("other invite links") && group.includes("wholeGroupVerified: false"),
  ],
  [
    "preview does not request an uninstalled verification backend",
    () =>
      dialog.includes(
        'import.meta.env["VITE_CARTEL_MEMBER_VERIFICATION_BACKEND_READY"] === "true"',
      ) &&
      dialog.includes("if (!open || !workspaceId || !VERIFICATION_BACKEND_READY) return;") &&
      dialog.includes("{!VERIFICATION_BACKEND_READY ? (") &&
      /const canPrepare =\s*VERIFICATION_BACKEND_READY &&/.test(dialog),
  ],

  [
    "single SQL definitions, private invoker, fingerprint",
    () =>
      migration.split("CREATE FUNCTION public.member_verification_attempt").length === 2 &&
      migration.split("CREATE FUNCTION public.member_verification_check_group_scope").length ===
        2 &&
      migration.split("CREATE TRIGGER member_verification_").length === 3 &&
      migration.includes("SECURITY INVOKER") &&
      !migration.includes("SECURITY DEFINER") &&
      migration.includes("invite_link_fingerprint text NOT NULL"),
  ],
  [
    "unrecognized join route cancels stale pending challenge",
    () =>
      webhook.includes('last_error_code: "alternate_join_route"') &&
      webhook.includes("usedLink !== managed.invite_link") &&
      webhook.includes('.eq("status", "pending")'),
  ],
  [
    "failed DM and manual-review rows do not permanently block new challenges",
    () =>
      migration.includes("WHERE status IN ('pending','approving');") &&
      !migration.includes(
        "WHERE status IN ('pending','approving','delivery_failed','needs_review');",
      ),
  ],
  [
    "new same-link join invalidates previous challenge",
    () =>
      webhookLines.includes('telegram_update_id") .eq("group_connection_id"') &&
      webhook.includes("Number(active.telegram_update_id) >= updateId") &&
      webhook.includes('"superseded_join_request"'),
  ],

  [
    "PR18 single connect CTA retained in stacked branch",
    () =>
      groupCard.includes("showConnectButton = true") &&
      groupCard.includes("useImperativeHandle") &&
      groupCard.includes("<CommunityVerificationDialog"),
  ],
  [
    "Live Telegram admin and global flag required",
    () =>
      group.includes("actorIsTelegramAdmin") &&
      group.includes("CARTEL_MEMBER_VERIFICATION_ENABLED"),
  ],
];

let passed = 0;
for (const [label, test] of tests) {
  try {
    assert.equal(test(), true, label);
    process.stdout.write("PASS  " + label + "\n");
    passed++;
  } catch (error) {
    process.stderr.write("FAIL  " + label + "\n");
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  }
}
process.stdout.write(
  passed + "/" + tests.length + " static checks passed. No network or Telegram calls performed.\n",
);

// Execute the actual allowlisted handler branches with isolated I/O doubles.
// No server is started and no production/Telegram requests can be made.
const { default: ts } = await import("typescript");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function compileBranch(source, bindings) {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new AsyncFunction(...Object.keys(bindings), js)(...Object.values(bindings));
}
function fakeAdmin(resolve) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = { table, op: "select", filters: [], payload: null };
      const builder = new Proxy(
        {},
        {
          get(_target, method) {
            if (method === "then")
              return (done, fail) =>
                Promise.resolve()
                  .then(() => {
                    calls.push(query);
                    return resolve(query);
                  })
                  .then(done, fail);
            return (...args) => {
              if (["insert", "update", "delete"].includes(method)) {
                query.op = method;
                query.payload = args[0];
              } else if (["eq", "lt", "gte", "in"].includes(method)) {
                query.filters.push([method, ...args]);
              }
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
}
const groupBranch = group.slice(
  group.indexOf('  if (action.startsWith("member_verification_"))'),
  group.indexOf('\n  try {\n    if (action === "status")'),
);
const joinBranch = webhook.slice(
  webhook.indexOf("    const join = update?.chat_join_request;"),
  webhook.indexOf(
    "    const callback = update?.callback_query;",
    webhook.indexOf("    const join = update?.chat_join_request;"),
  ),
);
const callbackBranch = webhook.slice(
  webhook.indexOf("      const verificationTap = callbackData.match"),
  webhook.indexOf(
    "      // SE-6 Step 1",
    webhook.indexOf("      const verificationTap = callbackData.match"),
  ),
);
assert.ok(groupBranch.includes('action.startsWith("member_verification_")'));
assert.ok(joinBranch.includes("const join = update?.chat_join_request;"));
assert.ok(callbackBranch.includes("const verificationTap = callbackData.match"));
const fixtureGroup = {
  id: "group",
  workspace_id: "workspace",
  telegram_chat_id: -100,
  title: "Fixture",
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const joinUpdate = (overrides = {}) => ({
  update_id: 10,
  chat_join_request: {
    date: nowSeconds(),
    from: { id: 100 },
    chat: { id: -100, title: "Fixture" },
    user_chat_id: 200,
    invite_link: { invite_link: "https://t.me/+fixture" },
    ...overrides,
  },
});
const groupContext = (admin, role = "owner") => ({
  action: "member_verification_set_enabled",
  body: { enabled: false },
  memberVerificationDisable: true,
  membership: { role },
  getGroup: async () => fixtureGroup,
  admin,
  workspaceId: "workspace",
  user: { id: "owner" },
  Deno: { env: { get: () => "false" } },
  TELEGRAM_BOT_TOKEN: "fixture",
  telegramJson: async () => {
    throw new Error("Telegram unavailable");
  },
  respond: (body, status = 200) => ({ body, status }),
});
function joinContext(admin, update = joinUpdate(), enabled = true) {
  const telegramCalls = [];
  return {
    admin,
    update,
    telegramCalls,
    Deno: { env: { get: () => String(enabled) } },
    TELEGRAM_BOT_TOKEN: "fixture",
    json: (body) => body,
    crypto,
    escapeHtml: (value) => value,
    memberVerificationChoices: () => ({ choices: [1, 2, 3, 4], correctIndex: 0, question: "1+0?" }),
    memberVerificationAnswerHash: async () => "a".repeat(64),
    memberVerificationInviteFingerprint: async () => "b".repeat(64),
    telegramJson: async (_token, method) => {
      telegramCalls.push(method);
      return true;
    },
    sendMessageWithOutcome: async () => {
      telegramCalls.push("sendMessage");
      return { status: "sent" };
    },
  };
}
function joinDatabase({ enabled = true, userCount = 0, groupCount = 0, active = null } = {}) {
  return fakeAdmin((q) => {
    if (q.table === "telegram_group_connections") return { data: fixtureGroup };
    if (q.table === "telegram_community_settings")
      return { data: { verification_enabled: enabled } };
    if (q.table === "telegram_member_verification_invites")
      return { data: { invite_link: "https://t.me/+fixture" } };
    if (q.op === "insert" || q.op === "update") return { data: { id: "fixture-challenge" } };
    if (q.filters.some((f) => f[0] === "gte"))
      return { count: q.filters.some((f) => f[1] === "telegram_user_id") ? userCount : groupCount };
    return { data: active };
  });
}
function callbackContext(result = "correct") {
  const telegramCalls = [];
  const admin = fakeAdmin((q) => ({
    data:
      q.table === "telegram_member_verification_challenges"
        ? {
            id: "fixture",
            telegram_user_id: 100,
            group_connection_id: "group",
            workspace_id: "workspace",
            invite_link_fingerprint: "b".repeat(64),
          }
        : q.table === "telegram_group_connections"
          ? fixtureGroup
          : q.table === "telegram_community_settings"
            ? { verification_enabled: true }
            : { invite_link: "https://t.me/+fixture" },
  }));
  admin.rpc = async () => ({ data: result });
  return {
    admin,
    telegramCalls,
    callbackData: "mv_00000000-0000-0000-0000-000000000001_0",
    callback: { id: "callback" },
    callbackChat: { type: "private" },
    from: { id: 100 },
    Deno: { env: { get: () => "true" } },
    TELEGRAM_BOT_TOKEN: "fixture",
    json: (body) => body,
    memberVerificationAnswerHash: async () => "a".repeat(64),
    memberVerificationInviteFingerprint: async () => "b".repeat(64),
    answerCallback: async () => {},
    telegramJson: async (_token, method) => {
      telegramCalls.push(method);
      return true;
    },
  };
}
const behaviorTests = [
  [
    "invite preparation requires a literal Telegram approval flag before saving",
    async () => {
      for (const approvalFlag of ["false", false, true]) {
        const admin = fakeAdmin((q) => ({
          data:
            q.table === "telegram_connections"
              ? { telegram_user_id: 100 }
              : q.op === "insert"
                ? { group_connection_id: "group" }
                : null,
          count: 0,
        }));
        const context = {
          ...groupContext(admin),
          action: "member_verification_prepare_link",
          body: {},
          memberVerificationDisable: false,
          getGroup: async () => fixtureGroup,
          user: { id: "owner" },
          Deno: { env: { get: () => "true" } },
          telegramJson: async (_token, method) => {
            switch (method) {
              case "getMe":
                return { id: 1 };
              case "getChatMember":
                return { status: "creator" };
              case "getChat":
                return {};
              case "getWebhookInfo":
                return { allowed_updates: ["chat_join_request"] };
              case "createChatInviteLink":
                return { invite_link: "https://t.me/+fixture", creates_join_request: approvalFlag };
              default:
                throw new Error("unexpected Telegram method " + method);
            }
          },
        };
        const result = await compileBranch(groupBranch, context);
        const writes = admin.calls.filter((q) => q.op !== "select");
        if (approvalFlag === true) {
          assert.equal(result.body.created, true);
          assert.equal(writes.length, 1);
          assert.equal(writes[0].table, "telegram_member_verification_invites");
        } else {
          assert.equal(result.body.error, "INVALID_TELEGRAM_LINK");
          assert.equal(writes.length, 0);
        }
      }
    },
  ],
  [
    "full management handler disables with missing bot token",
    async () => {
      let handler;
      const admin = fakeAdmin((q) => ({
        data:
          q.table === "workspace_members"
            ? { role: "owner" }
            : q.table === "telegram_group_connections"
              ? fixtureGroup
              : q.table === "telegram_community_settings"
                ? { verification_enabled: true }
                : null,
        count: 0,
      }));
      admin.auth = { getUser: async () => ({ data: { user: { id: "owner" } } }) };
      const denyNetwork = () => {
        throw new Error("unexpected network or access gate");
      };
      await compileBranch(group.replace(/^import .*\n/gm, ""), {
        Deno: {
          env: { get: () => "" },
          serve: (fn) => {
            handler = fn;
          },
        },
        createClient: () => admin,
        fetch: denyNetwork,
        requireProjectToolAccess: denyNetwork,
        requireCommercialAccess: denyNetwork,
      });
      const response = await handler(
        new Request("https://fixture.invalid", {
          method: "POST",
          headers: { Authorization: "Bearer fixture", "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "member_verification_set_enabled",
            enabled: false,
            workspaceId: "workspace",
            groupConnectionId: "group",
          }),
        }),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status.enabled, false);
      assert.deepEqual(
        admin.calls.filter((q) => q.op !== "select").map((q) => [q.table, q.payload]),
        [["telegram_community_settings", { verification_enabled: false }]],
      );
    },
  ],
  [
    "owner emergency OFF succeeds with Telegram unavailable and unlinked",
    async () => {
      const admin = fakeAdmin((q) => ({
        data: q.op === "select" ? { verification_enabled: true } : null,
        count: 0,
      }));
      const context = groupContext(admin);
      let telegramCalls = 0;
      context.telegramJson = async () => {
        telegramCalls++;
        throw new Error("unavailable");
      };
      const result = await compileBranch(groupBranch, context);
      assert.equal(result.status, 200);
      assert.equal(result.body.status.enabled, false);
      assert.equal(telegramCalls, 0);
      assert.deepEqual(
        admin.calls.filter((q) => q.op === "update").map((q) => q.payload),
        [{ verification_enabled: false }],
      );
    },
  ],
  [
    "nonowner cannot disable verification",
    async () => {
      const admin = fakeAdmin(() => {
        throw new Error("unexpected DB access");
      });
      const result = await compileBranch(groupBranch, groupContext(admin, "admin"));
      assert.equal(result.status, 403);
      assert.equal(admin.calls.length, 0);
    },
  ],
  [
    "global OFF makes zero verification database or Telegram calls",
    async () => {
      const admin = fakeAdmin(() => {
        throw new Error("unexpected DB access");
      });
      const ctx = joinContext(admin, joinUpdate({ query_id: "query" }), false);
      await compileBranch(joinBranch, ctx);
      assert.equal(admin.calls.length, 0);
      assert.equal(ctx.telegramCalls.length, 0);
    },
  ],
  [
    "group OFF makes zero Telegram calls",
    async () => {
      const ctx = joinContext(joinDatabase({ enabled: false }), joinUpdate({ query_id: "query" }));
      await compileBranch(joinBranch, ctx);
      assert.equal(ctx.telegramCalls.length, 0);
    },
  ],
  [
    "expired delivery cannot issue a fresh challenge",
    async () => {
      const admin = fakeAdmin(() => {
        throw new Error("unexpected DB access");
      });
      const ctx = joinContext(admin, joinUpdate({ date: nowSeconds() - 300 }));
      await compileBranch(joinBranch, ctx);
      assert.equal(admin.calls.length, 0);
      assert.equal(ctx.telegramCalls.length, 0);
    },
  ],
  [
    "same or older update cannot replace newer active request",
    async () => {
      for (const updateId of [10, 11]) {
        const admin = joinDatabase({
          active: {
            id: "active",
            telegram_update_id: updateId,
            status: "pending",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        });
        const ctx = joinContext(admin);
        await compileBranch(joinBranch, ctx);
        assert.equal(admin.calls.filter((q) => q.op !== "select").length, 0);
        assert.equal(ctx.telegramCalls.length, 0);
      }
    },
  ],
  [
    "alternate link invalidates only older pending challenges",
    async () => {
      const admin = joinDatabase();
      const ctx = joinContext(
        admin,
        joinUpdate({ invite_link: { invite_link: "https://t.me/+other" } }),
      );
      await compileBranch(joinBranch, ctx);
      const writes = admin.calls.filter((q) => q.op === "update");
      assert.equal(writes.length, 1);
      assert.ok(
        writes[0].filters.some(
          (f) => f[0] === "lt" && f[1] === "telegram_update_id" && f[2] === 10,
        ),
      );
      assert.equal(ctx.telegramCalls.length, 0);
    },
  ],
  [
    "per-user and per-group preflight caps fail closed",
    async () => {
      for (const [userCount, groupCount] of [
        [5, 0],
        [0, 20],
      ]) {
        const ctx = joinContext(joinDatabase({ userCount, groupCount }));
        await compileBranch(joinBranch, ctx);
        assert.equal(ctx.admin.calls.filter((q) => q.op === "insert").length, 0);
        assert.equal(ctx.telegramCalls.length, 0);
      }
    },
  ],
  [
    "failed DM marks delivery failure without approval",
    async () => {
      const ctx = joinContext(joinDatabase());
      ctx.sendMessageWithOutcome = async () => ({ status: "failed", errorClass: "dm_blocked" });
      await compileBranch(joinBranch, ctx);
      assert.ok(
        ctx.admin.calls.some((q) => q.op === "update" && q.payload.status === "delivery_failed"),
      );
      assert.equal(ctx.telegramCalls.length, 0);
    },
  ],
  [
    "incorrect/expired/spoofed/replayed claim never calls approval",
    async () => {
      for (const result of [
        "incorrect",
        "incorrect_limit",
        "expired",
        "not_found",
        "already_processed",
        "disabled",
      ]) {
        const ctx = callbackContext(result);
        await compileBranch(callbackBranch, ctx);
        assert.equal(ctx.telegramCalls.length, 0);
      }
    },
  ],
  [
    "nonprivate callback never claims or approves",
    async () => {
      const ctx = callbackContext();
      ctx.callbackChat.type = "group";
      ctx.admin.rpc = async () => {
        throw new Error("unexpected claim");
      };
      await compileBranch(callbackBranch, ctx);
      assert.equal(ctx.telegramCalls.length, 0);
    },
  ],
  [
    "successful atomic claim approves once",
    async () => {
      const ctx = callbackContext();
      await compileBranch(callbackBranch, ctx);
      assert.deepEqual(ctx.telegramCalls, ["approveChatJoinRequest"]);
      assert.ok(ctx.admin.calls.some((q) => q.op === "update" && q.payload.status === "approved"));
    },
  ],
  [
    "ambiguous approval reconciles once and remains manual review",
    async () => {
      const ctx = callbackContext();
      ctx.telegramJson = async (_token, method) => {
        ctx.telegramCalls.push(method);
        if (method === "approveChatJoinRequest") throw new Error("timeout");
        return { status: "left" };
      };
      await compileBranch(callbackBranch, ctx);
      assert.deepEqual(ctx.telegramCalls, ["approveChatJoinRequest", "getChatMember"]);
      assert.ok(
        ctx.admin.calls.some((q) => q.op === "update" && q.payload.status === "needs_review"),
      );
    },
  ],
  [
    "rotated invite blocks approval after claim",
    async () => {
      const ctx = callbackContext();
      ctx.memberVerificationInviteFingerprint = async () => "c".repeat(64);
      await compileBranch(callbackBranch, ctx);
      assert.equal(ctx.telegramCalls.length, 0);
    },
  ],
  [
    "cleanup is bounded and retains manual review longer",
    async () => {
      assert.ok(migration.includes("'telegram-member-verification-retention'"));
      assert.ok(migration.includes("LIMIT 5000"));
      assert.ok(migration.includes("FOR UPDATE SKIP LOCKED"));
      assert.ok(migration.includes("interval '7 days'"));
      assert.ok(migration.includes("interval '48 hours'"));
      assert.ok(migration.includes("status IN ('approved','expired','incorrect_limit')"));
    },
  ],
  [
    "database insertion serializes rolling rate budgets",
    async () => {
      assert.ok(migration.includes("pg_advisory_xact_lock"));
      assert.ok(
        migration.indexOf("pg_advisory_xact_lock") < migration.indexOf("rate limit reached"),
      );
      assert.ok(migration.includes("TG_OP = 'INSERT'"));
    },
  ],
];
let behavioralPassed = 0;
for (const [label, test] of behaviorTests) {
  try {
    await test();
    behavioralPassed++;
    process.stdout.write("PASS  " + label + "\n");
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write("FAIL  " + label + ": " + error + "\n");
  }
}
process.stdout.write(
  `${behavioralPassed}/${behaviorTests.length} isolated handler/policy checks passed. SQL execution and live Telegram acceptance are separate gates.\n`,
);
