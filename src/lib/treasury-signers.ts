import { getAddress } from "viem";

import { supabase } from "@/integrations/supabase/client";
import {
  isCandidateTreasuryAddress,
  normalizeTreasuryAddress,
} from "@/lib/treasury-safe-verify";

/**
 * PCART Treasury Signer Setup — Phase A.
 *
 * Records the three INTENDED public signer wallet addresses for a launch's
 * future 2-of-3 Safe treasury. This module handles public addresses only. It
 * never handles a private key or seed phrase, never creates a Safe, never
 * signs, never broadcasts, and never moves value. The hardened canonical Safe
 * verifier is reused read-only and is NOT modified.
 */

export const TREASURY_SIGNER_COUNT = 3 as const;
/** Fixed for PEPECARTEL. Never client-controlled, never editable in the UI. */
export const TREASURY_SIGNER_THRESHOLD = 2 as const;

export type TreasurySignerConfig = {
  id: string;
  workspaceId: string;
  launchId: string;
  signers: [string, string, string];
  threshold: number;
  updatedAt: string;
};

export type TreasurySignerFieldError = {
  index: number;
  message: string;
};

export type TreasurySignerValidation =
  | { ok: true; signers: [string, string, string] }
  | { ok: false; errors: TreasurySignerFieldError[] };

/** Lowercase canonical storage form. */
export function normalizeSigner(raw: string): string {
  return normalizeTreasuryAddress(raw);
}

/** Checksummed presentation form; falls back to the raw value if unusable. */
export function displaySigner(raw: string): string {
  try {
    return getAddress(normalizeSigner(raw));
  } catch {
    return raw;
  }
}

/**
 * Convenience validation only. The database CHECK constraints and the
 * owner-only RPC re-validate every value server-side and fail closed.
 */
export function validateSigners(inputs: string[]): TreasurySignerValidation {
  const errors: TreasurySignerFieldError[] = [];
  const normalized = inputs.map((value) => normalizeSigner(value));

  if (normalized.length !== TREASURY_SIGNER_COUNT) {
    return {
      ok: false,
      errors: [{ index: 0, message: "Exactly three signer wallets are required." }],
    };
  }

  normalized.forEach((value, index) => {
    if (value.length === 0) {
      errors.push({ index, message: "Enter a wallet address." });
      return;
    }
    if (!isCandidateTreasuryAddress(value)) {
      errors.push({ index, message: "That is not a valid 0x wallet address." });
      return;
    }
    const firstIndex = normalized.indexOf(value);
    if (firstIndex !== index) {
      errors.push({
        index,
        message: `Same address as signer wallet ${firstIndex + 1}. All three must be different.`,
      });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, signers: [normalized[0]!, normalized[1]!, normalized[2]!] };
}

export function treasurySignerConfigQueryKey(launchId: string | null | undefined) {
  return ["treasury-signer-config", launchId ?? "none"] as const;
}

type SignerRow = {
  id: string;
  workspace_id: string;
  launch_id: string;
  signer_1: string;
  signer_2: string;
  signer_3: string;
  threshold: number;
  updated_at: string;
};

function toConfig(row: SignerRow): TreasurySignerConfig {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    launchId: row.launch_id,
    signers: [row.signer_1, row.signer_2, row.signer_3],
    threshold: row.threshold,
    updatedAt: row.updated_at,
  };
}

/**
 * Generated Supabase types only gain this table once the migration has been
 * applied to the database, which is a separate, owner-performed step. Until
 * then the table is addressed through an untyped accessor. No behavior and no
 * validation depends on the cast.
 */
const db = supabase as unknown as {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: SignerRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: SignerRow | SignerRow[] | null; error: { message: string } | null }>;
};

const SELECT_COLUMNS =
  "id,workspace_id,launch_id,signer_1,signer_2,signer_3,threshold,updated_at";

/** RLS-protected read. A non-owner simply sees no row. */
export async function getLaunchTreasurySigners(
  launchId: string,
): Promise<TreasurySignerConfig | null> {
  const { data, error } = await db
    .from("launch_treasury_signer_configs")
    .select(SELECT_COLUMNS)
    .eq("launch_id", launchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toConfig(data) : null;
}

/** Owner-only upsert through the SECURITY DEFINER RPC. No delete path exists. */
export async function saveLaunchTreasurySigners(input: {
  launchId: string;
  signers: string[];
}): Promise<TreasurySignerConfig> {
  const validation = validateSigners(input.signers);
  if (!validation.ok) {
    throw new Error("Check the signer wallet addresses and try again.");
  }
  const { data, error } = await db.rpc("save_launch_treasury_signers", {
    _launch_id: input.launchId,
    _signer_1: validation.signers[0],
    _signer_2: validation.signers[1],
    _signer_3: validation.signers[2],
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? (data[0] ?? null) : data;
  if (!row) throw new Error("Treasury signers could not be saved.");
  return toConfig(row);
}
