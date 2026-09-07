/**
 * P3C-E — PRODUCTION verifier result shape + local chain/init-code helpers.
 *
 * Extracted verbatim from `chain-mainnet-verify.functions.ts` for the
 * oversized-file requirement. Behavior is unchanged. READ-ONLY: nothing here
 * signs, sends, or writes.
 */
import { defineChain, encodeAbiParameters } from "viem";
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";
import { CARTEL_FIXED_ERC20_CREATION_BYTECODE } from "./cartel-fixed-erc20.artifact";
import { STATE_WRITES_ENABLED } from "./chain-mainnet-verify-apply";

export type MainnetFinalityClassification =
  | "NOT_CHECKED"
  | "FINALITY_PENDING"
  | "FINALIZED_CANDIDATE"
  | "PROVIDER_INCONSISTENT";

export type MainnetVerifyResult = {
  /** Current DB status. Only ever promoted after the matching apply landed. */
  status: string;
  /** Independently observed from the managed provider, never from the browser. */
  contractAddress: string | null;
  blockNumber: string | null;
  blockHash: string | null;
  /**
   * Diagnostic only. NEVER a gate. Present purely for display parity with the
   * testnet console.
   */
  observationalConfirmations: number | null;
  finality: MainnetFinalityClassification;
  finalizedHeadBlockNumber: string | null;
  finalityAuthority: "MANAGED" | null;
  /** Deterministic, non-secret code. Includes retryable and mismatch codes. */
  notice: string | null;
  /** Truthful mirror of the authoritative verifier state-write gate. */
  stateWritesEnabled: boolean;
};

export function baseResult(status: string): MainnetVerifyResult {
  return {
    status,
    contractAddress: null,
    blockNumber: null,
    blockHash: null,
    observationalConfirmations: null,
    finality: "NOT_CHECKED",
    finalizedHeadBlockNumber: null,
    finalityAuthority: null,
    notice: null,
    // Reports the actual gate state; never hardcoded.
    stateWritesEnabled: STATE_WRITES_ENABLED,
  };
}

/** Production chain descriptor built locally; no testnet registry import. */
export function mainnetChain(rpcUrl: string) {
  return defineChain({
    id: ROBINHOOD_MAINNET_CHAIN_ID,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/**
 * Rebuilds the frozen creation init code from stored intent. The transaction
 * input must equal this byte-for-byte: the browser never supplies bytecode.
 */
export function buildInitCode(intent: {
  name: string;
  symbol: string;
  totalSupply: bigint;
  recipient: `0x${string}`;
}): `0x${string}` {
  const args = encodeAbiParameters(
    [
      { type: "string", name: "name_" },
      { type: "string", name: "symbol_" },
      { type: "uint256", name: "totalSupply_" },
      { type: "address", name: "recipient_" },
    ],
    [intent.name, intent.symbol, intent.totalSupply, intent.recipient],
  );
  return `${CARTEL_FIXED_ERC20_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}
