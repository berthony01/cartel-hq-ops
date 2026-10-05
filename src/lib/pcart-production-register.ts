/**
 * PCART P7 — official contract registration (pure helpers).
 *
 * No network, no wallet, no signing. Registration itself is the owner-only
 * database RPC `register_canonical_pcart_official_contract`, which re-derives
 * every invariant server-side. Registration never makes the launch LIVE, never
 * creates liquidity, and never notifies watchers or Telegram.
 */

export const PCART_P7_CHECKBOX_COPY = "I understand this permanently records the verified PCART address as official.";
export const PCART_P7_WARNING_COPY =
  "This records the verified address as the official PCART contract. It does not make the launch LIVE and does not create liquidity.";
export const PCART_P7_SUCCESS_COPY = "OFFICIAL PCART CONTRACT REGISTERED — LAUNCH NOT LIVE";
export const PCART_P7_BUTTON_COPY = "Register official PCART contract";

export type PcartP7Input = {
  status: string | null | undefined;
  finalityState: string | null | undefined;
  contractAddress: string | null | undefined;
  launchStatus: string | null | undefined;
  officialContractAddress: string | null | undefined;
  officialContractDeploymentId: string | null | undefined;
  deploymentId: string;
};

export type PcartP7State =
  | { kind: "INERT"; reason: string }
  | { kind: "ACTIONABLE"; address: string }
  | { kind: "REGISTERED"; address: string }
  | { kind: "CONFLICT" };

const ADDR = /^0x[0-9a-f]{40}$/;
const PRE_REGISTRATION = new Set(["LAUNCH_APPROACHING", "CONTRACT_PENDING"]);

export function classifyPcartP7(i: PcartP7Input): PcartP7State {
  const official = i.officialContractAddress?.toLowerCase() ?? null;
  if (official || i.officialContractDeploymentId) {
    const same =
      i.officialContractDeploymentId === i.deploymentId &&
      !!official &&
      official === (i.contractAddress ?? "").toLowerCase();
    return same && i.launchStatus === "OFFICIAL_CONTRACT_REGISTERED" ? { kind: "REGISTERED", address: official! } : { kind: "CONFLICT" };
  }
  if (i.status !== "CONFIRMED") return { kind: "INERT", reason: `Available after verified & finalized deployment (now ${i.status ?? "—"}).` };
  if (i.finalityState !== "FINALIZED") return { kind: "INERT", reason: "Available after managed finality is recorded." };
  const addr = (i.contractAddress ?? "").toLowerCase();
  if (!ADDR.test(addr)) return { kind: "INERT", reason: "Verified contract address missing." };
  if (!PRE_REGISTRATION.has(String(i.launchStatus))) return { kind: "INERT", reason: `Launch stage ${i.launchStatus ?? "—"} does not allow registration.` };
  return { kind: "ACTIONABLE", address: addr };
}

/** Exact typed confirmation (case-insensitive, trimmed). */
export function pcartP7ConfirmMatches(typed: string, address: string): boolean {
  return ADDR.test(address.toLowerCase()) && typed.trim().toLowerCase() === address.toLowerCase();
}

export function pcartP7SummaryText(i: { launchStatus: string | null | undefined; officialContractAddress: string | null | undefined }): string | null {
  if (i.launchStatus === "OFFICIAL_CONTRACT_REGISTERED" && i.officialContractAddress) {
    return "Official PCART contract registered — launch not live";
  }
  return null;
}
