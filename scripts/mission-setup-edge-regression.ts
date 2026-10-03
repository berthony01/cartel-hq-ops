/** Focused read-only regression for the production Auto-select Edge handler. */
import { computeInitDataHash } from "../src/lib/telegram-miniapp-auth.server";
import {
  handleSetupAutoSelect,
  type SetupAutoSelectDeps,
} from "../backend-source/edge-functions/social-mission-setup/handler";

const botToken = "test-only-token";
const serviceRoleKey = "test-only-service-role";
const candidateId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const startParam = `ms_${candidateId}_${connectionId}`;

async function signedInitData(param = startParam): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    start_param: param,
    user: JSON.stringify({ id: 424242, first_name: "Admin" }),
  });
  const pairs = [...params.entries()].map(([key, value]) => `${key}=${value}`).sort().join("\n");
  params.set("hash", await computeInitDataHash(pairs, botToken));
  return params.toString();
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  ok ? passed += 1 : failed += 1;
}

function request(initData: string, authorized = true): Request {
  return new Request("https://example.test/functions/v1/social-mission-setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorized ? `Bearer ${serviceRoleKey}` : "Bearer wrong",
      "X-Cartel-Internal-Source": "telegram-miniapp-bridge",
    },
    body: JSON.stringify({ action: "auto_select", initData }),
  });
}

function deps(overrides: Partial<SetupAutoSelectDeps> = {}) {
  let providerReads = 0;
  let suggestions = 0;
  const value: SetupAutoSelectDeps = {
    serviceRoleKey,
    botToken,
    authorizeReadySetup: async () => ({ ok: true, externalPostId: "123456789" }),
    readMetrics: async () => {
      providerReads += 1;
      return { observedAt: "2026-10-03T23:00:00.000Z", metrics: { views: 100, likes: 20, comments: null, shares: 4, saves: null } };
    },
    suggestTargets: async () => {
      suggestions += 1;
      return { likes: 25, replies: null, reposts: 6, bookmarks: 0 };
    },
    ...overrides,
  };
  return { value, counts: () => ({ providerReads, suggestions }) };
}

const signed = await signedInitData();
const unauthorized = deps();
const unauthorizedResponse = await handleSetupAutoSelect(request(signed, false), unauthorized.value);
check("service-only header rejects before authorization/provider", unauthorizedResponse.status === 401 && unauthorized.counts().providerReads === 0);

let authCalls = 0;
const denied = deps({ authorizeReadySetup: async () => { authCalls += 1; return { ok: false, reason: "mission_setup_unavailable" }; } });
const deniedResponse = await handleSetupAutoSelect(request(signed), denied.value);
check("failed operator/admin/READY authorization performs zero provider reads", deniedResponse.status === 403 && authCalls === 1 && denied.counts().providerReads === 0);

const malformed = deps();
const malformedResponse = await handleSetupAutoSelect(request(await signedInitData("ms_bad")), malformed.value);
check("signed malformed setup route fails before authorization/provider", malformedResponse.status === 403 && malformed.counts().providerReads === 0);

const tampered = deps();
const tamperedData = signed.replace("Admin", "Intruder");
const tamperedResponse = await handleSetupAutoSelect(request(tamperedData), tampered.value);
check("tampered initData fails signature validation before authorization/provider", tamperedResponse.status === 401 && tampered.counts().providerReads === 0);

const unavailable = deps({ readMetrics: async () => null });
const unavailableResponse = await handleSetupAutoSelect(request(signed), unavailable.value);
const unavailableBody = await unavailableResponse.json() as Record<string, any>;
check("missing provider metrics are unavailable and never synthetic zero", unavailableBody.ok === true && unavailableBody.suggestion.available === false && Object.keys(unavailableBody.suggestion.targets).length === 0);

const success = deps();
const successResponse = await handleSetupAutoSelect(request(signed), success.value);
const successBody = await successResponse.json() as Record<string, any>;
check("authorized READY setup performs one provider read and one policy suggestion", successResponse.status === 200 && success.counts().providerReads === 1 && success.counts().suggestions === 1);
check("response is bounded to positive reviewable four-goal targets", JSON.stringify(successBody.suggestion.targets) === '{"likes":25,"reposts":6}' && successBody.suggestion.observedAt === "2026-10-03T23:00:00.000Z");

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);