/**
 * P1 — Robinhood Chain PRODUCTION (mainnet, chain id 4663) READ-ONLY descriptor.
 *
 * SCOPE AND SAFETY
 * ----------------
 * This module is a self-contained, read-only network identity record. It does
 * NOT import from, extend, or modify the testnet registry
 * (`src/lib/chain-registry.ts`), and the testnet launcher does not read it.
 * Nothing here creates, enables, or describes a way to sign, broadcast, or
 * settle a production transaction.
 *
 * Explicit security properties of this file:
 *  - The public RPC endpoint below is DIAGNOSTIC ONLY. It is rate limited,
 *    documented as unsuitable for production, and must NEVER be treated as
 *    authoritative for production verification, finality, or evidence.
 *  - The managed production RPC URL is SERVER-ONLY. It is referenced here by
 *    environment-variable NAME only. It must never be placed in a `VITE_*`
 *    variable, never be imported into client code, and never be returned,
 *    logged, or serialized to a browser.
 *  - Both production transaction switches are FROZEN `false` in P1. Nothing in
 *    the codebase assigns to them or branches around them.
 *  - This file intentionally exposes NO `CHAIN_ID_HEX`, no
 *    `wallet_addEthereumChain` / `wallet_switchEthereumChain` parameters, no
 *    signer helper, no transaction builder, no contract bytecode or artifact,
 *    no Uniswap address, no Permit2 address, no router / factory /
 *    position-manager address, and no liquidity target. Their absence — not a
 *    disabled flag — is the safety property.
 */

export const ROBINHOOD_MAINNET_CHAIN_ID = 4663 as const;
export const ROBINHOOD_MAINNET_ENVIRONMENT = "PRODUCTION" as const;
export const ROBINHOOD_MAINNET_NAME = "Robinhood Chain" as const;
export const ROBINHOOD_MAINNET_NATIVE_SYMBOL = "ETH" as const;

/** Block explorer for production. Read-only linking only. */
export const ROBINHOOD_MAINNET_EXPLORER_URL = "https://robinhoodchain.blockscout.com" as const;

/**
 * PUBLIC DIAGNOSTIC ENDPOINT ONLY.
 * Rate limited and explicitly not for production use. Never authoritative:
 * an observation from this endpoint may never satisfy a verification gate,
 * substitute for a missing managed provider, or promote any state.
 */
export const ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL =
  "https://rpc.mainnet.chain.robinhood.com" as const;

/**
 * NAME of the server-only managed provider variable. The value is read only
 * inside a server handler. Do not mirror this into `import.meta.env`.
 */
export const ROBINHOOD_MAINNET_MANAGED_RPC_ENV = "ROBINHOOD_MAINNET_RPC_URL" as const;

/**
 * Frozen production execution gates.
 *
 * P3C-F: the DEPLOYMENT capability switch is ON. It is a COMPILE-TIME
 * capability only — it authorizes nothing by itself. Every send still requires
 * the server-authoritative runtime execution control, an unexpired canary
 * permit, a claimed presign authorization and a fresh 10-second server send
 * window. LIQUIDITY remains OFF and is not part of this checkpoint.
 */
export const MAINNET_DEPLOYMENT_TX_ENABLED = true as const;
export const MAINNET_LIQUIDITY_TX_ENABLED = false as const;

/** Read-only explorer link helper. */
export function mainnetExplorerTxUrl(txHash: string): string {
  return `${ROBINHOOD_MAINNET_EXPLORER_URL}/tx/${txHash}`;
}

/** Read-only explorer link helper. */
export function mainnetExplorerAddressUrl(address: string): string {
  return `${ROBINHOOD_MAINNET_EXPLORER_URL}/address/${address}`;
}
