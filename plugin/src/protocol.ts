import WDK from "@tetherto/wdk";
import WalletManagerEvmErc4337 from "@tetherto/wdk-wallet-evm-erc-4337";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import {
  getSeedPhrase,
  getRpcUrl,
  USDT_ADDRESS,
  getWdkSepoliaConfig,
  WDK_WALLET_NAME,
} from "./config.js";
import { usdtAbi } from "./abi/usdt.js";

// ── Singleton State ──

let wdkInstance: InstanceType<typeof WDK> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wdkAccount: any = null;
let wdkAddress: string | null = null;
let publicClientInstance: PublicClient | null = null;

// ── WDK Init (lazy, idempotent) ──

export async function initWdk(): Promise<void> {
  if (wdkInstance && wdkAccount) return;

  const seed = getSeedPhrase();
  const rpcUrl = getRpcUrl();

  const config = { ...getWdkSepoliaConfig(), provider: rpcUrl };

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
  const result = await account.sendTransaction({ to, value: 0n, data });
  console.error(`[souq] Tx sent: ${result.hash}`);
  return result;
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

  const result = await account.sendTransaction(fixedCalls);
  console.error(`[souq] Batch tx sent (${fixedCalls.length} calls): ${result.hash}`);
  return result;
}

// ── Read-only Public Client (no WDK needed) ──

export function getPublicClient(): PublicClient {
  if (!publicClientInstance) {
    const rpcUrl = getRpcUrl();
    publicClientInstance = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
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
    console.error("[souq] WDK disposed");
  }
}
