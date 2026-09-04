import { defineChain } from "viem";

/**
 * C8.2 — Cartel Chain Launcher registry.
 *
 * TESTNET ONLY, BY CONSTRUCTION.
 *
 * This registry is a frozen code constant rather than a database table on
 * purpose: a table row could be edited to introduce a mainnet target, while a
 * constant makes the absence of mainnet a reviewable property of the shipped
 * artifact. Robinhood Chain mainnet (chain id 4663) is not disabled here — it
 * is entirely absent, and no other module holds a chain configuration.
 *
 * Nothing in this file, or anything that consumes it, may write
 * `launches.official_contract_address` or change a launch lifecycle status.
 */

export const ROBINHOOD_TESTNET_CHAIN_ID = 46630 as const;
export const NETWORK_ENVIRONMENT = "TESTNET" as const;

/**
 * The public endpoint is rate limited and explicitly "not for production".
 * It is acceptable for C8.2 internal test mode. A managed provider can be
 * supplied later through this single override with no data-model change.
 */
export const ROBINHOOD_TESTNET_RPC_URL =
  (import.meta.env['VITE_ROBINHOOD_TESTNET_RPC_URL'] as string | undefined)?.trim() ||
  "https://rpc.testnet.chain.robinhood.com";

export const ROBINHOOD_TESTNET_EXPLORER_URL =
  "https://explorer.testnet.chain.robinhood.com";

/** Conservative confirmation depth before an attempt may be called CONFIRMED. */
export const REQUIRED_CONFIRMATIONS = 5 as const;

export const robinhoodTestnet = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_TESTNET_RPC_URL] } },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: ROBINHOOD_TESTNET_EXPLORER_URL },
  },
  testnet: true,
});

/** EIP-3085/3326 chain id in hex, used for wallet_switchEthereumChain. */
export const CHAIN_ID_HEX = `0x${ROBINHOOD_TESTNET_CHAIN_ID.toString(16)}` as const;

/**
 * C8.2 TEST ARTIFACT — not a token, by design.
 *
 * Creation bytecode: 0x600180600b6000396000f3fd
 *   60 01        PUSH1 0x01     runtime length
 *   80           DUP1
 *   60 0b        PUSH1 0x0b     runtime offset in this init code
 *   60 00        PUSH1 0x00     memory destination
 *   39           CODECOPY
 *   60 00        PUSH1 0x00
 *   f3           RETURN         returns 1 byte of runtime code
 *   fd           <runtime>      REVERT
 *
 * The deployed runtime code is the single byte 0xfd. REVERT with an empty
 * stack underflows and reverts, so EVERY call to the deployed contract —
 * including any call carrying value — reverts. The contract therefore has no
 * token semantics, no privileged methods, no owner, no storage writes, no
 * asset custody and no value-transfer path. It can never hold or move funds.
 *
 * The bytecode is a fixed constant: the user never supplies or influences it.
 */
export const TEST_ARTIFACT_CREATION_BYTECODE =
  "0x600180600b6000396000f3fd" as const;

/** Expected `eth_getCode` result for a correctly deployed test artifact. */
export const TEST_ARTIFACT_RUNTIME_BYTECODE = "0xfd" as const;

export function explorerTxUrl(txHash: string): string {
  return `${ROBINHOOD_TESTNET_EXPLORER_URL}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${ROBINHOOD_TESTNET_EXPLORER_URL}/address/${address}`;
}
