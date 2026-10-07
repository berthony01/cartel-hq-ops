/** PCART P8A — pure dependency attestation classification (no network here). */
import { P8A_MAINNET_DEPENDENCIES, type P8aDependencyKey } from "@/lib/pcart-auction-liquidity-plan";

export type P8aAttestStatus = "MATCH" | "MISSING" | "HASH_MISMATCH" | "UNREADABLE";
export type P8aAttestRow = { key: P8aDependencyKey; address: string; status: P8aAttestStatus; observedHash: string | null };

/** observed: key -> runtime code keccak (null = no code, undefined = read failed). */
export function classifyAttestation(observed: Partial<Record<P8aDependencyKey, string | null | undefined>>): P8aAttestRow[] {
  return P8A_MAINNET_DEPENDENCIES.map((d) => {
    const h = observed[d.key];
    const status: P8aAttestStatus =
      h === undefined ? "UNREADABLE" : h === null ? "MISSING" : h.toLowerCase() === d.codeHash.toLowerCase() ? "MATCH" : "HASH_MISMATCH";
    return { key: d.key, address: d.address, status, observedHash: h ?? null };
  });
}

export const attestationOk = (rows: P8aAttestRow[]) => rows.length === P8A_MAINNET_DEPENDENCIES.length && rows.every((r) => r.status === "MATCH");

/** TESTNET only if every dependency matches on 46630; otherwise FORKED_MAINNET. Never substitutes addresses. */
export const selectRehearsalMode = (testnet: P8aAttestRow[]): "TESTNET" | "FORKED_MAINNET" => (attestationOk(testnet) ? "TESTNET" : "FORKED_MAINNET");
