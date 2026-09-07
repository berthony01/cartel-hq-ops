/* ------------------------------------------------------------------ */
/* P3C Pre-Canary Hardening A — truthful receipt classification        */
/*                                                                     */
/* Extracted verbatim from `chain-mainnet-verify.functions.ts` for the */
/* oversized-file requirement. Behavior is unchanged.                  */
/*                                                                     */
/* viem's `getTransactionReceipt` throws for BOTH a genuine not-found  */
/* receipt and a transport/RPC failure, so a caught error cannot       */
/* distinguish "not mined yet" from "provider unavailable". Production */
/* evidence must never collapse those. The receipt is therefore read   */
/* with a raw managed `eth_getTransactionReceipt`.                     */
/*                                                                     */
/* The ONLY signal accepted as true absence is a successful JSON-RPC   */
/* response carrying `result: null`. Every other uncertainty is        */
/* retryable and never promotes status, finality or CONFIRMED, and     */
/* never writes state. The managed endpoint and raw provider text      */
/* never escape these helpers. READ-ONLY: no signer, no send.          */
/* ------------------------------------------------------------------ */

const TX_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
/** JSON-RPC QUANTITY: minimal hex, no leading zeroes. */
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const MANAGED_RECEIPT_TIMEOUT_MS = 8_000;

const lower = (v: string) => v.toLowerCase();

export type RawManagedReceipt = {
  transactionHash: string;
  status: "0x0" | "0x1";
  contractAddress: string | null;
  blockNumber: string | null;
  blockHash: string | null;
};

export type ManagedReceiptRead =
  /** Provider answered successfully and positively reported no receipt. */
  | { kind: "ABSENT" }
  /** Provider answered with a structurally valid receipt. */
  | { kind: "PRESENT"; receipt: RawManagedReceipt }
  /** Transport/timeout/HTTP/JSON-RPC error. Retryable — NOT proof of unmined. */
  | { kind: "UNAVAILABLE" }
  /** Successful transport but unusable payload. Retryable, never mined. */
  | { kind: "MALFORMED" };

function parseManagedReceipt(value: unknown): ManagedReceiptRead {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "MALFORMED" };
  const raw = value as Record<string, unknown>;

  const transactionHash =
    typeof raw["transactionHash"] === "string" ? lower(raw["transactionHash"]) : "";
  if (!TX_HASH.test(transactionHash)) return { kind: "MALFORMED" };

  const status = typeof raw["status"] === "string" ? lower(raw["status"]) : "";
  if (status !== "0x0" && status !== "0x1") return { kind: "MALFORMED" };

  let contractAddress: string | null = null;
  if (raw["contractAddress"] !== null && raw["contractAddress"] !== undefined) {
    if (typeof raw["contractAddress"] !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw["contractAddress"]);
    if (!ADDRESS.test(candidate)) return { kind: "MALFORMED" };
    contractAddress = candidate;
  }

  let blockNumber: string | null = null;
  if (raw["blockNumber"] !== null && raw["blockNumber"] !== undefined) {
    if (typeof raw["blockNumber"] !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw["blockNumber"]);
    if (!QUANTITY.test(candidate)) return { kind: "MALFORMED" };
    blockNumber = candidate;
  }

  let blockHash: string | null = null;
  if (raw["blockHash"] !== null && raw["blockHash"] !== undefined) {
    if (typeof raw["blockHash"] !== "string") return { kind: "MALFORMED" };
    const candidate = lower(raw["blockHash"]);
    if (!TX_HASH.test(candidate)) return { kind: "MALFORMED" };
    blockHash = candidate;
  }

  return {
    kind: "PRESENT",
    receipt: {
      transactionHash,
      status: status as "0x0" | "0x1",
      contractAddress,
      blockNumber,
      blockHash,
    },
  };
}

/**
 * Raw managed `eth_getTransactionReceipt`. Managed provider is the ONLY
 * production evidence authority; there is no public diagnostic fallback.
 */
export async function readManagedReceipt(
  endpoint: string,
  txHash: string,
): Promise<ManagedReceiptRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANAGED_RECEIPT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "UNAVAILABLE" };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: "UNAVAILABLE" };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { kind: "UNAVAILABLE" };
    }
    const body = payload as Record<string, unknown>;
    if (body["error"] !== null && body["error"] !== undefined) return { kind: "UNAVAILABLE" };
    if (!("result" in body)) return { kind: "UNAVAILABLE" };
    if (body["result"] === null) return { kind: "ABSENT" };
    return parseManagedReceipt(body["result"]);
  } catch {
    return { kind: "UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}
