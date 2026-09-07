/**
 * Hardening B focused regression check.
 *
 * Deterministic, dependency-free (node:assert + node:fs only), run with:
 *   bun run scripts/hardening-b-regression.ts
 *
 * READ ONLY: pure source/logic assertions. No network, no Supabase client, no
 * RPC, no migration application, no wallet or transaction activity.
 *
 * Protects the Hardening B contract:
 *   A) managed FINALIZED production evidence with confirmations 0 is eligible
 *   B) managed FINALIZED production evidence with confirmations 4 is eligible
 *   C) non-finalized evidence still fails
 *   D) unmanaged finality still fails
 *   E) finalized block-number mismatch fails
 *   F) finalized head behind the deployment block fails
 *   G) the staged SQL has no five-confirmation gate and keeps managed finality
 *   H) testnet keeps the fixed 5-confirmation evidence rule
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ROBINHOOD_TESTNET_CHAIN_ID } from "../src/lib/chain-registry";
import {
  evaluateLaunchDeploymentEvidence,
  type DeploymentEvidenceInput,
  type LaunchEvidenceContext,
} from "../src/lib/launch-verified-eligibility";

const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const context: LaunchEvidenceContext = {
  launchId: LAUNCH_ID,
  workspaceId: WORKSPACE_ID,
  declaredChain: "Robinhood Chain",
  launchStatus: "CONTRACT_PENDING",
  officialContractAddress: null,
  officialContractDeploymentId: null,
  contractRegisteredAt: null,
};

const SUPPLY = "1000000000000000000000000";

function productionRow(overrides: Partial<DeploymentEvidenceInput> = {}): DeploymentEvidenceInput {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    attempt_number: 1,
    launch_id: LAUNCH_ID,
    workspace_id: WORKSPACE_ID,
    deployment_kind: "FIXED_SUPPLY_ERC20",
    network_environment: "PRODUCTION",
    chain_id: 4663,
    status: "CONFIRMED",
    tx_hash: `0x${"a".repeat(64)}`,
    contract_address: `0x${"b".repeat(40)}`,
    confirmations: 0,
    block_number: 900,
    submitted_at: "2026-09-07T00:00:00.000Z",
    verified_at: "2026-09-07T00:01:00.000Z",
    created_at: "2026-09-07T00:00:00.000Z",
    artifact_id: "cartel-fixed-erc20-v1",
    failure_code: null,
    failure_detail: null,
    token_name: "Pepe Cartel",
    token_symbol: "CARTEL",
    token_decimals: 18,
    token_total_supply_text: SUPPLY,
    verified_token_name: "Pepe Cartel",
    verified_token_symbol: "CARTEL",
    verified_token_decimals: 18,
    verified_total_supply_text: SUPPLY,
    verified_recipient_balance_text: SUPPLY,
    finality_state: "FINALIZED",
    finalized_block_hash_confirmed: true,
    finality_provider_kind: "MANAGED",
    finalized_at: "2026-09-07T00:02:00.000Z",
    finalized_block_number: 900,
    finalized_head_block_number: 901,
    ...overrides,
  };
}

function evaluateOne(row: DeploymentEvidenceInput, ctx: LaunchEvidenceContext = context) {
  const result = evaluateLaunchDeploymentEvidence(ctx, [row]);
  const only = result.deployments[0];
  assert.ok(only, "expected exactly one evaluated deployment");
  return only;
}

const failures: string[] = [];
function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL  ${name}\n      ${(error as Error).message}`);
  }
}

/* A */
run("A: managed FINALIZED production evidence with 0 confirmations is eligible", () => {
  const d = evaluateOne(productionRow({ confirmations: 0 }));
  assert.equal(d.evidenceVerified, true);
  assert.equal(d.officialRegistrationEligible, true, d.registrationBlockReasons.join("; "));
  assert.deepEqual(d.registrationBlockReasons, []);
  const depth = d.evidenceChecks.find((c) => c.id === "confirmations");
  assert.equal(depth?.state, "PASS");
  assert.match(depth?.detail ?? "", /diagnostic/i);
  assert.equal(d.confirmations, 0, "confirmations stay visible as diagnostic information");
});

/* B */
run("B: managed FINALIZED production evidence with 4 confirmations is eligible", () => {
  const d = evaluateOne(productionRow({ confirmations: 4 }));
  assert.equal(d.officialRegistrationEligible, true, d.registrationBlockReasons.join("; "));
  assert.equal(d.confirmations, 4);
});

/* C */
run("C: non-finalized production evidence still fails", () => {
  for (const state of ["FINALITY_PENDING", "PROVIDER_INCONSISTENT", null]) {
    const d = evaluateOne(productionRow({ confirmations: 50, finality_state: state }));
    assert.equal(d.officialRegistrationEligible, false, `state ${state} must not be eligible`);
    assert.ok(d.registrationBlockReasons.includes("Managed finality is not FINALIZED"));
  }
});

/* D */
run("D: unmanaged finality still fails", () => {
  const d = evaluateOne(productionRow({ confirmations: 50, finality_provider_kind: "SELF" }));
  assert.equal(d.officialRegistrationEligible, false);
  assert.ok(
    d.registrationBlockReasons.includes(
      "Finality evidence was not recorded by a managed provider",
    ),
  );

  const unconfirmedHash = evaluateOne(
    productionRow({ finalized_block_hash_confirmed: false }),
  );
  assert.equal(unconfirmedHash.officialRegistrationEligible, false);

  const noFinalizedAt = evaluateOne(productionRow({ finalized_at: null }));
  assert.equal(noFinalizedAt.officialRegistrationEligible, false);
});

/* E */
run("E: finalized block-number mismatch fails", () => {
  for (const finalized of [899, 901, null]) {
    const d = evaluateOne(productionRow({ finalized_block_number: finalized }));
    assert.equal(d.officialRegistrationEligible, false, `finalized block ${finalized}`);
    assert.ok(
      d.registrationBlockReasons.includes(
        "Finalized block number does not match the recorded deployment block",
      ),
    );
  }
});

/* F */
run("F: finalized head behind the deployment block fails", () => {
  for (const head of [899, null]) {
    const d = evaluateOne(productionRow({ finalized_head_block_number: head }));
    assert.equal(d.officialRegistrationEligible, false, `head ${head}`);
    assert.ok(
      d.registrationBlockReasons.includes(
        "Finalized head block is behind the recorded deployment block",
      ),
    );
  }
});

/* G */
run("G: staged SQL removes the five-confirmation gate and keeps managed finality", () => {
  const sql = readFileSync("docs/sql/HARDENING_B_assert_launch_contract_evidence.sql", "utf8");
  const body = sql.slice(sql.indexOf("create or replace function"));
  assert.ok(
    !/coalesce\s*\(\s*d\.confirmations[^)]*\)\s*<\s*5/i.test(body),
    "confirmation-depth rejection must be gone",
  );
  assert.ok(!/fewer than 5 confirmations/i.test(body));
  for (const required of [
    "d.finality_state is distinct from 'FINALIZED'",
    "d.finalized_block_hash_confirmed is not true",
    "d.finality_provider_kind is distinct from 'MANAGED'",
    "d.finalized_at is null",
    "d.finalized_block_number is distinct from d.block_number",
    "d.finalized_head_block_number < d.block_number",
    "security definer",
    "set search_path to 'public'",
    "grant execute on function public.assert_launch_contract_evidence",
  ]) {
    assert.ok(body.includes(required), `staged SQL must retain: ${required}`);
  }
});

/* H */
run("H: testnet keeps the fixed 5-confirmation evidence rule", () => {
  const testnetContext: LaunchEvidenceContext = {
    ...context,
    declaredChain: "Robinhood Chain Testnet",
  };
  const shallow = evaluateOne(
    productionRow({
      network_environment: "TESTNET",
      chain_id: ROBINHOOD_TESTNET_CHAIN_ID,
      confirmations: 4,
    }),
    testnetContext,
  );
  assert.equal(shallow.evidenceChecks.find((c) => c.id === "confirmations")?.state, "FAIL");
  assert.equal(shallow.officialRegistrationEligible, false);
});

if (failures.length > 0) {
  console.error(`\n${failures.length} regression check(s) failed.`);
  process.exit(1);
}
console.log("\nHardening B regression: all checks passed.");
