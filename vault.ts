import "dotenv/config";
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = PRIVATE_KEY ? new ethers.Wallet(PRIVATE_KEY, provider) : null;

const VAULT_ADDRESS = "0x5401b8620E5FB570064CA9114fd1e135fd77D57c";
const ACCOUNTANT_ADDRESS = "0x28634D0c5edC67CF2450E74deA49B90a4FF93dCE";
const TELLER_ADDRESS = "0x4e8f5128f473c6948127f9cbca474a6700f99bab";
const ATOMIC_QUEUE_ADDRESS = "0x3b4acd8879fb60586ccd74bc2f831a4c5e7dbbf8";
const LBTC_RATE_PROVIDER = "0x94916a66fC119a0AC7d612927F0D909cAc15314C";
const ROLES_AUTHORITY_ADDRESS = "0xf3e03ef7df97511a52f31ea7a22329619db2bdf4";
const BTC_PRICE_URL = process.env.BTC_PRICE_URL || "";

const DEPOSIT_ASSET = process.env.DEPOSIT_ASSET || "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const WITHDRAW_ASSET = process.env.WITHDRAW_ASSET || "0x8236a87084f8B84306f72007F36F2618A5634494";
const WITHDRAW_DEADLINE_DAYS = Number(process.env.WITHDRAW_DEADLINE_DAYS || "3");

const BLOCKS_PER_DAY = 7200;
const DEPOSIT_SELECTOR = "0x0efe6a8b";
const ONE_SHARE = 10n ** 8n;
const SHARE_PREMIUM_BPS = 25n;
const WITHDRAW_DISCOUNT = 100n;

const VAULT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const ACCOUNTANT_ABI = [
  "function getRate() view returns (uint256)",
  "function getRateInQuoteSafe(address quote) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const RATE_PROVIDER_ABI = [
  "function getRate() view returns (uint256)",
];

const TELLER_ABI = [
  "function deposit(address depositAsset, uint256 depositAmount, uint256 minimumMint) payable returns (uint256 shares)",
];

const ROLES_AUTHORITY_ABI = [
  "function canCall(address user, address target, bytes4 functionSig) view returns (bool)",
];

const ATOMIC_QUEUE_ABI = [
  "function safeUpdateAtomicRequest(address offer, address want, tuple(uint64 deadline, uint88 atomicPrice, uint96 offerAmount, bool inSolve) userRequest, address accountant, uint256 discount)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);
const accountant = new ethers.Contract(ACCOUNTANT_ADDRESS, ACCOUNTANT_ABI, provider);
const lbtcRateProvider = new ethers.Contract(LBTC_RATE_PROVIDER, RATE_PROVIDER_ABI, provider);

async function getBtcUsdPrice(): Promise<number> {
  const res = await fetch(BTC_PRICE_URL);
  const data = await res.json() as any;
  const price = data?.bitcoin?.usd;
  if (typeof price !== "number") {
    throw new Error("Failed to fetch BTC/USD price from Coingecko");
  }
  return price;
}

function mulDivDown(x: bigint, y: bigint, denominator: bigint): bigint {
  return (x * y) / denominator;
}

function getRateAtBlock(contract: ethers.Contract, blockTag: number | string): Promise<bigint> {
  return contract.getRate({ blockTag });
}

async function getBlockTimestamp(blockNum: number): Promise<number> {
  const block = await provider.getBlock(blockNum);
  if (!block) throw new Error(`Block ${blockNum} not found`);
  return block.timestamp;
}

function calculateApy(
  rateStart: bigint,
  rateEnd: bigint,
  tsStart: number,
  tsEnd: number
): { apy: number; days: number; changePct: number } | null {
  if (rateStart === 0n || tsStart >= tsEnd) return null;
  const days = (tsEnd - tsStart) / 86400;
  if (days === 0) return null;
  const ratio = Number(rateEnd) / Number(rateStart);
  const apy = Math.pow(ratio, 365 / days) - 1;
  const changePct = (ratio - 1) * 100;
  return { apy, days, changePct };
}

async function getShareBalance(address: string): Promise<string> {
  const bal = await vault.balanceOf(address);
  return ethers.formatUnits(bal, 8);
}

async function showMetadata(): Promise<{ name: string; symbol: string; decimals: number; tvlUsd: number }> {
  const [name, symbol, vaultDecimals, totalSupply] = await Promise.all([
    vault.name(), vault.symbol(), vault.decimals(), vault.totalSupply(),
  ]);

  const [rate, accountantDecimals] = await Promise.all([
    accountant.getRate(), accountant.decimals(),
  ]);

  const d1 = Number(vaultDecimals);
  const d2 = Number(accountantDecimals);
  const tvl = Number(totalSupply * rate) / Math.pow(10, d1 + d2);
  const btcUsd = await getBtcUsdPrice();
  const tvlUsd = tvl * btcUsd;

  return { name, symbol, decimals: d1, tvlUsd };
}

async function show30DayApy(): Promise<number> {
  const currentBlock = await provider.getBlockNumber();
  const currentTs = await getBlockTimestamp(currentBlock);
  const rate = await accountant.getRate();
  const pastBlock = currentBlock - 30 * BLOCKS_PER_DAY;

  let strategyResult: ReturnType<typeof calculateApy> = null;
  try {
    const vaultRatePast = await getRateAtBlock(accountant, pastBlock);
    const vaultTsPast = await getBlockTimestamp(pastBlock);
    strategyResult = calculateApy(vaultRatePast, rate, vaultTsPast, currentTs);
  } catch {}

  let lbtcResult: ReturnType<typeof calculateApy> = null;
  try {
    const lbtcRateNow = await lbtcRateProvider.getRate();
    const lbtcRatePast = await getRateAtBlock(lbtcRateProvider, pastBlock);
    const lbtcTsPast = await getBlockTimestamp(pastBlock);
    lbtcResult = calculateApy(lbtcRatePast, lbtcRateNow, lbtcTsPast, currentTs);
  } catch {}

  const strategyApy = strategyResult ? strategyResult.apy : 0;
  const lbtcApy = lbtcResult ? lbtcResult.apy : 0;
  const totalApy = strategyApy + lbtcApy;

  return totalApy;
}

async function checkAuthorization(userAddress: string): Promise<boolean> {
  const rolesAuthority = new ethers.Contract(ROLES_AUTHORITY_ADDRESS, ROLES_AUTHORITY_ABI, provider);
  return rolesAuthority.canCall(userAddress, TELLER_ADDRESS, DEPOSIT_SELECTOR);
}

async function deposit(amount: string) {
  if (!wallet) throw new Error("PRIVATE_KEY not set");

  const teller = new ethers.Contract(TELLER_ADDRESS, TELLER_ABI, wallet);
  const asset = new ethers.Contract(DEPOSIT_ASSET, ERC20_ABI, wallet);

  const decimals = await asset.decimals();
  const depositAmount = ethers.parseUnits(amount, decimals);

  const balance = await asset.balanceOf(wallet.address);
  if (balance < depositAmount) throw new Error(`Insufficient balance: ${ethers.formatUnits(balance, decimals)}`);
  if (!(await checkAuthorization(wallet.address))) throw new Error("Wallet not authorized on Teller");

  const rateInQuote = await accountant.getRateInQuoteSafe(DEPOSIT_ASSET);
  const rawShares = mulDivDown(depositAmount, ONE_SHARE, rateInQuote);
  const expectedShares = mulDivDown(rawShares, 10000n - SHARE_PREMIUM_BPS, 10000n);

  const currentAllowance = await asset.allowance(wallet.address, VAULT_ADDRESS);
  if (currentAllowance < depositAmount) {
    const approveTx = await asset.approve(VAULT_ADDRESS, depositAmount);
    await approveTx.wait();
  }

  console.log("Depositing...");
  const tx = await teller.deposit(DEPOSIT_ASSET, depositAmount, 0);
  const receipt = await tx.wait();
  console.log(`Tx: ${tx.hash} | Block: ${receipt.blockNumber} | Gas: ${receipt.gasUsed}`);
}

async function requestWithdraw(amount: string) {
  if (!wallet) throw new Error("PRIVATE_KEY not set");

  const queue = new ethers.Contract(ATOMIC_QUEUE_ADDRESS, ATOMIC_QUEUE_ABI, wallet);
  const shares = new ethers.Contract(VAULT_ADDRESS, ERC20_ABI, wallet);

  const shareAmount = ethers.parseUnits(amount, 8);

  const shareBalance = await shares.balanceOf(wallet.address);
  if (shareBalance < shareAmount) throw new Error(`Insufficient shares: ${ethers.formatUnits(shareBalance, 8)}`);

  const currentAllowance = await shares.allowance(wallet.address, ATOMIC_QUEUE_ADDRESS);
  if (currentAllowance < shareAmount) {
    const approveTx = await shares.approve(ATOMIC_QUEUE_ADDRESS, shareAmount);
    await approveTx.wait();
  }

  const deadline = Math.floor(Date.now() / 1000) + WITHDRAW_DEADLINE_DAYS * 86400;

  console.log("Withdrawing...");
  const tx = await queue.safeUpdateAtomicRequest(
    VAULT_ADDRESS,
    WITHDRAW_ASSET,
    { deadline, atomicPrice: 0, offerAmount: shareAmount, inSolve: false },
    ACCOUNTANT_ADDRESS,
    WITHDRAW_DISCOUNT
  );
  const receipt = await tx.wait();
  console.log(`Tx: ${tx.hash} | Block: ${receipt.blockNumber} | Gas: ${receipt.gasUsed}`);
}

async function main() {
  const depositAmount = process.env.DEPOSIT_AMOUNT;
  const withdrawAmount = process.env.WITHDRAW_AMOUNT;

  const { name, symbol, decimals, tvlUsd } = await showMetadata();
  const totalApy = await show30DayApy();

  console.log(`Vault: ${name}`);
  console.log(`APY: ${(totalApy * 100).toFixed(4)}%`);
  console.log(`TVL: $${tvlUsd.toFixed(2)}`);
  console.log(`Token: ${symbol} (${decimals} decimals)`);
  console.log("");

  if (!wallet) {
    // No wallet: we can’t show balances or do deposit/withdraw.
    return;
  }

  console.log(`\nWallet: ${wallet.address}`);

  const balanceBefore = await getShareBalance(wallet.address);
  console.log(`Balance before: ${balanceBefore}`);

  if (depositAmount) {
    await deposit(depositAmount);
    const balanceAfter = await getShareBalance(wallet.address);
    console.log(`Balance after: ${balanceAfter}`);
  }

  if (withdrawAmount) {
    await requestWithdraw(withdrawAmount);
    const balanceFinal = await getShareBalance(wallet.address);
    console.log(`Balance final: ${balanceFinal}`);
  }

  console.log("Complete!");
}

main().catch(console.error);