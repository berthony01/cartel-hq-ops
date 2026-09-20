/**
 * PCART Treasury Signer Setup — Phase A regression.
 *
 * PURE SOURCE/STATIC assertions plus pure validation fixtures. No network, no
 * RPC, no wallet, no database, no chain, no environment value is read. It
 * proves the signer-capture foundation records public addresses only, is
 * owner-only and fail-closed, stays non-gating for production submission, and
 * activates nothing.
 *
 * Address fixtures are CONSTRUCTED at runtime. No signer address literal is
 * hardcoded anywhere in the app, migration, docs or this suite.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";

import {
  TREASURY_SIGNER_COUNT,
  TREASURY_SIGNER_THRESHOLD,
  displaySigner,
  normalizeSigner,
  validateSigners,
} from "../src/lib/treasury-signers";

const LIB = "src/lib/treasury-signers.ts";
const PANEL = "src/components/cartel/TreasurySignerSetupPanel.tsx";
const ROUTE = "src/routes/_authenticated/launch-control.tsx";
const REQUEST_PANEL = "src/components/cartel/ProductionDeploymentRequestPanel.tsx";
const VERIFIER = "src/lib/treasury-safe-verify.ts";
const VERIFIER_FN = "src/lib/treasury-safe-verify.functions.ts";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const MIGRATIONS = "supabase/migrations";
const MIGRATION_FILE = "20260920053942_42259f41-35d1-4b5c-9e6a-78127867cddd.sql";
// Narrow completion migration: re-applies the owner-only INSERT/UPDATE policies and
// authenticated table grants that did not take effect when the first file was applied.
const POLICY_COMPLETION_MIGRATION_FILE =
  "20260920054150_5dcb8ca1-aba1-4c9b-995e-cd9ff00da488.sql";

const read = (p: string) => readFileSync(p, "utf8");

const libSrc = read(LIB);
const panelSrc = read(PANEL);
const routeSrc = read(ROUTE);
const requestPanelSrc = read(REQUEST_PANEL);
const registrySrc = read(REGISTRY);
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const migrationSrc = read(join(MIGRATIONS, MIGRATION_FILE));

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

// ---------------------------------------------- constructed address fixtures
const addr = (nibble: string) => `0x${nibble.repeat(40)}`;
const A = addr("1");
const B = addr("2");
const C = addr("3");
const ZERO = addr("0");
const MIXED_CASE = `0x${"aB".repeat(20)}`;

// -------------------------------------------------------- 1. pure validation
check("TS-1a", validateSigners([A, B, C]).ok, "three distinct valid addresses validate");
check(
  "TS-1b",
  !validateSigners(["", B, C]).ok &&
    !validateSigners([A.slice(0, 20), B, C]).ok &&
    !validateSigners([`${A}00`, B, C]).ok &&
    !validateSigners([addr("z"), B, C]).ok,
  "empty, short, long and non-hex inputs are rejected",
);
check("TS-1c", !validateSigners([ZERO, B, C]).ok, "the zero address is rejected");
check(
  "TS-1d",
  !validateSigners([A, A, C]).ok &&
    !validateSigners([A, A.toUpperCase().replace("0X", "0x"), C]).ok,
  "duplicates are rejected, including after lowercase normalization",
);
check(
  "TS-1e",
  !validateSigners([A, B]).ok && !validateSigners([A, B, C, A]).ok,
  "exactly three signer wallets are required",
);
const okResult = validateSigners([` ${MIXED_CASE} `, B, C]);
check(
  "TS-1f",
  okResult.ok && okResult.signers[0] === MIXED_CASE.toLowerCase(),
  "stored values are trimmed and lowercase-normalized",
);
check(
  "TS-1g",
  normalizeSigner(` ${MIXED_CASE} `) === MIXED_CASE.toLowerCase() &&
    displaySigner(MIXED_CASE.toLowerCase()) === getAddress(MIXED_CASE.toLowerCase()),
  "display uses viem getAddress checksum while storage stays lowercase",
);
check(
  "TS-1h",
  TREASURY_SIGNER_COUNT === 3 && TREASURY_SIGNER_THRESHOLD === 2,
  "signer count is fixed at 3 and threshold fixed at 2",
);

// ---------------------------------------------------------------- 2. library
check(
  "TS-2a",
  libSrc.includes('from "@/lib/treasury-safe-verify"') &&
    libSrc.includes("isCandidateTreasuryAddress") &&
    libSrc.includes("normalizeTreasuryAddress"),
  "library reuses the hardened verifier address helpers",
);
check(
  "TS-2b",
  libSrc.includes('db.rpc("save_launch_treasury_signers"') &&
    !/\.from\("launch_treasury_signer_configs"\)[\s\S]{0,200}(insert|update|upsert|delete)\(/.test(
      libSrc,
    ),
  "writes go only through the owner-only RPC; no direct table write or delete",
);
check(
  "TS-2c",
  !/privateKey|seedPhrase|mnemonic|signMessage|sendTransaction|walletClient/i.test(libSrc) &&
    !/privateKey|seedPhrase|mnemonic|signMessage|sendTransaction|walletClient/i.test(panelSrc),
  "no private key, seed phrase, signing or send path exists in the library or panel",
);
check(
  "TS-2d",
  !/0x[0-9a-fA-F]{40}/.test(libSrc) &&
    !/0x[0-9a-fA-F]{40}/.test(panelSrc) &&
    !/0x[0-9a-fA-F]{40}/.test(migrationSrc),
  "no hardcoded signer/treasury address literal in the library, panel or migration",
);

// -------------------------------------------------------------------- 3. UI
const REQUIRED_COPY = [
  "These are three keys to one treasury, not three wallets that receive the token.",
  "The treasury will use 2-of-3 approval, so any two signer wallets can approve a treasury",
  "Enter public 0x wallet addresses only. Never enter a seed phrase or private key.",
  "You can change these addresses before the Safe is created. Creating/changing the Safe",
  "Saving here only records your intended signers. It does not create a Safe, sign anything,",
];
for (const [i, copy] of REQUIRED_COPY.entries()) {
  check(`TS-3a${i + 1}`, panelSrc.includes(copy), `panel carries required safety copy ${i + 1}`);
}
check(
  "TS-3b",
  panelSrc.includes("Save signer wallets") && !/Create Safe/.test(panelSrc),
  'the button reads "Save signer wallets"; there is no "Create Safe" control',
);
check(
  "TS-3c",
  panelSrc.includes("Signatures required: 2 of 3 (fixed)") &&
    !/setThreshold|threshold\s*=\s*Number|onChange=\{[^}]*threshold/i.test(panelSrc),
  "threshold is presented read-only and cannot be edited in the UI",
);
check(
  "TS-3d",
  panelSrc.includes("Signer wallet {index + 1}") &&
    panelSrc.includes("Signers ready") &&
    panelSrc.includes("Not set"),
  "panel labels the three signer fields and shows Signers ready / Not set states",
);
check(
  "TS-3e",
  panelSrc.includes("isWorkspaceOwner") &&
    panelSrc.includes("Only the workspace owner can record the signer wallets."),
  "non-owner presentation is read-only",
);
check(
  "TS-3f",
  !/refetchInterval|setInterval|setTimeout/.test(panelSrc),
  "no polling or background write",
);

// --------------------------------------------------------------- 4. mounting
check(
  "TS-4a",
  routeSrc.includes("TreasurySignerSetupPanel") &&
    routeSrc.indexOf("<TreasurySignerSetupPanel") <
      routeSrc.indexOf("<ProductionDeploymentRequestPanel"),
  "panel is mounted immediately before the production deployment request panel",
);
check(
  "TS-4b",
  !requestPanelSrc.includes("TreasurySignerSetupPanel") &&
    !requestPanelSrc.includes("launch_treasury_signer_configs") &&
    !requestPanelSrc.includes("treasury-signers"),
  "ProductionDeploymentRequestPanel is untouched by this phase",
);
check(
  "TS-4c",
  !/launch_treasury_signer_configs|save_launch_treasury_signers/.test(
    read("src/lib/launch-production-request.ts"),
  ),
  "production request submission does not depend on the signer table",
);

// ------------------------------------------------ 4bis. UX placement (UX pass)
check(
  "TS-4d",
  /\{ id: "lc-contract", label: "Deploy & Contract" \}/.test(routeSrc) &&
    routeSrc.includes('"lc-contract"'),
  'lc-contract keeps its section id and renders the visible label "Deploy & Contract"',
);
check(
  "TS-4e",
  routeSrc.includes("Deployment path — before deployment") &&
    routeSrc.indexOf("Deployment path — before deployment") <
      routeSrc.indexOf("<TreasurySignerSetupPanel"),
  "the deployment-path guidance block sits above the treasury signer panel",
);
check(
  "TS-4f",
  routeSrc.includes("Save the three treasury signer wallets below.") &&
    routeSrc.includes("Create and verify the 2-of-3 Safe.") &&
    routeSrc.includes("Request the production deployment") &&
    routeSrc.includes("register the official contract."),
  "guidance states signer save -> Safe create/verify later -> production deployment -> official registration",
);
check(
  "TS-4g",
  routeSrc.includes("Saving signer wallets does not create the Safe."),
  "guidance explicitly says saving signers does not create the Safe",
);
check(
  "TS-4h",
  panelSrc.includes("Step 1 · Before deployment") &&
    panelSrc.includes("Treasury signer setup"),
  "panel carries the Step 1 / before-deployment cue and step title",
);
check(
  "TS-4i",
  panelSrc.includes("The Safe has not been created yet."),
  "the ready state states plainly that the Safe has not been created yet",
);
check(
  "TS-4j",
  !/Create Safe/.test(panelSrc) && !/Create Safe/.test(routeSrc),
  'no "Create Safe" control exists in the panel or the route',
);

// -------------------------------------------------------------- 5. migration
check(
  "TS-5a",
  migrationFiles.length === 84 &&
    migrationFiles.includes(MIGRATION_FILE) &&
    migrationFiles.includes(POLICY_COMPLETION_MIGRATION_FILE),
  `treasury signer migration plus its policy completion are pinned (${migrationFiles.length} files)`,
);
check(
  "TS-5b",
  /CREATE TABLE public\.launch_treasury_signer_configs/.test(migrationSrc) &&
    /signer_1 text NOT NULL/.test(migrationSrc) &&
    /signer_2 text NOT NULL/.test(migrationSrc) &&
    /signer_3 text NOT NULL/.test(migrationSrc) &&
    !/^\s*(signer_addresses|status|safe_address|state)\s+\w/m.test(migrationSrc),
  "three explicit signer columns; no lifecycle status or Safe address column",
);
check(
  "TS-5c",
  /UNIQUE \(launch_id\)/.test(migrationSrc) &&
    /CHECK \(threshold = 2\)/.test(migrationSrc) &&
    (migrationSrc.match(/\^0x\[0-9a-f\]\{40\}\$/g) ?? []).length >= 4 &&
    /signers_nonzero/.test(migrationSrc) &&
    /signers_distinct/.test(migrationSrc),
  "unique launch, fixed threshold, lowercase shape, nonzero and distinct constraints",
);
check(
  "TS-5d",
  /ENABLE ROW LEVEL SECURITY/.test(migrationSrc) &&
    (migrationSrc.match(/is_workspace_owner\(workspace_id, auth\.uid\(\)\)/g) ?? []).length >= 4,
  "RLS enabled with owner checks on select, insert and update (using + with check)",
);
check(
  "TS-5e",
  !/TO anon|GRANT[^\n]*anon(?!,)/.test(migrationSrc.replace(/FROM PUBLIC, anon;/g, "")) &&
    !/GRANT DELETE|FOR DELETE/.test(migrationSrc),
  "no anon grant or policy; no DELETE grant or policy",
);
check(
  "TS-5f",
  /GRANT SELECT, INSERT, UPDATE ON public\.launch_treasury_signer_configs TO authenticated;/.test(
    migrationSrc,
  ) && /GRANT ALL ON public\.launch_treasury_signer_configs TO service_role;/.test(migrationSrc),
  "authenticated gets select/insert/update only; service_role gets all",
);
check(
  "TS-5g",
  /SECURITY DEFINER/.test(migrationSrc) && /SET search_path = public/.test(migrationSrc),
  "save RPC is SECURITY DEFINER with a pinned search_path",
);
check(
  "TS-5h",
  /SELECT l\.workspace_id INTO v_workspace_id/.test(migrationSrc) &&
    !/^\s*_workspace_id uuid/m.test(migrationSrc),
  "RPC resolves the workspace from the launch row and accepts none from the client",
);
check(
  "TS-5i",
  /lower\(btrim\(coalesce\(_signer_1/.test(migrationSrc) &&
    /Each signer must be a valid 0x wallet address\./.test(migrationSrc) &&
    /cannot be the empty address\./.test(migrationSrc) &&
    /must be different\./.test(migrationSrc),
  "RPC normalizes and revalidates shape, nonzero and distinctness server-side",
);
check(
  "TS-5j",
  /threshold, created_by, updated_by/.test(migrationSrc) &&
    /VALUES \(v_workspace_id, _launch_id, v_s1, v_s2, v_s3, 2, v_uid, v_uid\)/.test(
      migrationSrc,
    ) && /SET[\s\S]{0,200}threshold = 2,/.test(migrationSrc),
  "threshold is the server-side literal 2 on insert and update",
);
check(
  "TS-5k",
  /REVOKE ALL ON FUNCTION public\.save_launch_treasury_signers[\s\S]{0,120}FROM PUBLIC, anon;/.test(
    migrationSrc,
  ) &&
    /GRANT EXECUTE ON FUNCTION public\.save_launch_treasury_signers[\s\S]{0,120}TO authenticated;/.test(
      migrationSrc,
    ),
  "save RPC is revoked from PUBLIC/anon and granted to authenticated",
);
check(
  "TS-5l",
  !/^\s*(private_key|seed_phrase|mnemonic|secret)\s+\w/mi.test(migrationSrc) &&
    !/(private_key|seed_phrase|mnemonic)/i.test(migrationSrc),
  "the migration stores no private key, seed phrase or secret",
);
check(
  "TS-5m",
  !/DROP TABLE|DROP FUNCTION|TRUNCATE|DELETE FROM/i.test(migrationSrc),
  "the migration is additive only",
);

// ------------------------------------------ 6. nothing else was activated
const verifierHash = (p: string) => read(p).length;
check(
  "TS-6a",
  read(VERIFIER).includes("PCART_REQUIRED_THRESHOLD") &&
    !read(VERIFIER).includes("launch_treasury_signer_configs") &&
    !read(VERIFIER_FN).includes("launch_treasury_signer_configs") &&
    verifierHash(VERIFIER) > 0,
  "the hardened Safe verifier is not wired into or weakened by this phase",
);
check(
  "TS-6b",
  /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(registrySrc),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);
check(
  "TS-6c",
  read("src/lib/cartel-fixed-erc20.artifact.ts").includes("cartel-fixed-erc20-v1"),
  "the approved production artifact remains cartel-fixed-erc20-v1",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
