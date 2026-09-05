# C8.7B audit follow-up (optional, not executed)

No file was changed by the audit. This is the smallest corrective set if you authorize a later phase; nothing here is required for C8.7B to stand, because every gap fails closed at the database.

## Proposed corrections (client-side only, `src/lib/launch-verified-eligibility.ts` + panel wording)

1. Close the client/database parity gap on verified-vs-requested identity: add `token_name`, `token_symbol`, `token_decimals`, `token_total_supply` to the evaluator input and require equality with the verified read-back values, mirroring `assert_launch_contract_evidence`.
2. Require lowercase hex for `tx_hash` and `contract_address`, matching the database regex.
3. Fix the mixed production + testnet wording: when exactly one candidate is eligible, do not label the launch "No candidate is selected automatically" and do not mark the sole eligible production row `ambiguous`.
4. Add `officialContractDeploymentId` to the evaluator context so a partial registration record (deployment id present, address null) is treated as registered rather than eligible.
5. Optional: clear the remaining pre-existing prettier debt in `src/routes/_authenticated/launch-control.tsx` (54 errors, all `prettier/prettier`, below the 60-error baseline).

## Not in scope

No database, migration, RPC, wallet, liquidity, Telegram, notification, lifecycle, package or publish change.
