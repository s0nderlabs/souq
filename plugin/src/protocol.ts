import WDK from "@tetherto/wdk";
import WalletManagerEvmErc4337 from "@tetherto/wdk-wallet-evm-erc-4337";
import {
  createPublicClient,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { createX402Transport } from "./x402-transport.js";
import {
  getOrCreateSeedPhrase,
  USDT_ADDRESS,
  getWdkSepoliaConfig,
  WDK_WALLET_NAME,
} from "./config.js";
import { usdtAbi } from "./abi/usdt.js";
import { resetX402Client } from "./x402-client.js";

// ── Singleton State ──

let wdkInstance: InstanceType<typeof WDK> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wdkAccount: any = null;
let wdkAddress: string | null = null;
let publicClientInstance: PublicClient | null = null;

// ── WDK Init (lazy, idempotent) ──

export async function initWdk(): Promise<void> {
  if (wdkInstance && wdkAccount) return;

  const seed = await getOrCreateSeedPhrase();
  const config = getWdkSepoliaConfig();

  wdkInstance = new WDK(seed);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wdkInstance.registerWallet(WDK_WALLET_NAME, WalletManagerEvmErc4337 as any, config);

  wdkAccount = await wdkInstance.getAccount(WDK_WALLET_NAME, 0);
  wdkAddress = await wdkAccount.getAddress();

  console.error(`[souq] Wallet initialized: ${wdkAddress}`);
}

// ── Account Access ──

export async function getWdkAccount(): Promise<typeof wdkAccount> {
  await initWdk();
  return wdkAccount;
}

export async function getAddress(): Promise<Address> {
  await initWdk();
  return wdkAddress as Address;
}

// ── Transaction Helpers ──

export async function sendTx(
  to: Address,
  data: Hex
): Promise<{ hash: string; fee: bigint }> {
  const account = await getWdkAccount();
  console.error(`[souq] Sending tx to ${to}...`);
  const start = Date.now();
  try {
    const result = await account.sendTransaction({ to, value: 0n, data });
    console.error(`[souq] Tx sent in ${((Date.now() - start) / 1000).toFixed(1)}s: ${result.hash}`);
    return result;
  } catch (err: unknown) {
    // WDK internally calls waitForTransactionReceipt with a UserOp hash, which always times out.
    // Extract the hash from the error and return it — we'll poll via waitForUserOp instead.
    const msg = err instanceof Error ? err.message : String(err);
    const hashMatch = msg.match(/hash "([0-9a-fA-Fx]+)"/);
    if (hashMatch && msg.includes("Timed out")) {
      console.error(`[souq] WDK receipt timeout (expected) — hash: ${hashMatch[1]}, elapsed: ${((Date.now() - start) / 1000).toFixed(1)}s`);
      return { hash: hashMatch[1], fee: 0n };
    }
    throw err;
  }
}

// USDT approve(address,uint256) function selector — used to detect approve calls
// Tether USDT reverts if approve(addr, newAmount) when oldAllowance != 0 && newAmount != 0
const APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)

function makeApproveZero(spender: Address): { to: Address; value: bigint; data: Hex } {
  const data = encodeFunctionData({ abi: usdtAbi, functionName: "approve", args: [spender, 0n] });
  return { to: USDT_ADDRESS, value: 0n, data };
}

export async function batchTx(
  calls: Array<{ to: Address; value?: bigint; data: Hex }>
): Promise<{ hash: string; fee: bigint }> {
  const account = await getWdkAccount();

  // Auto-fix USDT approve issue: prepend approve(spender, 0) before each approve call
  // Tether USDT requires old allowance = 0 before setting new non-zero allowance
  // NOTE: we only fix OUR approvals (escrow). Paymaster approval is managed by WDK internally.
  const fixedCalls: Array<{ to: Address; value: bigint; data: Hex }> = [];

  for (const c of calls) {
    const isUsdtApprove = c.to.toLowerCase() === USDT_ADDRESS.toLowerCase()
      && c.data.startsWith(APPROVE_SELECTOR);
    if (isUsdtApprove) {
      const spender = ("0x" + c.data.slice(34, 74)) as Address;
      fixedCalls.push(makeApproveZero(spender));
    }
    fixedCalls.push({ to: c.to, value: c.value ?? 0n, data: c.data });
  }

  console.error(`[souq] Sending batch tx (${fixedCalls.length} calls)...`);
  const start = Date.now();
  try {
    const result = await account.sendTransaction(fixedCalls);
    console.error(`[souq] Batch tx sent in ${((Date.now() - start) / 1000).toFixed(1)}s: ${result.hash}`);
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const hashMatch = msg.match(/hash "([0-9a-fA-Fx]+)"/);
    if (hashMatch && msg.includes("Timed out")) {
      console.error(`[souq] WDK batch receipt timeout (expected) — hash: ${hashMatch[1]}, elapsed: ${((Date.now() - start) / 1000).toFixed(1)}s`);
      return { hash: hashMatch[1], fee: 0n };
    }
    throw err;
  }
}

// ── UserOp Receipt Polling ──

import { originalFetch } from "./x402-fetch-patch.js";
import { getSouqApiUrl } from "./config.js";

/**
 * Wait for a UserOp hash to be confirmed via bundler polling.
 * WDK returns UserOp hashes (not tx hashes), which viem can't track.
 * Returns the bundler's receipt directly (includes logs for event parsing).
 */
export async function waitForUserOp(
  userOpHash: string,
  timeoutMs = 120_000
): Promise<{ transactionHash: string; receipt: { logs: Array<{ address: string; topics: string[]; data: string }> } }> {
  const apiUrl = getSouqApiUrl();
  const addr = await getAddress();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await originalFetch(`${apiUrl}/bundler`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-SOUQ-WALLET": addr },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getUserOperationReceipt", params: [userOpHash] }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = await res.json() as any;
      if (json.result?.receipt?.transactionHash) {
        return {
          transactionHash: json.result.receipt.transactionHash,
          receipt: json.result.receipt,
        };
      }
    } catch {
      // Network error — keep polling
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`UserOp ${userOpHash} not confirmed after ${timeoutMs / 1000}s`);
}

// ── Read-only Public Client (no WDK needed) ──

export function getPublicClient(): PublicClient {
  if (!publicClientInstance) {
    publicClientInstance = createPublicClient({
      chain: sepolia,
      transport: createX402Transport(),
    });
  }
  return publicClientInstance;
}

// ── Cleanup ──

export function dispose(): void {
  if (wdkInstance) {
    wdkInstance.dispose();
    wdkInstance = null;
    wdkAccount = null;
    wdkAddress = null;
    publicClientInstance = null; // Reset so next getPublicClient() creates fresh with new wallet
    resetX402Client();
    console.error("[souq] WDK disposed");
  }
}
