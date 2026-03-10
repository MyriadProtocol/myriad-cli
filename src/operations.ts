import process from "node:process";
import { utils, Wallet } from "ethers";
import { AllowancePreference, resolveAllowancePreference } from "./allowance.js";
import { MyriadApiClient } from "./api.js";
import { NETWORKS, parseInteger, parseNumber, RuntimeConfig } from "./config.js";
import { EvmExecutionService } from "./executor.js";
import { PancakeSwapV2Service } from "./pancakeswap.js";
import { Market, MarketReference, PortfolioPosition } from "./types.js";
import { WalletBalanceService } from "./wallet.js";
import { loadConfiguredWalletPrivateKey, readConfiguredWalletAddress } from "./wallet-store.js";

export type ApiRequestOverrides = {
  apiBaseUrl?: string;
  apiKey?: string;
};

export type OperationContext = {
  runtime: RuntimeConfig;
  globalAllowance?: string;
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

export type PortfolioInput = {
  networkId?: string | number;
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

type ClaimTarget = {
  actionExpected: "claim_winnings" | "claim_voided";
  marketId: number;
  networkId: number;
  outcomeId?: number;
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

async function resolveMarket(apiClient: MyriadApiClient, marketReference: MarketReference): Promise<Market> {
  if ("market_id" in marketReference) {
    return apiClient.getMarketById(marketReference.market_id, marketReference.network_id);
  }
  return apiClient.getMarketBySlug(marketReference.market_slug);
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
  if (chainId === 56) {
    return "BNB";
  }
  return "NATIVE";
}

function getNetworkName(chainId: number): string {
  return NETWORKS[chainId]?.name ?? `Chain ${chainId}`;
}

function getCollateralSymbol(runtime: RuntimeConfig): string {
  if (runtime.usdtTokenAddress && isSameAddress(runtime.collateralTokenAddress, runtime.usdtTokenAddress)) {
    return "USDT";
  }
  if (runtime.usd1TokenAddress && isSameAddress(runtime.collateralTokenAddress, runtime.usd1TokenAddress)) {
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

  constructor(context: OperationContext) {
    this.runtime = context.runtime;
    this.globalAllowance = context.globalAllowance;
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

  async walletBalances(input: WalletBalancesInput = {}): Promise<unknown> {
    const address = await this.resolveWalletAddress(this.runtime, input.address);
    const service = new WalletBalanceService(this.runtime.rpcUrl);

    const native = await service.getNativeBalance(address, getNativeSymbol(this.runtime.chainId));

    const tokenEntries: Array<{ label: string; address: string }> = [
      { label: "collateral", address: this.runtime.collateralTokenAddress }
    ];

    if (this.runtime.chainId === 56) {
      if (this.runtime.usdtTokenAddress) {
        tokenEntries.push({ label: "usdt", address: this.runtime.usdtTokenAddress });
      }
      if (this.runtime.usd1TokenAddress) {
        tokenEntries.push({ label: "usd1", address: this.runtime.usd1TokenAddress });
      }
    }

    const tokens = await service.getTokenBalances(address, tokenEntries);

    return {
      wallet: address,
      chainId: this.runtime.chainId,
      native,
      tokens
    };
  }

  async walletDeposit(input: WalletDepositInput = {}): Promise<WalletDepositResult> {
    const address = await this.resolveWalletAddress(this.runtime, input.address);
    const nativeSymbol = getNativeSymbol(this.runtime.chainId);
    const collateralSymbol = getCollateralSymbol(this.runtime);
    const collateralAddress = utils.getAddress(this.runtime.collateralTokenAddress);

    return {
      wallet: address,
      chainId: this.runtime.chainId,
      network: getNetworkName(this.runtime.chainId),
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
    const runtime = this.runtimeForApi(overrides);
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

    const runtime = this.runtimeForApi(overrides);
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
    const runtime = this.runtimeForApi(overrides);
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
    const runtime = this.runtimeForApi(overrides);
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
