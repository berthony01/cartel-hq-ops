import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createPublicClient, encodeAbiParameters, http, keccak256 } from "viem";
import {
  REQUIRED_CONFIRMATIONS,
  ROBINHOOD_TESTNET_CHAIN_ID,
  TEST_ARTIFACT_RUNTIME_BYTECODE,
  robinhoodTestnet,
} from "./chain-registry";
import {
  CARTEL_FIXED_ERC20_ABI,
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";

/**
 * C8.2 — independent, server-side chain verification.
 *
 * DEVIATION NOTE: the C8.1 contract specified a Supabase Edge Function
 * `chain-verify` (verify_jwt=true). This platform blocks creation of NEW
 * Supabase Edge Functions in this project, so the identical trust model is
 * implemented as an authenticated TanStack server function instead. Every
 * security property of the contract is preserved:
 *   - the caller is authenticated (bearer token validated by middleware);
 *   - platform-owner AND workspace-operator are BOTH re-enforced server-side
 *     by reading the row through the user's own RLS context;
 *   - the chain is queried independently; nothing the browser sends about
 *     the transaction, receipt, block, sender or contract is trusted;
 *   - the state write goes through the service-role-only RPC, which the
 *     browser cannot call.
 *
 * This function never writes `launches.official_contract_address`, never
 * transitions a launch, and never sends a Telegram message.
 */

type VerifyInput = { deploymentId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VerifyResult = {
  status: "DRAFT" | "SUBMITTED" | "PENDING" | "CONFIRMED" | "FAILED" | "ABANDONED";
  confirmations: number;
  contractAddress: string | null;
  blockNumber: string | null;
  requiredConfirmations: number;
  /** Transient, non-fatal diagnostic (tx not yet visible, RPC unavailable). */
  notice: string | null;
};

export const verifyChainDeployment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VerifyInput) => {
    if (!input || typeof input.deploymentId !== "string" || !UUID.test(input.deploymentId)) {
      throw new Error("Invalid deployment id");
    }
    return { deploymentId: input.deploymentId };
  })
  .handler(async ({ data, context }): Promise<VerifyResult> => {
    // Gate: RLS on launch_chain_deployments requires platform owner AND
    // workspace operator, so an unauthorized or cross-tenant id yields no row
    // and a generic error that leaks nothing about another tenant.
    const { data: row, error } = await context.supabase
      .from("launch_chain_deployments")
      .select(
        // token_total_supply_text is the generated exact-decimal mirror. The
        // numeric column crosses JSON as a double and is never trusted here.
        "id, status, chain_id, network_environment, deployer_address, tx_hash, confirmations, contract_address, block_number, block_hash, deployment_kind, artifact_id, token_name, token_symbol, token_decimals, token_total_supply_text, token_recipient",
      )
      .eq("id", data.deploymentId)
      .maybeSingle();

    if (error || !row) throw new Error("Not authorized");

    const terminal =
      row.status === "CONFIRMED" || row.status === "FAILED" || row.status === "ABANDONED";
    if (terminal || row.status === "DRAFT" || !row.tx_hash) {
      return {
        status: row.status as VerifyResult["status"],
        confirmations: row.confirmations ?? 0,
        contractAddress: row.contract_address ?? null,
        blockNumber: row.block_number === null ? null : String(row.block_number),
        requiredConfirmations: REQUIRED_CONFIRMATIONS,
        notice: null,
      };
    }

    // Hard pin: this verifier only ever speaks to the testnet.
    if (
      Number(row.chain_id) !== ROBINHOOD_TESTNET_CHAIN_ID ||
      row.network_environment !== "TESTNET"
    ) {
      throw new Error("Unsupported chain");
    }

    const isToken = row.deployment_kind === "FIXED_SUPPLY_ERC20";
    // Fail closed: the supply used for every security comparison must be an
    // exact decimal digit string from the generated mirror, never a JS number.
    const supplyText = typeof row.token_total_supply_text === "string"
      ? row.token_total_supply_text
      : null;
    if (
      isToken &&
      (row.artifact_id !== "cartel-fixed-erc20-v1" ||
        row.token_decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
        !row.token_name ||
        !row.token_symbol ||
        supplyText === null ||
        !/^[0-9]+$/.test(supplyText) ||
        !row.token_recipient)
    ) {
      throw new Error("Unsupported deployment artifact");
    }

    const client = createPublicClient({ chain: robinhoodTestnet, transport: http() });
    const txHash = row.tx_hash as `0x${string}`;

    const apply = async (payload: {
      status: "PENDING" | "CONFIRMED" | "FAILED";
      confirmations: number;
      contractAddress?: string | null;
      blockNumber?: bigint | null;
      blockHash?: string | null;
      failureCode?: string | null;
      failureDetail?: string | null;
      verifiedToken?: {
        name: string;
        symbol: string;
        decimals: number;
        totalSupply: bigint;
        recipientBalance: bigint;
      };
    }) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const args: {
        _deployment_id: string;
        _status: string;
        _confirmations: number;
        _contract_address?: string;
        _block_number?: number;
        _block_hash?: string;
        _failure_code?: string;
        _failure_detail?: string;
      } = {
        _deployment_id: data.deploymentId,
        _status: payload.status,
        _confirmations: payload.confirmations,
      };
      if (payload.contractAddress) args._contract_address = payload.contractAddress;
      if (payload.blockNumber !== null && payload.blockNumber !== undefined) {
        args._block_number = Number(payload.blockNumber);
      }
      if (payload.blockHash) args._block_hash = payload.blockHash;
      if (payload.failureCode) args._failure_code = payload.failureCode;
      if (payload.failureDetail) args._failure_detail = payload.failureDetail;

      if (isToken) {
        const tokenArgs = {
          ...args,
          ...(payload.verifiedToken
            ? {
                _verified_token_name: payload.verifiedToken.name,
                _verified_token_symbol: payload.verifiedToken.symbol,
                _verified_token_decimals: payload.verifiedToken.decimals,
                // Decimal strings: base units exceed IEEE-754 safe integers.
                _verified_total_supply: payload.verifiedToken.totalSupply.toString(),
                _verified_recipient_balance: payload.verifiedToken.recipientBalance.toString(),
              }
            : {}),
        } as unknown as Parameters<
          typeof supabaseAdmin.rpc<"apply_launch_chain_token_deployment_verification">
        >[1];
        const { error: tokenError } = await supabaseAdmin.rpc(
          "apply_launch_chain_token_deployment_verification",
          tokenArgs,
        );
        if (tokenError) throw new Error("Verification could not be recorded");
        return;
      }

      const { error: rpcError } = await supabaseAdmin.rpc(
        "apply_launch_chain_deployment_verification",
        args,
      );
      if (rpcError) throw new Error("Verification could not be recorded");
    };

    // --- Independent chain reads. Nothing below comes from the browser. ---
    let tx: Awaited<ReturnType<typeof client.getTransaction>> | null = null;
    try {
      tx = await client.getTransaction({ hash: txHash });
    } catch {
      tx = null;
    }

    if (!tx) {
      // Not yet propagated, or dropped/replaced. NEVER fail it here: an absent
      // transaction is retryable, not proof of failure.
      return {
        status: row.status as VerifyResult["status"],
        confirmations: row.confirmations ?? 0,
        contractAddress: null,
        blockNumber: null,
        requiredConfirmations: REQUIRED_CONFIRMATIONS,
        notice: "Transaction not visible on the testnet yet. Check again shortly.",
      };
    }

    // Shape checks against the stored attempt, not against client claims.
    if (tx.to !== null && tx.to !== undefined) {
      await apply({
        status: "FAILED",
        confirmations: 0,
        failureCode: "NOT_CONTRACT_CREATION",
        failureDetail: "Transaction is not a contract creation.",
      });
      return failed("Transaction is not a contract creation.");
    }
    if (tx.value !== 0n) {
      await apply({
        status: "FAILED",
        confirmations: 0,
        failureCode: "NONZERO_VALUE",
        failureDetail: "Contract creation carried a non-zero value.",
      });
      return failed("Contract creation carried a non-zero value.");
    }
    if (tx.from.toLowerCase() !== row.deployer_address) {
      await apply({
        status: "FAILED",
        confirmations: 0,
        failureCode: "DEPLOYER_MISMATCH",
        failureDetail: "Transaction sender does not match the recorded deployer.",
      });
      return failed("Transaction sender does not match the recorded deployer.");
    }

    // Token attempts: the broadcast init code must be byte-for-byte the frozen
    // artifact plus the constructor args recorded server-side at creation.
    // Nothing about the bytecode is ever taken from the browser.
    let expectedTotalSupply = 0n;
    if (isToken) {
      expectedTotalSupply = BigInt(String(row.token_total_supply));
      const expectedInitCode = (CARTEL_FIXED_ERC20_CREATION_BYTECODE +
        encodeAbiParameters(
          [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }],
          [
            row.token_name as string,
            row.token_symbol as string,
            expectedTotalSupply,
            row.token_recipient as `0x${string}`,
          ],
        ).slice(2)) as `0x${string}`;

      if ((tx.input ?? "0x").toLowerCase() !== expectedInitCode.toLowerCase()) {
        await apply({
          status: "FAILED",
          confirmations: 0,
          failureCode: "INIT_CODE_MISMATCH",
          failureDetail: "Broadcast init code does not match the recorded token intent.",
        });
        return failed("Broadcast init code does not match the recorded token intent.");
      }
    }

    let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>> | null = null;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch {
      receipt = null;
    }

    if (!receipt || receipt.blockNumber === null) {
      return {
        status: row.status as VerifyResult["status"],
        confirmations: 0,
        contractAddress: null,
        blockNumber: null,
        requiredConfirmations: REQUIRED_CONFIRMATIONS,
        notice: "Transaction is not mined yet.",
      };
    }

    if (receipt.transactionHash.toLowerCase() !== txHash) {
      throw new Error("Receipt does not match the requested transaction");
    }

    if (receipt.status !== "success") {
      await apply({
        status: "FAILED",
        confirmations: 0,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        failureCode: "RECEIPT_REVERTED",
        failureDetail: "The deployment transaction reverted on chain.",
      });
      return failed("The deployment transaction reverted on chain.");
    }

    const created = receipt.contractAddress ? receipt.contractAddress.toLowerCase() : null;
    if (!created) {
      await apply({
        status: "FAILED",
        confirmations: 0,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        failureCode: "NO_CONTRACT_ADDRESS",
        failureDetail: "Receipt contained no created contract address.",
      });
      return failed("Receipt contained no created contract address.");
    }

    const latest = await client.getBlockNumber();
    const confirmations =
      latest >= receipt.blockNumber ? Number(latest - receipt.blockNumber) + 1 : 0;

    // Reorg safety: below the threshold nothing is finalized, and the block
    // hash we store is overwritten on every check, so a reorged hash can never
    // survive as stale proof. The attempt simply stays retryable/pending.
    if (confirmations < REQUIRED_CONFIRMATIONS) {
      await apply({
        status: "PENDING",
        confirmations,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
      });
      return {
        status: "PENDING",
        confirmations,
        contractAddress: null,
        blockNumber: String(receipt.blockNumber),
        requiredConfirmations: REQUIRED_CONFIRMATIONS,
        notice: null,
      };
    }

    // Fingerprint: the deployed runtime code must be exactly the fixed test
    // artifact, so an unrelated contract can never be recorded as ours.
    const code = await client.getCode({ address: created as `0x${string}` });

    if (isToken) {
      const runtimeHash = keccak256((code ?? "0x") as `0x${string}`);
      if (runtimeHash.toLowerCase() !== CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH.toLowerCase()) {
        await apply({
          status: "FAILED",
          confirmations,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          failureCode: "ARTIFACT_MISMATCH",
          failureDetail: "Deployed runtime code does not match the frozen token artifact.",
        });
        return failed("Deployed runtime code does not match the frozen token artifact.");
      }

      const address = created as `0x${string}`;
      const abi = CARTEL_FIXED_ERC20_ABI;
      let onChain: {
        name: string;
        symbol: string;
        decimals: number;
        totalSupply: bigint;
        recipientBalance: bigint;
      };
      try {
        const [name, symbol, decimals, totalSupply, recipientBalance] = await Promise.all([
          client.readContract({ address, abi, functionName: "name" }) as Promise<string>,
          client.readContract({ address, abi, functionName: "symbol" }) as Promise<string>,
          client.readContract({ address, abi, functionName: "decimals" }) as Promise<number>,
          client.readContract({ address, abi, functionName: "totalSupply" }) as Promise<bigint>,
          client.readContract({
            address,
            abi,
            functionName: "balanceOf",
            args: [row.token_recipient as `0x${string}`],
          }) as Promise<bigint>,
        ]);
        onChain = { name, symbol, decimals: Number(decimals), totalSupply, recipientBalance };
      } catch {
        return {
          status: row.status as VerifyResult["status"],
          confirmations,
          contractAddress: null,
          blockNumber: String(receipt.blockNumber),
          requiredConfirmations: REQUIRED_CONFIRMATIONS,
          notice: "Could not read the token state yet. Check again shortly.",
        };
      }

      if (
        onChain.name !== row.token_name ||
        onChain.symbol !== row.token_symbol ||
        onChain.decimals !== CARTEL_FIXED_ERC20_DECIMALS ||
        onChain.totalSupply !== expectedTotalSupply ||
        onChain.recipientBalance !== expectedTotalSupply
      ) {
        await apply({
          status: "FAILED",
          confirmations,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          failureCode: "TOKEN_STATE_MISMATCH",
          failureDetail: "On-chain token state does not match the recorded intent.",
        });
        return failed("On-chain token state does not match the recorded intent.");
      }

      await apply({
        status: "CONFIRMED",
        confirmations,
        contractAddress: created,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        verifiedToken: onChain,
      });

      return {
        status: "CONFIRMED",
        confirmations,
        contractAddress: created,
        blockNumber: String(receipt.blockNumber),
        requiredConfirmations: REQUIRED_CONFIRMATIONS,
        notice: null,
      };
    }

    if ((code ?? "0x").toLowerCase() !== TEST_ARTIFACT_RUNTIME_BYTECODE) {
      await apply({
        status: "FAILED",
        confirmations,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        failureCode: "ARTIFACT_MISMATCH",
        failureDetail: "Deployed runtime code does not match the expected test artifact.",
      });
      return failed("Deployed runtime code does not match the expected test artifact.");
    }

    await apply({
      status: "CONFIRMED",
      confirmations,
      contractAddress: created,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
    });

    return {
      status: "CONFIRMED",
      confirmations,
      contractAddress: created,
      blockNumber: String(receipt.blockNumber),
      requiredConfirmations: REQUIRED_CONFIRMATIONS,
      notice: null,
    };
  });

function failed(notice: string): VerifyResult {
  return {
    status: "FAILED",
    confirmations: 0,
    contractAddress: null,
    blockNumber: null,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
    notice,
  };
}
