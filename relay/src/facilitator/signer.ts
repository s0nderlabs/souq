import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  verifyTypedData as viemVerifyTypedData,
  hashTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import { sepolia } from "../config";

function logTiming(label: string, startMs: number): void {
  console.log(`[signer] ${label}: ${Date.now() - startMs}ms`);
}

/**
 * Creates a FacilitatorEvmSigner from a private key.
 * This signer is used by the x402 facilitator to verify and settle payments.
 *
 * Adapted from pragma's pattern for Sepolia (no EIP-7966 sync — standard Ethereum).
 *
 * @param privateKey - The facilitator wallet private key
 * @param rpcUrl - RPC endpoint URL
 * @returns FacilitatorEvmSigner compatible with @x402/evm
 */
export function createFacilitatorSigner(
  privateKey: `0x${string}`,
  rpcUrl: string
): FacilitatorEvmSigner {
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  // Combined client bridging public + wallet operations for x402
  const combinedClient = {
    address: account.address,

    readContract: async (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) => {
      const start = Date.now();
      const result = await publicClient.readContract({
        address: args.address,
        abi: args.abi as readonly unknown[],
        functionName: args.functionName,
        args: args.args,
      });
      logTiming(`readContract ${args.functionName}`, start);
      return result;
    },

    verifyTypedData: async (args: {
      address: `0x${string}`;
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
      signature: `0x${string}`;
    }) => {
      const start = Date.now();

      // Try standard ECDSA verification first
      try {
        const result = await viemVerifyTypedData({
          address: args.address,
          domain: args.domain as Parameters<typeof viemVerifyTypedData>[0]["domain"],
          types: args.types as Parameters<typeof viemVerifyTypedData>[0]["types"],
          primaryType: args.primaryType,
          message: args.message as Parameters<typeof viemVerifyTypedData>[0]["message"],
          signature: args.signature,
        });
        if (result) {
          logTiming("verifyTypedData (ECDSA)", start);
          return true;
        }
      } catch {
        // ECDSA failed — might be a Smart Account
      }

      // ERC-1271 fallback: check if address is a contract, call isValidSignature
      console.log(`[signer] ECDSA failed for ${args.address}, checking ERC-1271...`);
      const code = await publicClient.getCode({ address: args.address });
      console.log(`[signer] getCode result: ${code ? code.slice(0, 20) + '...' : 'null'} (length: ${code?.length ?? 0})`);
      if (code && code !== "0x") {
        console.log(`[signer] Trying ERC-1271 for Smart Account ${args.address}`);
        const hash = hashTypedData({
          domain: args.domain as Parameters<typeof hashTypedData>[0]["domain"],
          types: args.types as Parameters<typeof hashTypedData>[0]["types"],
          primaryType: args.primaryType,
          message: args.message as Parameters<typeof hashTypedData>[0]["message"],
        });

        try {
          const magicValue = await publicClient.readContract({
            address: args.address,
            abi: [{
              type: "function",
              name: "isValidSignature",
              inputs: [
                { name: "hash", type: "bytes32" },
                { name: "signature", type: "bytes" },
              ],
              outputs: [{ name: "", type: "bytes4" }],
              stateMutability: "view",
            }] as const,
            functionName: "isValidSignature",
            args: [hash, args.signature],
          });
          const isValid = magicValue === "0x1626ba7e";
          logTiming(`verifyTypedData (ERC-1271: ${isValid})`, start);
          return isValid;
        } catch (e) {
          console.log(`[signer] ERC-1271 call failed:`, (e as Error).message?.slice(0, 300));
        }
      }

      logTiming("verifyTypedData (FAILED)", start);
      return false;
    },

    writeContract: async (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args: readonly unknown[];
    }) => {
      const totalStart = Date.now();

      // Encode function data
      const data = encodeFunctionData({
        abi: args.abi,
        functionName: args.functionName,
        args: args.args,
      });

      // Prepare + send in standard flow (no EIP-7966 on Sepolia)
      const prepareStart = Date.now();
      const request = await walletClient.prepareTransactionRequest({
        account,
        to: args.address,
        data,
        gas: 250_000n,
      });
      logTiming("prepareTransactionRequest", prepareStart);

      const serializedTransaction = await walletClient.signTransaction(request);

      const sendStart = Date.now();
      const hash = await walletClient.sendRawTransaction({ serializedTransaction });
      logTiming("sendRawTransaction", sendStart);
      logTiming("writeContract total", totalStart);

      return hash;
    },

    sendTransaction: async (args: { to: `0x${string}`; data: `0x${string}` }) => {
      return walletClient.sendTransaction({
        to: args.to,
        data: args.data,
      });
    },

    waitForTransactionReceipt: async (args: { hash: `0x${string}` }) => {
      const start = Date.now();
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: args.hash,
      });
      logTiming("waitForTransactionReceipt", start);
      return {
        status: receipt.status === "success" ? ("success" as const) : ("reverted" as const),
      };
    },

    getCode: async (args: { address: `0x${string}` }) => {
      return publicClient.getCode({ address: args.address });
    },
  };

  return toFacilitatorEvmSigner(combinedClient);
}
