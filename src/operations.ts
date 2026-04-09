import process from "node:process";
import { Wallet, TypedDataEncoder, formatUnits, getAddress, hexlify, parseUnits, randomBytes } from "ethers";
import { AllowancePreference, resolveAllowancePreference } from "./allowance.js";
import { MyriadApiClient } from "./api.js";
import {
  assertAmmConfig,
  assertCollateralConfig,
  assertOrderbookConfig,
  NETWORKS,
  parseInteger,
  parseNumber,
  RuntimeConfig
} from "./config.js";
import { EvmExecutionService } from "./executor.js";
import { PancakeSwapV2Service } from "./pancakeswap.js";
import {
  ClobOrder,
  ClobOrderRecord,
  ClobTimeInForce,
  Market,
  MarketReference,
  OrderbookLevel,
  PortfolioPosition
} from "./types.js";
import { WalletBalanceService } from "./wallet.js";
import { loadConfiguredWalletPrivateKey, readConfiguredWalletAddress } from "./wallet-store.js";

export type ApiRequestOverrides = {
  apiBaseUrl?: string;
  apiKey?: string;
};

export type OrderWaitProgressEvent =
  | { type: "posted"; timeInForce: ClobTimeInForce }
  | { type: "countdown"; remainingSeconds: number };

export type OrderWaitProgressReporter = (event: OrderWaitProgressEvent) => void;

export type OperationContext = {
  runtime: RuntimeConfig;
  globalAllowance?: string;
  orderWaitProgressReporter?: OrderWaitProgressReporter;
};

export type MarketReferenceInput = {
  marketId?: string | number;
  marketSlug?: string;
  networkId?: string | number;
};

export type ListMarketsInput = {
  state?: string;
  networkId?: string | number;
  keyword?: string;
  sort?: string;
  order?: string;
  page?: string | number;
  limit?: string | number;
};

export type ObMarketsListInput = ListMarketsInput;

export type PortfolioInput = {
  networkId?: string | number;
  marketId?: string | number;
  marketSlug?: string;
  tokenAddress?: string;
  page?: string | number;
  limit?: string | number;
};

export type ObPositionsListInput = {
  address?: string;
  marketId?: string | number;
  marketSlug?: string;
  tokenAddress?: string;
  page?: string | number;
  limit?: string | number;
};

export type WalletBalancesInput = {
  address?: string;
};

export type WalletDepositInput = {
  address?: string;
};

export type WalletDepositResult = {
  wallet: string;
  chainId: number;
  network: string;
  instructions: [string, string];
  assets: {
    native: {
      symbol: string;
    };
    collateral: {
      symbol: string;
      address: string;
    };
  };
};

export type StableSwapInput = {
  from: string;
  to: string;
  amountOut: string | number;
  slippage?: string | number;
  allowance?: string;
  dryRun?: boolean;
};

export type TradeBuyInput = MarketReferenceInput & {
  outcomeId: string | number;
  value: string | number;
  slippage?: string | number;
  allowance?: string;
  swapSlippage?: string | number;
  swapAllowance?: string;
  autoSwap?: boolean;
  dryRun?: boolean;
  skipApproval?: boolean;
};

export type TradeSellInput = MarketReferenceInput & {
  outcomeId: string | number;
  value?: string | number;
  shares?: string | number;
  slippage?: string | number;
  dryRun?: boolean;
};

export type ClaimInput = MarketReferenceInput & {
  outcomeId?: string | number;
  dryRun?: boolean;
};

export type ClaimVoidedInput = MarketReferenceInput & {
  outcomeId: string | number;
  dryRun?: boolean;
};

export type ClaimAllInput = {
  wallet?: string;
  networkId?: string | number;
  pageSize?: string | number;
  dryRun?: boolean;
};

export type ObMarketBookInput = MarketReferenceInput & {
  outcomeId?: string | number;
};

export type ObMarketTradesInput = MarketReferenceInput & {
  outcomeId?: string | number;
  page?: string | number;
  limit?: string | number;
};

export type ObLimitOrderInput = MarketReferenceInput & {
  outcomeId: string | number;
  price: string | number;
  shares: string | number;
  timeInForce?: string;
  waitMs?: string | number;
  expiration?: string | number;
  minFillShares?: string | number;
  allowance?: string;
  skipApproval?: boolean;
  dryRun?: boolean;
};

export type ObMarketOrderInput = MarketReferenceInput & {
  outcomeId: string | number;
  shares?: string | number;
  value?: string | number;
  timeInForce?: string;
  waitMs?: string | number;
  allowance?: string;
  skipApproval?: boolean;
  dryRun?: boolean;
};

export type ObOrdersListInput = {
  trader?: string;
  marketId?: string | number;
  status?: string;
  offset?: string | number;
  limit?: string | number;
  networkId?: string | number;
};

export type ObOrderShowInput = {
  orderHash: string;
};

export type ObOrderCancelInput = {
  orderHash: string;
  dryRun?: boolean;
};

export type ObOrderCancelAllInput = MarketReferenceInput & {
  dryRun?: boolean;
};

export type ObOrderCancelBatchInput = {
  orderHashes: string[];
  dryRun?: boolean;
};

export type ObPositionActionInput = MarketReferenceInput & {
  amount: string | number;
  allowance?: string;
  skipApproval?: boolean;
  dryRun?: boolean;
};

export type ObPositionRedeemInput = MarketReferenceInput & {
  dryRun?: boolean;
};

type ClaimTarget = {
  actionExpected: "claim_winnings" | "claim_voided";
  marketId: number;
  networkId: number;
  outcomeId?: number;
};

const ONE_E18 = 1000000000000000000n;
const DEFAULT_IMMEDIATE_ORDER_WAIT_MS = 20000;
const ORDER_STATUS_POLL_INTERVAL_MS = 500;
const CLOB_ORDER_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  Order: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "outcomeId", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "amount", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "minFillAmount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiration", type: "uint256" }
  ]
};
const CLOB_CANCEL_ALL_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  CancelAll: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "timestamp", type: "uint256" }
  ]
};

function parseIntegerValue(input: string | number, fieldName: string): number {
  if (typeof input === "number") {
    if (!Number.isInteger(input)) {
      throw new Error(`${fieldName} must be an integer. Received: ${input}`);
    }
    return input;
  }
  return parseInteger(input, fieldName);
}

function parseNumberValue(input: string | number, fieldName: string): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new Error(`${fieldName} must be a number. Received: ${input}`);
    }
    return input;
  }
  return parseNumber(input, fieldName);
}

function parseMaybeInteger(input: string | number | undefined, fieldName: string): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  return parseIntegerValue(input, fieldName);
}

function parseMaybeNumber(input: string | number | undefined, fieldName: string): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  return parseNumberValue(input, fieldName);
}

function normalizePositiveDecimalInput(input: string | number, fieldName: string): string {
  const normalized = typeof input === "number" ? String(input) : input.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`${fieldName} must be a positive decimal amount. Received: ${input}`);
  }
  if (Number.parseFloat(normalized) <= 0) {
    throw new Error(`${fieldName} must be greater than zero. Received: ${input}`);
  }
  return normalized;
}

function parseTokenUnits(input: string | number, decimals: number, fieldName: string): string {
  const normalized = normalizePositiveDecimalInput(input, fieldName);
  try {
    const parsed = parseUnits(normalized, decimals);
    if (parsed <= 0n) {
      throw new Error(`${fieldName} must be greater than zero.`);
    }
    return parsed.toString();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${fieldName}. ${details}`);
  }
}

function parsePriceUnits(input: string | number): string {
  const normalized = normalizePositiveDecimalInput(input, "price");
  let parsed: bigint;
  try {
    parsed = parseUnits(normalized, 18);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid price. ${details}`);
  }

  if (parsed <= 0n || parsed > ONE_E18) {
    throw new Error("price must be between 0 and 1 inclusive.");
  }

  return parsed.toString();
}

function getMarketCollateralDecimals(market: Market): number {
  const decimals = market.token?.decimals;
  if (typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0) {
    return decimals;
  }
  return 18;
}

function getMarketExecutionMode(market: Market): number | undefined {
  const candidate: unknown = market.executionMode ?? market.execution_mode;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function ensureOrderbookMarket(market: Market): void {
  const executionMode = getMarketExecutionMode(market);
  if (executionMode !== undefined && executionMode !== 1) {
    throw new Error(`Market ${market.id} is not an orderbook market (execution_mode=${executionMode}).`);
  }
}

function parseTimeInForce(
  input: string | undefined,
  defaultValue: ClobTimeInForce,
  allowed: ClobTimeInForce[]
): ClobTimeInForce {
  const normalized = (input ?? defaultValue).trim().toUpperCase() as ClobTimeInForce;
  if (!allowed.includes(normalized)) {
    throw new Error(`Unsupported time-in-force "${input}". Use ${allowed.join(" | ")}.`);
  }
  return normalized;
}

function isImmediateTimeInForce(timeInForce: ClobTimeInForce): boolean {
  return timeInForce === "FAK" || timeInForce === "FOK";
}

function resolveOrderWaitMs(input: string | number | undefined, timeInForce: ClobTimeInForce): number {
  if (input === undefined) {
    return isImmediateTimeInForce(timeInForce) ? DEFAULT_IMMEDIATE_ORDER_WAIT_MS : 0;
  }

  const parsed = parseIntegerValue(input, "wait-ms");
  if (parsed < 0) {
    throw new Error(`wait-ms must be greater than or equal to zero. Received: ${input}`);
  }
  return parsed;
}

function resolveExpiration(timeInForce: ClobTimeInForce, expiration?: string | number): string {
  const parsed = expiration === undefined ? 0 : parseIntegerValue(expiration, "expiration");
  if (timeInForce === "GTD") {
    if (parsed <= 0) {
      throw new Error("expiration must be a positive unix timestamp when --time-in-force is GTD.");
    }
    return String(parsed);
  }

  if (parsed !== 0) {
    throw new Error("expiration may only be set when --time-in-force is GTD.");
  }

  return "0";
}

function ensureOrderbookRuntime(runtime: RuntimeConfig) {
  const orderbookRuntime =
    !runtime.collateralTokenAddress && runtime.usd1TokenAddress
      ? {
          ...runtime,
          collateralTokenAddress: runtime.usd1TokenAddress
        }
      : runtime;

  return assertOrderbookConfig(orderbookRuntime);
}

function formatRawUnits(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}

function multiplyPriceAndAmount(priceRaw: bigint, amountRaw: bigint): bigint {
  return (amountRaw * priceRaw) / ONE_E18;
}

function generateClobNonce(): string {
  return BigInt(hexlify(randomBytes(32))).toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getClobSideLabel(side: 0 | 1): "buy" | "sell" {
  return side === 0 ? "buy" : "sell";
}

function getOrderbookSide(levelsForBuy: boolean, book: { bids: OrderbookLevel[]; asks: OrderbookLevel[] }): OrderbookLevel[] {
  return levelsForBuy ? book.asks ?? [] : book.bids ?? [];
}

function buildClobDomain(runtime: RuntimeConfig & { obExchangeAddress: string }) {
  return {
    name: "MyriadCTFExchange",
    version: "1",
    chainId: runtime.chainId,
    verifyingContract: runtime.obExchangeAddress
  };
}

function buildClobCancelRequest(record: ClobOrderRecord, defaultNetworkId: number): {
  order: ClobOrder;
  signature: string;
  network_id: number;
} {
  const payload = buildClobSignedOrderPayload(record);
  return {
    ...payload,
    network_id: record.networkId ?? defaultNetworkId
  };
}

function buildClobSignedOrderPayload(record: ClobOrderRecord): {
  order: ClobOrder;
  signature: string;
} {
  if (!record.order) {
    throw new Error(`Order ${record.orderHash} is missing its signed order payload.`);
  }
  if (!record.signature) {
    throw new Error(`Order ${record.orderHash} is missing its signature.`);
  }
  return {
    order: record.order,
    signature: record.signature
  };
}

function buildClobCancelBatchRequest(
  records: ClobOrderRecord[],
  networkId: number
): {
  orders: Array<{
    order: ClobOrder;
    signature: string;
  }>;
  network_id: number;
} {
  return {
    orders: records.map((record) => buildClobSignedOrderPayload(record)),
    network_id: networkId
  };
}

async function buildClobCancelAllRequest(
  privateKey: string,
  runtime: RuntimeConfig & { obExchangeAddress: string },
  trader: string,
  marketId?: number
): Promise<{
  trader: string;
  timestamp: string;
  signature: string;
  market_id?: number;
  network_id: number;
}> {
  const wallet = new Wallet(privateKey);
  const domain = buildClobDomain(runtime);
  const typedData = {
    trader: getAddress(trader),
    marketId: marketId ?? 0,
    timestamp: String(Math.floor(Date.now() / 1000))
  };
  const signature = await wallet.signTypedData(domain, CLOB_CANCEL_ALL_TYPES, typedData);

  return {
    trader: typedData.trader,
    timestamp: typedData.timestamp,
    signature,
    ...(marketId !== undefined ? { market_id: marketId } : {}),
    network_id: runtime.chainId
  };
}

function normalizeOrderHashes(orderHashes: string[]): string[] {
  const normalized = orderHashes
    .map((orderHash) => orderHash.trim())
    .filter((orderHash) => orderHash.length > 0);

  if (normalized.length === 0) {
    throw new Error("Provide at least one order hash.");
  }

  return [...new Set(normalized)];
}

function estimateBuyCollateralApproval(amountRaw: bigint, priceRaw: bigint): bigint {
  // Add a modest fee cushion because the API validates notional + fee, and the fee schedule is not exposed here.
  return (multiplyPriceAndAmount(priceRaw, amountRaw) * 105n) / 100n;
}

function parseClobStatus(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function parseBigNumberValue(value: unknown): bigint | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return undefined;
  }

  try {
    const parsed = BigInt(String(value));
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isTerminalOrderStatus(status: string | undefined): boolean {
  return status === "filled" || status === "cancelled" || status === "expired";
}

function deriveOrderCompletion(record: {
  status?: unknown;
  filledAmount?: unknown;
  order?: { amount?: unknown } | undefined;
}): { completion: string; finalized: boolean; observedStatus?: string } {
  const observedStatus = parseClobStatus(record.status);
  const orderAmountRaw = parseBigNumberValue(record.order?.amount);
  const filledAmountRaw = parseBigNumberValue(record.filledAmount) ?? 0n;

  if (observedStatus === "filled" || (orderAmountRaw !== undefined && filledAmountRaw >= orderAmountRaw)) {
    return {
      completion: "filled",
      finalized: true,
      observedStatus: observedStatus ?? "filled"
    };
  }

  if (filledAmountRaw > 0n) {
    return {
      completion: "partially_filled",
      finalized: observedStatus === "cancelled" || observedStatus === "expired",
      observedStatus
    };
  }

  if (observedStatus === "cancelled") {
    return {
      completion: "cancelled",
      finalized: true,
      observedStatus
    };
  }

  if (observedStatus === "expired") {
    return {
      completion: "expired",
      finalized: true,
      observedStatus
    };
  }

  if (observedStatus === "open") {
    return {
      completion: "open",
      finalized: false,
      observedStatus
    };
  }

  return {
    completion: "pending_sync",
    finalized: false,
    observedStatus
  };
}

function createClobOrder(params: {
  trader: string;
  marketId: number;
  outcomeId: number;
  side: 0 | 1;
  amountRaw: string;
  priceRaw: string;
  minFillAmountRaw?: string;
  expiration: string;
}): ClobOrder {
  return {
    trader: getAddress(params.trader),
    marketId: String(params.marketId),
    outcomeId: params.outcomeId,
    side: params.side,
    amount: params.amountRaw,
    price: params.priceRaw,
    minFillAmount: params.minFillAmountRaw ?? "0",
    nonce: generateClobNonce(),
    expiration: params.expiration
  };
}

async function signClobOrder(
  privateKey: string,
  runtime: RuntimeConfig & { obExchangeAddress: string },
  order: ClobOrder
): Promise<{ signature: string; orderHash: string }> {
  const wallet = new Wallet(privateKey);
  const domain = buildClobDomain(runtime);
  const signature = await wallet.signTypedData(domain, CLOB_ORDER_TYPES, order);
  const orderHash = TypedDataEncoder.hash(domain, CLOB_ORDER_TYPES, order);
  return { signature, orderHash };
}

function walkOrderbook(params: {
  side: "buy" | "sell";
  levels: OrderbookLevel[];
  requestedSharesRaw?: string;
  requestedValueRaw?: string;
}) {
  const requestedSharesRaw = params.requestedSharesRaw ? BigInt(params.requestedSharesRaw) : undefined;
  const requestedValueRaw = params.requestedValueRaw ? BigInt(params.requestedValueRaw) : undefined;

  if (!requestedSharesRaw && !requestedValueRaw) {
    throw new Error("Internal error: market order walk requires requested shares or value.");
  }

  const levels = params.levels.map(([price, amount]) => ({
    priceRaw: BigInt(price),
    amountRaw: BigInt(amount)
  }));

  let accumulatedSharesRaw = 0n;
  let accumulatedValueRaw = 0n;
  let deepestPriceRaw = 0n;
  const consumedLevels: Array<Record<string, string>> = [];

  for (const level of levels) {
    if (requestedSharesRaw !== undefined && accumulatedSharesRaw >= requestedSharesRaw) {
      break;
    }
    if (requestedValueRaw !== undefined && accumulatedValueRaw >= requestedValueRaw) {
      break;
    }

    let consumedSharesRaw = level.amountRaw;
    if (requestedSharesRaw !== undefined) {
      const remainingShares = requestedSharesRaw - accumulatedSharesRaw;
      if (level.amountRaw > remainingShares) {
        consumedSharesRaw = remainingShares;
      }
    } else if (requestedValueRaw !== undefined) {
      const remainingValue = requestedValueRaw - accumulatedValueRaw;
      const sharesForValue = ((remainingValue * ONE_E18) + level.priceRaw - 1n) / level.priceRaw;
      if (level.amountRaw > sharesForValue) {
        consumedSharesRaw = sharesForValue;
      }
    }

    if (consumedSharesRaw <= 0n) {
      continue;
    }

    const consumedValueRaw = multiplyPriceAndAmount(level.priceRaw, consumedSharesRaw);
    accumulatedSharesRaw += consumedSharesRaw;
    accumulatedValueRaw += consumedValueRaw;
    deepestPriceRaw = level.priceRaw;
    consumedLevels.push({
      priceRaw: level.priceRaw.toString(),
      availableSharesRaw: level.amountRaw.toString(),
      consumedSharesRaw: consumedSharesRaw.toString(),
      consumedValueRaw: consumedValueRaw.toString()
    });
  }

  const requestedShares = requestedSharesRaw?.toString();
  const requestedValue = requestedValueRaw?.toString();
  const shortfallSharesRaw =
    requestedSharesRaw !== undefined && accumulatedSharesRaw < requestedSharesRaw
      ? (requestedSharesRaw - accumulatedSharesRaw).toString()
      : undefined;
  const shortfallValueRaw =
    requestedValueRaw !== undefined && accumulatedValueRaw < requestedValueRaw
      ? (requestedValueRaw - accumulatedValueRaw).toString()
      : undefined;

  if (deepestPriceRaw === 0n) {
    throw new Error(`No ${params.side === "buy" ? "asks" : "bids"} are available in the orderbook.`);
  }

  return {
    requestedSharesRaw: requestedShares,
    requestedValueRaw: requestedValue,
    estimatedSharesRaw: accumulatedSharesRaw.toString(),
    estimatedValueRaw: accumulatedValueRaw.toString(),
    deepestPriceRaw: deepestPriceRaw.toString(),
    shortfallSharesRaw,
    shortfallValueRaw,
    levels: consumedLevels
  };
}

function resolveMarketReference(options: MarketReferenceInput, defaultNetworkId: number): MarketReference {
  if ((options.marketId && options.marketSlug) || (!options.marketId && !options.marketSlug)) {
    throw new Error("Provide exactly one of --market-id or --market-slug.");
  }

  if (options.marketId !== undefined) {
    const networkId = parseMaybeInteger(options.networkId, "network-id") ?? defaultNetworkId;
    return {
      market_id: parseIntegerValue(options.marketId, "market-id"),
      network_id: networkId
    };
  }

  return {
    market_slug: options.marketSlug as string,
    network_id: parseMaybeInteger(options.networkId, "network-id")
  };
}

async function resolveMarket(
  apiClient: MyriadApiClient,
  marketReference: MarketReference,
  query: Record<string, string | number | boolean | undefined> = {}
): Promise<Market> {
  if ("market_id" in marketReference) {
    return apiClient.getMarketById(marketReference.market_id, marketReference.network_id, query);
  }
  return apiClient.getMarketBySlug(marketReference.market_slug, query);
}

async function resolveOrderbookMarket(
  apiClient: MyriadApiClient,
  marketReference: MarketReference,
  runtime: RuntimeConfig
): Promise<Market> {
  const market = await resolveMarket(apiClient, marketReference, {
    execution_mode: 1
  });
  ensureNetworkMatch(market, runtime);
  ensureOrderbookMarket(market);
  return market;
}

function ensureNetworkMatch(market: Market, runtime: RuntimeConfig): void {
  if (market.networkId !== runtime.chainId) {
    throw new Error(
      `Market network mismatch: market uses network ${market.networkId}, runtime is configured for ${runtime.chainId}. ` +
        "Use --chain-id and matching deployment addresses."
    );
  }
}

function isSameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function assertOrderOwnedByWallet(record: ClobOrderRecord, walletAddress: string): void {
  const traderAddress = record.order?.trader;
  if (!traderAddress || !isSameAddress(traderAddress, walletAddress)) {
    throw new Error(`Configured wallet ${walletAddress} does not own order ${record.orderHash}.`);
  }
}

function resolveStableSwapPair(runtime: RuntimeConfig, spendTokenAddress: string):
  | {
      spendToken: string;
      sourceToken: string;
      spendSymbol: "USDT" | "USD1";
      sourceSymbol: "USDT" | "USD1";
    }
  | undefined {
  if (runtime.chainId !== 56 || !runtime.usdtTokenAddress || !runtime.usd1TokenAddress) {
    return undefined;
  }

  if (isSameAddress(spendTokenAddress, runtime.usdtTokenAddress)) {
    return {
      spendToken: runtime.usdtTokenAddress,
      sourceToken: runtime.usd1TokenAddress,
      spendSymbol: "USDT",
      sourceSymbol: "USD1"
    };
  }

  if (isSameAddress(spendTokenAddress, runtime.usd1TokenAddress)) {
    return {
      spendToken: runtime.usd1TokenAddress,
      sourceToken: runtime.usdtTokenAddress,
      spendSymbol: "USD1",
      sourceSymbol: "USDT"
    };
  }

  return undefined;
}

function assertPancakeSwapConfig(config: RuntimeConfig): RuntimeConfig & {
  pancakeRouterV2Address: string;
  usdtTokenAddress: string;
  usd1TokenAddress: string;
} {
  if (!config.pancakeRouterV2Address) {
    throw new Error("MYRIAD_PANCAKE_ROUTER_V2 is required for swap operations.");
  }
  if (!config.usdtTokenAddress || !config.usd1TokenAddress) {
    throw new Error("MYRIAD_USDT_TOKEN and MYRIAD_USD1_TOKEN are required for stable swap operations.");
  }
  return config as RuntimeConfig & {
    pancakeRouterV2Address: string;
    usdtTokenAddress: string;
    usd1TokenAddress: string;
  };
}

function getNativeSymbol(chainId: number): string {
  if (chainId === 56 || chainId === 97) {
    return "BNB";
  }
  return "NATIVE";
}

function getNetworkName(chainId: number): string {
  return NETWORKS[chainId]?.name ?? `Chain ${chainId}`;
}

function getCollateralSymbol(runtime: RuntimeConfig): string {
  if (
    runtime.collateralTokenAddress &&
    runtime.usdtTokenAddress &&
    isSameAddress(runtime.collateralTokenAddress, runtime.usdtTokenAddress)
  ) {
    return "USDT";
  }
  if (
    runtime.collateralTokenAddress &&
    runtime.usd1TokenAddress &&
    isSameAddress(runtime.collateralTokenAddress, runtime.usd1TokenAddress)
  ) {
    return "USD1";
  }
  return "COLLATERAL";
}

function resolveClaimAllWalletAddress(explicitWallet?: string): string | undefined {
  return explicitWallet;
}

function collectClaimTargetsFromPortfolio(items: PortfolioPosition[], networkId: number): ClaimTarget[] {
  const dedup = new Map<string, ClaimTarget>();

  for (const position of items) {
    const marketId = Number(position.marketId);
    const positionNetworkId = Number(position.networkId);
    const outcomeId = Number(position.outcomeId);

    if (!Number.isFinite(marketId) || !Number.isFinite(positionNetworkId)) {
      continue;
    }
    if (positionNetworkId !== networkId) {
      continue;
    }

    const winningsToClaim = Boolean(position.winningsToClaim);
    const winningsClaimed = Boolean(position.winningsClaimed);
    const status = String(position.status ?? "");

    const shouldClaimWinnings = status === "won" || (winningsToClaim && !winningsClaimed);
    const shouldClaimVoided = status === "voided";

    if (shouldClaimWinnings) {
      const key = `claim_winnings:${positionNetworkId}:${marketId}`;
      if (!dedup.has(key)) {
        dedup.set(key, {
          actionExpected: "claim_winnings",
          marketId,
          networkId: positionNetworkId
        });
      }
    }

    if (shouldClaimVoided && Number.isFinite(outcomeId)) {
      const key = `claim_voided:${positionNetworkId}:${marketId}:${outcomeId}`;
      if (!dedup.has(key)) {
        dedup.set(key, {
          actionExpected: "claim_voided",
          marketId,
          networkId: positionNetworkId,
          outcomeId
        });
      }
    }
  }

  return [...dedup.values()];
}

async function listAllClaimTargets(params: {
  apiClient: MyriadApiClient;
  walletAddress: string;
  networkId: number;
  pageSize: number;
}): Promise<ClaimTarget[]> {
  const items: PortfolioPosition[] = [];
  let page = 1;

  while (true) {
    const response = await params.apiClient.getPortfolio(params.walletAddress, {
      network_id: params.networkId,
      status: "won,voided",
      page,
      limit: params.pageSize
    });

    items.push(...response.data);

    if (!response.pagination?.hasNext) {
      break;
    }

    page += 1;
    if (page > 1_000) {
      throw new Error("Pagination safety stop reached while scanning claimable positions.");
    }
  }

  return collectClaimTargetsFromPortfolio(items, params.networkId);
}

export class MyriadOperations {
  private readonly runtime: RuntimeConfig;
  private readonly globalAllowance?: string;
  private readonly orderWaitProgressReporter?: OrderWaitProgressReporter;

  constructor(context: OperationContext) {
    this.runtime = context.runtime;
    this.globalAllowance = context.globalAllowance;
    this.orderWaitProgressReporter = context.orderWaitProgressReporter;
  }

  private runtimeForApi(overrides?: ApiRequestOverrides): RuntimeConfig {
    return {
      ...this.runtime,
      apiBaseUrl: overrides?.apiBaseUrl ?? this.runtime.apiBaseUrl,
      apiKey: overrides?.apiKey ?? this.runtime.apiKey
    };
  }

  private createApiClient(overrides?: ApiRequestOverrides): MyriadApiClient {
    const runtime = this.runtimeForApi(overrides);
    return new MyriadApiClient({
      baseUrl: runtime.apiBaseUrl,
      apiKey: runtime.apiKey
    });
  }

  private resolveEffectiveAllowancePreference(actionLevelAllowance?: string): AllowancePreference {
    return resolveAllowancePreference(
      actionLevelAllowance,
      this.globalAllowance ?? process.env.MYRIAD_ALLOWANCE ?? this.runtime.allowance
    );
  }

  private async resolveSignerPrivateKey(runtime: RuntimeConfig): Promise<string> {
    if (runtime.privateKey) {
      return runtime.privateKey;
    }

    const storedPrivateKey = await loadConfiguredWalletPrivateKey();
    if (storedPrivateKey) {
      return storedPrivateKey;
    }

    throw new Error(
      "Wallet signer is not configured. Run `myriad wallet setup`, set MYRIAD_PRIVATE_KEY, or pass --private-key."
    );
  }

  private async resolveWalletAddress(runtime: RuntimeConfig, explicitAddress?: string): Promise<string> {
    if (explicitAddress) {
      return explicitAddress;
    }

    if (runtime.privateKey) {
      return new Wallet(runtime.privateKey).address;
    }

    const storedAddress = await readConfiguredWalletAddress();
    if (storedAddress) {
      return storedAddress;
    }

    throw new Error(
      "Provide --address, run `myriad wallet setup`, set MYRIAD_PRIVATE_KEY, or pass --private-key."
    );
  }

  private async resolveOrderbookSigner(runtime: RuntimeConfig & { obExchangeAddress: string }): Promise<{
    privateKey: string;
    walletAddress: string;
  }> {
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const walletAddress = new Wallet(privateKey).address;
    return { privateKey, walletAddress };
  }

  private async waitForSubmittedOrder(
    apiClient: MyriadApiClient,
    orderHash: string,
    waitMs: number,
    timeInForce: ClobTimeInForce
  ): Promise<{ observedOrder?: ClobOrderRecord; polled: boolean; timedOut: boolean }> {
    if (waitMs <= 0) {
      return {
        polled: false,
        timedOut: false
      };
    }

    const deadline = Date.now() + waitMs;
    let observedOrder: ClobOrderRecord | undefined;
    let nextCountdownSecond = Math.ceil(waitMs / 1000);
    const reportCountdown = (remainingMs: number) => {
      if (!this.orderWaitProgressReporter) {
        return;
      }

      const remainingSeconds = Math.ceil(Math.max(remainingMs, 0) / 1000);
      if (remainingSeconds <= 0 || remainingSeconds > nextCountdownSecond) {
        return;
      }

      while (nextCountdownSecond > remainingSeconds) {
        nextCountdownSecond -= 1;
      }

      this.orderWaitProgressReporter({ type: "countdown", remainingSeconds: nextCountdownSecond });

      if (nextCountdownSecond <= 5) {
        nextCountdownSecond = 0;
        return;
      }

      if (nextCountdownSecond <= 10) {
        nextCountdownSecond = 5;
        return;
      }

      nextCountdownSecond = Math.floor((nextCountdownSecond - 1) / 5) * 5;
    };

    this.orderWaitProgressReporter?.({ type: "posted", timeInForce });
    reportCountdown(waitMs);

    while (true) {
      try {
        const order = await apiClient.getOrder(orderHash);
        observedOrder = order;

        if (isTerminalOrderStatus(parseClobStatus(order.status))) {
          return {
            observedOrder,
            polled: true,
            timedOut: false
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("MYRIAD API request failed (404)")) {
          throw error;
        }
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return {
          observedOrder,
          polled: true,
          timedOut: true
        };
      }

      await sleep(Math.min(ORDER_STATUS_POLL_INTERVAL_MS, remainingMs));
      reportCountdown(deadline - Date.now());
    }
  }

  private buildSubmittedOrderTracking(params: {
    orderHash: string;
    order: ClobOrder;
    timeInForce: ClobTimeInForce;
    waitMs: number;
    response: Record<string, unknown>;
    observedOrder?: ClobOrderRecord;
    polled: boolean;
    timedOut: boolean;
  }): Record<string, unknown> {
    const responseStatus = parseClobStatus(params.response.status);
    const observed = params.observedOrder ? deriveOrderCompletion(params.observedOrder) : undefined;

    if (observed?.finalized) {
      return {
        waitMs: params.waitMs,
        pollIntervalMs: params.polled ? ORDER_STATUS_POLL_INTERVAL_MS : 0,
        polled: params.polled,
        timedOut: false,
        observedOrder: params.observedOrder,
        observedStatus: observed.observedStatus ?? responseStatus,
        finalized: true,
        completion: observed.completion,
        followUpCommand: `myriad ob orders show ${params.orderHash} --json`
      };
    }

    if (params.timedOut) {
      return {
        waitMs: params.waitMs,
        pollIntervalMs: ORDER_STATUS_POLL_INTERVAL_MS,
        polled: true,
        timedOut: true,
        observedOrder: params.observedOrder,
        observedStatus: observed?.observedStatus ?? responseStatus,
        finalized: false,
        completion: "pending_sync",
        followUpCommand: `myriad ob orders show ${params.orderHash} --json`
      };
    }

    if (params.polled) {
      return {
        waitMs: params.waitMs,
        pollIntervalMs: ORDER_STATUS_POLL_INTERVAL_MS,
        polled: true,
        timedOut: false,
        observedOrder: params.observedOrder,
        observedStatus: observed?.observedStatus ?? responseStatus,
        finalized: false,
        completion: "pending_sync",
        followUpCommand: `myriad ob orders show ${params.orderHash} --json`
      };
    }

    const immediate = deriveOrderCompletion({
      status: responseStatus,
      order: params.order
    });

    return {
      waitMs: params.waitMs,
      pollIntervalMs: 0,
      polled: false,
      timedOut: false,
      observedOrder: undefined,
      observedStatus: immediate.observedStatus,
      finalized: immediate.finalized,
      completion:
        params.waitMs === 0 && isImmediateTimeInForce(params.timeInForce) && !immediate.finalized
          ? "pending_sync"
          : immediate.completion,
      followUpCommand: `myriad ob orders show ${params.orderHash} --json`
    };
  }

  private async executePositionCalldata(
    runtime: RuntimeConfig,
    privateKey: string,
    call: { to: string; calldata: string; value?: string }
  ): Promise<unknown> {
    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });

    return executionService.sendContractCalldata({
      to: call.to,
      calldata: call.calldata,
      valueWei: call.value
    });
  }

  async listMarkets(input: ListMarketsInput = {}, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);

    const networkId = parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId;
    return apiClient.listMarkets({
      state: input.state ?? "open",
      network_id: networkId,
      keyword: input.keyword,
      sort: input.sort ?? "volume",
      order: input.order ?? "desc",
      page: parseMaybeInteger(input.page, "page") ?? 1,
      limit: parseMaybeInteger(input.limit, "limit") ?? 20
    });
  }

  async showMarket(marketArgument: string | number, input: { networkId?: string | number } = {}, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);

    if (typeof marketArgument === "number") {
      return apiClient.getMarketById(marketArgument, parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId);
    }

    const asNumber = Number.parseInt(marketArgument, 10);
    if (!Number.isNaN(asNumber)) {
      return apiClient.getMarketById(asNumber, parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId);
    }

    return apiClient.getMarketBySlug(marketArgument);
  }

  async usersPortfolio(input: { address: string } & PortfolioInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);

    return apiClient.getPortfolio(input.address, {
      network_id: parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId,
      market_id: parseMaybeInteger(input.marketId, "market-id"),
      market_slug: input.marketSlug,
      token_address: input.tokenAddress,
      page: parseMaybeInteger(input.page, "page") ?? 1,
      limit: parseMaybeInteger(input.limit, "limit") ?? 20
    });
  }

  async portfolio(input: PortfolioInput = {}, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);
    const address = await this.resolveWalletAddress(runtime);

    const response = await apiClient.getPortfolio(address, {
      network_id: parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId,
      market_id: parseMaybeInteger(input.marketId, "market-id"),
      market_slug: input.marketSlug,
      token_address: input.tokenAddress,
      page: parseMaybeInteger(input.page, "page") ?? 1,
      limit: parseMaybeInteger(input.limit, "limit") ?? 20
    });

    return {
      wallet: address,
      ...response
    };
  }

  async obMarketsList(input: ObMarketsListInput = {}, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);

    return apiClient.listMarkets({
      state: input.state ?? "open",
      network_id: parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId,
      execution_mode: 1,
      keyword: input.keyword,
      sort: input.sort ?? "volume_24h",
      order: input.order ?? "desc",
      page: parseMaybeInteger(input.page, "page") ?? 1,
      limit: parseMaybeInteger(input.limit, "limit") ?? 20
    });
  }

  async obMarketsShow(
    marketArgument: string | number,
    input: { networkId?: string | number } = {},
    overrides?: ApiRequestOverrides
  ): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);

    let market: Market;
    if (typeof marketArgument === "number") {
      market = await apiClient.getMarketById(
        marketArgument,
        parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId,
        {
          execution_mode: 1
        }
      );
    } else {
      const asNumber = Number.parseInt(marketArgument, 10);
      if (!Number.isNaN(asNumber)) {
        market = await apiClient.getMarketById(asNumber, parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId, {
          execution_mode: 1
        });
      } else {
        market = await apiClient.getMarketBySlug(marketArgument, {
          execution_mode: 1
        });
      }
    }

    ensureNetworkMatch(market, runtime);
    ensureOrderbookMarket(market);
    return market;
  }

  async obMarketOrderbook(input: ObMarketBookInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);
    const marketReference = resolveMarketReference(input, runtime.chainId);
    const market = await resolveOrderbookMarket(apiClient, marketReference, runtime);
    const outcomeId = parseMaybeInteger(input.outcomeId, "outcome-id") ?? 0;
    if (outcomeId !== 0 && outcomeId !== 1) {
      throw new Error("outcome-id must be 0 or 1.");
    }

    const orderbook = await apiClient.getMarketOrderbook(market.id, {
      network_id: runtime.chainId,
      outcome: outcomeId
    });

    return {
      marketId: market.id,
      marketTitle: market.title,
      outcomeId,
      ...orderbook
    };
  }

  async obMarketTrades(input: ObMarketTradesInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);
    const marketReference = resolveMarketReference(input, runtime.chainId);
    const market = await resolveOrderbookMarket(apiClient, marketReference, runtime);
    const outcomeId = parseMaybeInteger(input.outcomeId, "outcome-id");

    const response = await apiClient.getMarketTrades(market.id, {
      network_id: runtime.chainId,
      outcome: outcomeId,
      page: parseMaybeInteger(input.page, "page") ?? 1,
      limit: parseMaybeInteger(input.limit, "limit") ?? 50
    });

    return {
      marketId: market.id,
      marketTitle: market.title,
      outcomeId,
      ...response
    };
  }

  async obPositionsList(input: ObPositionsListInput = {}, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);
    const address = await this.resolveWalletAddress(runtime, input.address);

    const response = await apiClient.getPortfolio(address, {
      execution_mode: 1,
      network_id: runtime.chainId,
      market_id: parseMaybeInteger(input.marketId, "market-id"),
      market_slug: input.marketSlug,
      token_address: input.tokenAddress,
      page: parseMaybeInteger(input.page, "page") ?? 1,
      limit: parseMaybeInteger(input.limit, "limit") ?? 20
    });

    return {
      wallet: address,
      ...response
    };
  }

  async walletBalances(input: WalletBalancesInput = {}): Promise<unknown> {
    const runtime = assertCollateralConfig(this.runtime);
    const address = await this.resolveWalletAddress(runtime, input.address);
    const service = new WalletBalanceService(runtime.rpcUrl);

    const native = await service.getNativeBalance(address, getNativeSymbol(runtime.chainId));

    const tokenEntries: Array<{ label: string; address: string }> = [
      { label: "collateral", address: runtime.collateralTokenAddress }
    ];

    if (runtime.chainId === 56) {
      if (runtime.usdtTokenAddress) {
        tokenEntries.push({ label: "usdt", address: runtime.usdtTokenAddress });
      }
      if (runtime.usd1TokenAddress) {
        tokenEntries.push({ label: "usd1", address: runtime.usd1TokenAddress });
      }
    }

    const tokens = await service.getTokenBalances(address, tokenEntries);

    return {
      wallet: address,
      chainId: runtime.chainId,
      native,
      tokens
    };
  }

  async walletDeposit(input: WalletDepositInput = {}): Promise<WalletDepositResult> {
    const runtime = assertCollateralConfig(this.runtime);
    const address = await this.resolveWalletAddress(runtime, input.address);
    const nativeSymbol = getNativeSymbol(runtime.chainId);
    const collateralSymbol = getCollateralSymbol(runtime);
    const collateralAddress = getAddress(runtime.collateralTokenAddress);

    return {
      wallet: address,
      chainId: runtime.chainId,
      network: getNetworkName(runtime.chainId),
      instructions: [
        `Send ${nativeSymbol} to ${address} for gas.`,
        `Send ${collateralSymbol} collateral token (${collateralAddress}) to ${address} for trading.`
      ],
      assets: {
        native: {
          symbol: nativeSymbol
        },
        collateral: {
          symbol: collateralSymbol,
          address: collateralAddress
        }
      }
    };
  }

  private async placeObLimitOrder(
    side: 0 | 1,
    input: ObLimitOrderInput,
    overrides?: ApiRequestOverrides
  ): Promise<unknown> {
    const runtime = ensureOrderbookRuntime(this.runtimeForApi(overrides));
    const apiClient = this.createApiClient(overrides);
    const marketReference = resolveMarketReference(input, runtime.chainId);
    const market = await resolveOrderbookMarket(apiClient, marketReference, runtime);
    const { privateKey, walletAddress } = await this.resolveOrderbookSigner(runtime);
    const outcomeId = parseIntegerValue(input.outcomeId, "outcome-id");
    if (outcomeId !== 0 && outcomeId !== 1) {
      throw new Error("outcome-id must be 0 or 1.");
    }

    const sharesRaw = parseTokenUnits(input.shares, 18, "shares");
    const priceRaw = parsePriceUnits(input.price);
    const timeInForce = parseTimeInForce(input.timeInForce, "GTC", ["GTC", "GTD", "FOK", "FAK"]);
    const waitMs = resolveOrderWaitMs(input.waitMs, timeInForce);
    const expiration = resolveExpiration(timeInForce, input.expiration);
    const minFillAmountRaw =
      input.minFillShares !== undefined ? parseTokenUnits(input.minFillShares, 18, "min-fill-shares") : "0";

    if (BigInt(minFillAmountRaw) > BigInt(sharesRaw)) {
      throw new Error("min-fill-shares cannot be greater than shares.");
    }

    const order = createClobOrder({
      trader: walletAddress,
      marketId: market.id,
      outcomeId,
      side,
      amountRaw: sharesRaw,
      priceRaw,
      minFillAmountRaw,
      expiration
    });
    const { signature, orderHash } = await signClobOrder(privateKey, runtime, order);
    const collateralTokenAddress = market.token?.address ?? runtime.collateralTokenAddress;
    const collateralDecimals = getMarketCollateralDecimals(market);
    const allowancePreference = this.resolveEffectiveAllowancePreference(input.allowance);
    const requiredBuyApprovalRaw = estimateBuyCollateralApproval(BigInt(order.amount), BigInt(order.price));
    const requiredBuyApprovalAmount = formatRawUnits(requiredBuyApprovalRaw, collateralDecimals);
    const approvalPreview =
      side === 0
        ? {
            type: "erc20_allowance",
            tokenAddress: collateralTokenAddress,
            spenderAddress: runtime.obExchangeAddress,
            requiredAmountRaw: requiredBuyApprovalRaw.toString(),
            requiredAmount: requiredBuyApprovalAmount,
            allowancePreference
          }
        : {
            type: "erc1155_approval_for_all",
            tokenAddress: runtime.obConditionalTokens,
            operatorAddress: runtime.obExchangeAddress
          };

    const submission = {
      order,
      signature,
      network_id: runtime.chainId,
      time_in_force: timeInForce
    };

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        executionMode: "orderbook",
        marketId: market.id,
        marketTitle: market.title,
        outcomeId,
        side: getClobSideLabel(side),
        timeInForce,
        order,
        orderHash,
        signature,
        submission,
        approval: approvalPreview
      };
    }

    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });

    const approval =
      input.skipApproval === true
        ? { approved: true, skipped: true }
        : side === 0
          ? await executionService.ensureErc20Allowance({
              tokenAddress: collateralTokenAddress,
              spenderAddress: runtime.obExchangeAddress,
              requiredAmount: requiredBuyApprovalAmount,
              allowancePreference
            })
          : await executionService.ensureErc1155ApprovalForAll({
              tokenAddress: runtime.obConditionalTokens,
              operatorAddress: runtime.obExchangeAddress
            });

    const response = await apiClient.createOrder(submission);
    const observation = await this.waitForSubmittedOrder(apiClient, orderHash, waitMs, timeInForce);

    return {
      wallet: walletAddress,
      executionMode: "orderbook",
      marketId: market.id,
      marketTitle: market.title,
      outcomeId,
      side: getClobSideLabel(side),
      timeInForce,
      order,
      orderHash,
      signature,
      approval,
      response,
      submission: response,
      ...this.buildSubmittedOrderTracking({
        orderHash,
        order,
        timeInForce,
        waitMs,
        response,
        observedOrder: observation.observedOrder,
        polled: observation.polled,
        timedOut: observation.timedOut
      })
    };
  }

  private async placeObMarketOrder(
    side: 0 | 1,
    input: ObMarketOrderInput,
    overrides?: ApiRequestOverrides
  ): Promise<unknown> {
    if ((input.shares !== undefined && input.value !== undefined) || (input.shares === undefined && input.value === undefined)) {
      throw new Error("Provide exactly one of --shares or --value for market orders.");
    }

    const runtime = ensureOrderbookRuntime(this.runtimeForApi(overrides));
    const apiClient = this.createApiClient(overrides);
    const marketReference = resolveMarketReference(input, runtime.chainId);
    const market = await resolveOrderbookMarket(apiClient, marketReference, runtime);
    const { privateKey, walletAddress } = await this.resolveOrderbookSigner(runtime);
    const outcomeId = parseIntegerValue(input.outcomeId, "outcome-id");
    if (outcomeId !== 0 && outcomeId !== 1) {
      throw new Error("outcome-id must be 0 or 1.");
    }

    const collateralDecimals = getMarketCollateralDecimals(market);
    const timeInForce = parseTimeInForce(input.timeInForce, "FAK", ["FAK", "FOK"]);
    const waitMs = resolveOrderWaitMs(input.waitMs, timeInForce);
    const requestedSharesRaw = input.shares !== undefined ? parseTokenUnits(input.shares, 18, "shares") : undefined;
    const requestedValueRaw = input.value !== undefined ? parseTokenUnits(input.value, collateralDecimals, "value") : undefined;
    const orderbook = await apiClient.getMarketOrderbook(market.id, {
      network_id: runtime.chainId,
      outcome: outcomeId
    });
    const walk = walkOrderbook({
      side: getClobSideLabel(side),
      levels: getOrderbookSide(side === 0, orderbook),
      requestedSharesRaw,
      requestedValueRaw
    });

    if (requestedValueRaw && walk.shortfallValueRaw) {
      throw new Error("Insufficient orderbook depth to derive a market order from the requested value.");
    }
    if (requestedSharesRaw && timeInForce === "FOK" && walk.shortfallSharesRaw) {
      throw new Error("Insufficient orderbook depth to fully fill the requested shares with time-in-force FOK.");
    }

    const amountRaw = requestedSharesRaw ?? walk.estimatedSharesRaw;
    const order = createClobOrder({
      trader: walletAddress,
      marketId: market.id,
      outcomeId,
      side,
      amountRaw,
      priceRaw: walk.deepestPriceRaw,
      expiration: "0"
    });
    const { signature, orderHash } = await signClobOrder(privateKey, runtime, order);
    const collateralTokenAddress = market.token?.address ?? runtime.collateralTokenAddress;
    const allowancePreference = this.resolveEffectiveAllowancePreference(input.allowance);
    const estimatedBuyApprovalRaw = estimateBuyCollateralApproval(BigInt(order.amount), BigInt(order.price));
    const estimatedBuyApprovalAmount = formatRawUnits(estimatedBuyApprovalRaw, collateralDecimals);
    const approvalPreview =
      side === 0
        ? {
            type: "erc20_allowance",
            tokenAddress: collateralTokenAddress,
            spenderAddress: runtime.obExchangeAddress,
            requiredAmountRaw: estimatedBuyApprovalRaw.toString(),
            requiredAmount: estimatedBuyApprovalAmount,
            allowancePreference
          }
        : {
            type: "erc1155_approval_for_all",
            tokenAddress: runtime.obConditionalTokens,
            operatorAddress: runtime.obExchangeAddress
          };

    const submission = {
      order,
      signature,
      network_id: runtime.chainId,
      time_in_force: timeInForce
    };
    const marketQuote = {
      inputMode: requestedSharesRaw ? "shares" : "value",
      requestedSharesRaw,
      requestedValueRaw,
      estimatedSharesRaw: walk.estimatedSharesRaw,
      estimatedValueRaw: walk.estimatedValueRaw,
      deepestPriceRaw: walk.deepestPriceRaw,
      shortfallSharesRaw: walk.shortfallSharesRaw,
      shortfallValueRaw: walk.shortfallValueRaw,
      levels: walk.levels,
      note:
        requestedValueRaw !== undefined
          ? "Derived from the current book snapshot. Realized fill can differ because CLOB market orders are synthesized from share-based limit orders."
          : undefined
    };

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        executionMode: "orderbook",
        marketId: market.id,
        marketTitle: market.title,
        outcomeId,
        side: getClobSideLabel(side),
        timeInForce,
        order,
        orderHash,
        signature,
        submission,
        marketQuote,
        approval: approvalPreview
      };
    }

    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });

    const approval =
      input.skipApproval === true
        ? { approved: true, skipped: true }
        : side === 0
          ? await executionService.ensureErc20Allowance({
              tokenAddress: collateralTokenAddress,
              spenderAddress: runtime.obExchangeAddress,
              requiredAmount: estimatedBuyApprovalAmount,
              allowancePreference
            })
          : await executionService.ensureErc1155ApprovalForAll({
              tokenAddress: runtime.obConditionalTokens,
              operatorAddress: runtime.obExchangeAddress
            });

    const response = await apiClient.createOrder(submission);
    const observation = await this.waitForSubmittedOrder(apiClient, orderHash, waitMs, timeInForce);

    return {
      wallet: walletAddress,
      executionMode: "orderbook",
      marketId: market.id,
      marketTitle: market.title,
      outcomeId,
      side: getClobSideLabel(side),
      timeInForce,
      order,
      orderHash,
      signature,
      marketQuote,
      approval,
      response,
      submission: response,
      ...this.buildSubmittedOrderTracking({
        orderHash,
        order,
        timeInForce,
        waitMs,
        response,
        observedOrder: observation.observedOrder,
        polled: observation.polled,
        timedOut: observation.timedOut
      })
    };
  }

  async obLimitBuy(input: ObLimitOrderInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    return this.placeObLimitOrder(0, input, overrides);
  }

  async obLimitSell(input: ObLimitOrderInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    return this.placeObLimitOrder(1, input, overrides);
  }

  async obMarketBuy(input: ObMarketOrderInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    return this.placeObMarketOrder(0, input, overrides);
  }

  async obMarketSell(input: ObMarketOrderInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    return this.placeObMarketOrder(1, input, overrides);
  }

  async obOrdersList(input: ObOrdersListInput = {}, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);
    const trader = await this.resolveWalletAddress(runtime, input.trader);
    const response = await apiClient.listOrders({
      trader,
      network_id: parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId,
      market_id: parseMaybeInteger(input.marketId, "market-id"),
      status: input.status,
      limit: parseMaybeInteger(input.limit, "limit") ?? 50,
      offset: parseMaybeInteger(input.offset, "offset") ?? 0
    });

    return {
      trader,
      ...response
    };
  }

  async obOrdersShow(input: ObOrderShowInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const apiClient = this.createApiClient(overrides);
    return apiClient.getOrder(input.orderHash);
  }

  async obOrdersCancel(input: ObOrderCancelInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = this.runtimeForApi(overrides);
    const apiClient = this.createApiClient(overrides);
    const walletAddress = await this.resolveWalletAddress(runtime);
    const existingOrder = await apiClient.getOrder(input.orderHash);
    assertOrderOwnedByWallet(existingOrder, walletAddress);

    const cancelRequest = buildClobCancelRequest(existingOrder, runtime.chainId);

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        orderHash: input.orderHash,
        cancelRequest,
        existingOrder
      };
    }

    const response = await apiClient.cancelOrder(input.orderHash, cancelRequest);
    return {
      wallet: walletAddress,
      orderHash: input.orderHash,
      response
    };
  }

  async obOrdersCancelAll(input: ObOrderCancelAllInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = ensureOrderbookRuntime(this.runtimeForApi(overrides));
    const apiClient = this.createApiClient(overrides);
    const { privateKey, walletAddress } = await this.resolveOrderbookSigner(runtime);
    const hasMarketScope = input.marketId !== undefined || input.marketSlug !== undefined;
    const market = hasMarketScope
      ? await resolveOrderbookMarket(apiClient, resolveMarketReference(input, runtime.chainId), runtime)
      : undefined;
    const cancelAllRequest = await buildClobCancelAllRequest(privateKey, runtime, walletAddress, market?.id);

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        ...(market ? { marketId: market.id, marketTitle: market.title } : {}),
        cancelAllRequest,
        dryRun: true
      };
    }

    const response = await apiClient.cancelAllOrders(cancelAllRequest);
    const cancelledCount = response.cancelled_count;
    const cancelled =
      typeof cancelledCount === "number"
        ? cancelledCount
        : typeof cancelledCount === "string" && cancelledCount.trim().length > 0
          ? Number(cancelledCount)
          : undefined;
    const marketIdsAffected = Array.isArray(response.market_ids_affected)
      ? response.market_ids_affected.map((marketId) => String(marketId))
      : undefined;

    return {
      wallet: walletAddress,
      ...(market ? { marketId: market.id, marketTitle: market.title } : {}),
      cancelled,
      marketIdsAffected,
      response,
      dryRun: false
    };
  }

  async obOrdersCancelBatch(input: ObOrderCancelBatchInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = ensureOrderbookRuntime(this.runtimeForApi(overrides));
    const apiClient = this.createApiClient(overrides);
    const walletAddress = await this.resolveWalletAddress(runtime);
    const orderHashes = normalizeOrderHashes(input.orderHashes);
    const existingOrders = await Promise.all(orderHashes.map((orderHash) => apiClient.getOrder(orderHash)));

    for (const record of existingOrders) {
      assertOrderOwnedByWallet(record, walletAddress);
      if (record.networkId !== undefined && record.networkId !== runtime.chainId) {
        throw new Error(
          `Order ${record.orderHash} uses network ${record.networkId}, runtime is configured for ${runtime.chainId}. ` +
            "Use --chain-id and matching deployment addresses."
        );
      }
    }

    const cancelBatchRequest = buildClobCancelBatchRequest(existingOrders, runtime.chainId);

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        orderHashes,
        totalOrders: existingOrders.length,
        cancelBatchRequest,
        dryRun: true
      };
    }

    const response = await apiClient.cancelOrdersBatch(cancelBatchRequest);
    const cancelledOrderHashes = Array.isArray(response.cancelled) ? response.cancelled.map((orderHash) => String(orderHash)) : [];
    const errors = Array.isArray(response.errors) ? response.errors : [];

    return {
      wallet: walletAddress,
      orderHashes,
      cancelled: cancelledOrderHashes.length,
      failed: errors.length,
      cancelledOrderHashes,
      errors,
      response,
      dryRun: false
    };
  }

  async obPositionsSplit(input: ObPositionActionInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = ensureOrderbookRuntime(this.runtimeForApi(overrides));
    const apiClient = this.createApiClient(overrides);
    const marketReference = resolveMarketReference(input, runtime.chainId);
    const market = await resolveOrderbookMarket(apiClient, marketReference, runtime);
    const collateralDecimals = getMarketCollateralDecimals(market);
    const amountRaw = parseTokenUnits(input.amount, collateralDecimals, "amount");
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const walletAddress = new Wallet(privateKey).address;
    const approvalPreview = {
      type: "erc20_allowance",
      tokenAddress: market.token?.address ?? runtime.collateralTokenAddress,
      spenderAddress: runtime.obConditionalTokens,
      requiredAmountRaw: amountRaw,
      requiredAmount: formatRawUnits(BigInt(amountRaw), collateralDecimals),
      allowancePreference: this.resolveEffectiveAllowancePreference(input.allowance)
    };

    const call = await apiClient.splitPosition({
      market_id: market.id,
      amount: amountRaw,
      network_id: runtime.chainId
    });

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        marketId: market.id,
        marketTitle: market.title,
        amountRaw,
        approval: approvalPreview,
        call
      };
    }

    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });

    const approval =
      input.skipApproval === true
        ? { approved: true, skipped: true }
        : await executionService.ensureErc20Allowance({
            tokenAddress: approvalPreview.tokenAddress,
            spenderAddress: runtime.obConditionalTokens,
            requiredAmount: approvalPreview.requiredAmount,
            allowancePreference: approvalPreview.allowancePreference
          });

    const execution = await this.executePositionCalldata(runtime, privateKey, call);

    return {
      wallet: walletAddress,
      marketId: market.id,
      marketTitle: market.title,
      amountRaw,
      approval,
      call,
      execution
    };
  }

  async obPositionsMerge(input: ObPositionActionInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = ensureOrderbookRuntime(this.runtimeForApi(overrides));
    const apiClient = this.createApiClient(overrides);
    const marketReference = resolveMarketReference(input, runtime.chainId);
    const market = await resolveOrderbookMarket(apiClient, marketReference, runtime);
    const collateralDecimals = getMarketCollateralDecimals(market);
    const amountRaw = parseTokenUnits(input.amount, collateralDecimals, "amount");
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const walletAddress = new Wallet(privateKey).address;
    const call = await apiClient.mergePosition({
      market_id: market.id,
      amount: amountRaw,
      network_id: runtime.chainId
    });

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        marketId: market.id,
        marketTitle: market.title,
        amountRaw,
        call
      };
    }

    const execution = await this.executePositionCalldata(runtime, privateKey, call);
    return {
      wallet: walletAddress,
      marketId: market.id,
      marketTitle: market.title,
      amountRaw,
      call,
      execution
    };
  }

  async obPositionsRedeem(input: ObPositionRedeemInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = ensureOrderbookRuntime(this.runtimeForApi(overrides));
    const apiClient = this.createApiClient(overrides);
    const marketReference = resolveMarketReference(input, runtime.chainId);
    const market = await resolveOrderbookMarket(apiClient, marketReference, runtime);
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const walletAddress = new Wallet(privateKey).address;
    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });
    const resolvedOutcome = await executionService.getResolvedOutcome(runtime.obManager, market.id);

    if (resolvedOutcome === -2) {
      throw new Error(`Market ${market.id} is unresolved and cannot be redeemed yet.`);
    }

    const redeemPath = resolvedOutcome === -1 ? "redeem-voided" : "redeem";
    const call =
      redeemPath === "redeem-voided"
        ? await apiClient.redeemVoidedPosition({
            market_id: market.id,
            network_id: runtime.chainId
          })
        : await apiClient.redeemPosition({
            market_id: market.id,
            network_id: runtime.chainId
          });

    if (input.dryRun) {
      return {
        wallet: walletAddress,
        marketId: market.id,
        marketTitle: market.title,
        resolvedOutcome,
        redeemPath,
        call
      };
    }

    const execution = await this.executePositionCalldata(runtime, privateKey, call);

    return {
      wallet: walletAddress,
      marketId: market.id,
      marketTitle: market.title,
      resolvedOutcome,
      redeemPath,
      call,
      execution
    };
  }

  async swapStable(input: StableSwapInput): Promise<unknown> {
    const runtime = assertPancakeSwapConfig(this.runtime);
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    if (runtime.chainId !== 56) {
      throw new Error("Stable swap command is currently implemented for BNB Chain only (chain id 56).");
    }

    const from = String(input.from).trim().toLowerCase();
    const to = String(input.to).trim().toLowerCase();
    if (from === to) {
      throw new Error("--from and --to must be different.");
    }

    const tokenBySymbol: Record<string, string> = {
      usdt: runtime.usdtTokenAddress,
      usd1: runtime.usd1TokenAddress
    };

    const tokenIn = tokenBySymbol[from];
    const tokenOut = tokenBySymbol[to];
    if (!tokenIn || !tokenOut) {
      throw new Error("Invalid token symbols. Use --from usdt|usd1 and --to usdt|usd1.");
    }

    const slippage = parseMaybeNumber(input.slippage, "slippage") ?? 0.005;
    const allowancePreference = this.resolveEffectiveAllowancePreference(input.allowance);
    const swapService = new PancakeSwapV2Service({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      routerAddress: runtime.pancakeRouterV2Address
    });

    const quote = await swapService.quoteExactOutput({
      tokenIn,
      tokenOut,
      amountOut: String(input.amountOut),
      slippage
    });

    if (input.dryRun) {
      return {
        wallet: swapService.getWalletAddress(),
        quote
      };
    }

    return swapService.swapTokensForExactOutput({
      tokenIn,
      tokenOut,
      amountOut: String(input.amountOut),
      slippage,
      allowancePreference
    });
  }

  async tradeBuy(input: TradeBuyInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = assertAmmConfig(this.runtimeForApi(overrides));
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const apiClient = this.createApiClient(overrides);

    const marketReference = resolveMarketReference(input, runtime.chainId);
    const outcomeId = parseIntegerValue(input.outcomeId, "outcome-id");
    const slippage = parseMaybeNumber(input.slippage, "slippage") ?? 0.05;
    const swapSlippage = parseMaybeNumber(input.swapSlippage, "swap-slippage") ?? 0.005;
    const tradeAllowancePreference = this.resolveEffectiveAllowancePreference(input.allowance);
    const swapAllowancePreference = this.resolveEffectiveAllowancePreference(input.swapAllowance);
    const value = parseNumberValue(input.value, "value");

    const quote = await apiClient.quote({
      ...marketReference,
      outcome_id: outcomeId,
      action: "buy",
      value,
      slippage
    });

    if (input.dryRun) {
      return { quote };
    }

    const market = await resolveMarket(apiClient, marketReference);
    ensureNetworkMatch(market, runtime);
    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });
    const walletAddress = executionService.getAddress();

    let autoSwapResult: unknown;
    const spendTokenAddress = market.token?.address ?? runtime.collateralTokenAddress;
    const stablePair = resolveStableSwapPair(runtime, spendTokenAddress);
    if (stablePair) {
      const swapRuntime = assertPancakeSwapConfig(runtime);
      const swapService = new PancakeSwapV2Service({
        rpcUrl: swapRuntime.rpcUrl,
        privateKey,
        routerAddress: swapRuntime.pancakeRouterV2Address
      });

      const [spendBalance, sourceBalance, requiredSpendAmount] = await Promise.all([
        swapService.getWalletTokenBalance(stablePair.spendToken),
        swapService.getWalletTokenBalance(stablePair.sourceToken),
        swapService.parseTokenAmount(stablePair.spendToken, String(input.value))
      ]);

      if (BigInt(spendBalance.raw) < BigInt(requiredSpendAmount.raw)) {
        const deficitRaw = (BigInt(requiredSpendAmount.raw) - BigInt(spendBalance.raw)).toString();
        const deficit = await swapService.formatTokenAmount(stablePair.spendToken, deficitRaw);

        if (input.autoSwap === false) {
          throw new Error(
            `Insufficient ${stablePair.spendSymbol} balance (${spendBalance.formatted}). ` +
              `Need ${quote.value.toString()} ${stablePair.spendSymbol}. Auto-swap is disabled.`
          );
        }

        const swapQuote = await swapService.quoteExactOutput({
          tokenIn: stablePair.sourceToken,
          tokenOut: stablePair.spendToken,
          amountOut: deficit,
          slippage: swapSlippage
        });

        if (BigInt(sourceBalance.raw) < BigInt(swapQuote.amountInMaxRaw)) {
          throw new Error(
            `Insufficient ${stablePair.sourceSymbol} to auto-swap. ` +
              `Need up to ${swapQuote.amountInMax} ${stablePair.sourceSymbol}, available ${sourceBalance.formatted}.`
          );
        }

        autoSwapResult = await swapService.swapTokensForExactOutput({
          tokenIn: stablePair.sourceToken,
          tokenOut: stablePair.spendToken,
          amountOut: deficit,
          slippage: swapSlippage,
          allowancePreference: swapAllowancePreference
        });
      } else {
        autoSwapResult = {
          executed: false,
          reason: `Sufficient ${stablePair.spendSymbol} balance`,
          balances: {
            spend: spendBalance,
            source: sourceBalance
          }
        };
      }
    }

    const allowance =
      input.skipApproval === true
        ? { approved: true }
        : await executionService.ensureErc20Allowance({
            tokenAddress: spendTokenAddress,
            requiredAmount: quote.value.toString(),
            spenderAddress: runtime.predictionMarketAddress,
            allowancePreference: tradeAllowancePreference
          });

    if (typeof quote.calldata !== "string") {
      throw new Error("Invalid quote payload: expected calldata string.");
    }

    const execution = await executionService.sendContractCalldata({
      to: runtime.predictionMarketAddress,
      calldata: quote.calldata
    });

    return {
      wallet: walletAddress,
      executionMode: "api",
      marketId: market.id,
      outcomeId,
      quote,
      autoSwap: autoSwapResult,
      allowance,
      execution
    };
  }

  async tradeSell(input: TradeSellInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    if ((input.value !== undefined && input.shares !== undefined) || (input.value === undefined && input.shares === undefined)) {
      throw new Error("Provide exactly one of --value or --shares for sell.");
    }

    const runtime = assertAmmConfig(this.runtimeForApi(overrides));
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const apiClient = this.createApiClient(overrides);

    const marketReference = resolveMarketReference(input, runtime.chainId);
    const outcomeId = parseIntegerValue(input.outcomeId, "outcome-id");
    const slippage = parseMaybeNumber(input.slippage, "slippage") ?? 0.05;

    const quote = await apiClient.quote({
      ...marketReference,
      outcome_id: outcomeId,
      action: "sell",
      value: parseMaybeNumber(input.value, "value"),
      shares: parseMaybeNumber(input.shares, "shares"),
      slippage
    });

    if (input.dryRun) {
      return { quote };
    }

    const market = await resolveMarket(apiClient, marketReference);
    ensureNetworkMatch(market, runtime);

    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });
    const walletAddress = executionService.getAddress();

    if (typeof quote.calldata !== "string") {
      throw new Error("Invalid quote payload: expected calldata string.");
    }

    const execution = await executionService.sendContractCalldata({
      to: runtime.predictionMarketAddress,
      calldata: quote.calldata
    });

    return {
      wallet: walletAddress,
      executionMode: "api",
      marketId: market.id,
      outcomeId,
      quote,
      execution
    };
  }

  private async executeClaimFromApi(
    input: ClaimInput,
    overrides?: ApiRequestOverrides,
    expectAction?: "claim_winnings" | "claim_voided"
  ): Promise<unknown> {
    const runtime = assertAmmConfig(this.runtimeForApi(overrides));
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const apiClient = this.createApiClient(overrides);

    const marketReference = resolveMarketReference(input, runtime.chainId);
    const claimQuote = await apiClient.claim({
      ...marketReference,
      outcome_id: parseMaybeInteger(input.outcomeId, "outcome-id")
    });

    if (expectAction && claimQuote.action !== expectAction) {
      throw new Error(
        `Claim action mismatch. Expected ${expectAction}, API returned ${claimQuote.action}. ` +
          "Use `claim winnings` for automatic mode."
      );
    }

    if (input.dryRun) {
      return { claimQuote };
    }

    const market = await resolveMarket(apiClient, marketReference);
    ensureNetworkMatch(market, runtime);

    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });
    const walletAddress = executionService.getAddress();

    if (typeof claimQuote.calldata !== "string") {
      throw new Error("Invalid claim payload: expected calldata string.");
    }

    const execution = await executionService.sendContractCalldata({
      to: runtime.predictionMarketAddress,
      calldata: claimQuote.calldata
    });

    return {
      wallet: walletAddress,
      executionMode: "api",
      marketId: market.id,
      claimQuote,
      execution
    };
  }

  async claimWinnings(input: ClaimInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    return this.executeClaimFromApi(input, overrides);
  }

  async claimVoided(input: ClaimVoidedInput, overrides?: ApiRequestOverrides): Promise<unknown> {
    return this.executeClaimFromApi(input, overrides, "claim_voided");
  }

  async claimAll(input: ClaimAllInput = {}, overrides?: ApiRequestOverrides): Promise<unknown> {
    const runtime = assertAmmConfig(this.runtimeForApi(overrides));
    const privateKey = await this.resolveSignerPrivateKey(runtime);
    const apiClient = this.createApiClient(overrides);

    const walletToScan = await this.resolveWalletAddress(runtime, resolveClaimAllWalletAddress(input.wallet));
    const networkId = parseMaybeInteger(input.networkId, "network-id") ?? runtime.chainId;
    const pageSize = parseMaybeInteger(input.pageSize, "page-size") ?? 100;
    if (pageSize < 1 || pageSize > 100) {
      throw new Error("page-size must be between 1 and 100.");
    }

    const executionService = new EvmExecutionService({
      rpcUrl: runtime.rpcUrl,
      privateKey,
      chainId: runtime.chainId
    });
    const signerWallet = executionService.getAddress();
    if (signerWallet.toLowerCase() !== walletToScan.toLowerCase()) {
      throw new Error(
        `Signer wallet (${signerWallet}) does not match wallet to scan (${walletToScan}). ` +
          "Use matching configured signer wallet and --wallet."
      );
    }

    if (networkId !== runtime.chainId) {
      throw new Error(
        `Network mismatch for claim execution: scan network ${networkId}, runtime chain ${runtime.chainId}. ` +
          "Use matching --network-id and --chain-id."
      );
    }

    const targets = await listAllClaimTargets({
      apiClient,
      walletAddress: walletToScan,
      networkId,
      pageSize
    });

    const results: Array<Record<string, unknown>> = [];
    let claimed = 0;
    let failed = 0;

    for (const target of targets) {
      try {
        const claimQuote = await apiClient.claim({
          market_id: target.marketId,
          network_id: target.networkId,
          outcome_id: target.actionExpected === "claim_voided" ? target.outcomeId : undefined
        });

        if (input.dryRun) {
          results.push({
            marketId: target.marketId,
            networkId: target.networkId,
            actionExpected: target.actionExpected,
            actionReturned: claimQuote.action,
            outcomeId: claimQuote.outcome_id,
            calldata: claimQuote.calldata
          });
          continue;
        }

        if (typeof claimQuote.calldata !== "string") {
          throw new Error("Invalid claim payload: expected calldata string.");
        }

        const execution = await executionService.sendContractCalldata({
          to: runtime.predictionMarketAddress,
          calldata: claimQuote.calldata
        });

        claimed += 1;
        results.push({
          marketId: target.marketId,
          networkId: target.networkId,
          actionExpected: target.actionExpected,
          actionReturned: claimQuote.action,
          outcomeId: claimQuote.outcome_id,
          execution
        });
      } catch (error) {
        failed += 1;
        results.push({
          marketId: target.marketId,
          networkId: target.networkId,
          actionExpected: target.actionExpected,
          outcomeId: target.outcomeId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      wallet: walletToScan,
      signerWallet,
      executionMode: "api",
      networkId,
      dryRun: input.dryRun === true,
      totalClaimable: targets.length,
      claimed,
      failed,
      results
    };
  }
}
