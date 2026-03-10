import { BigNumber, Contract, Wallet, providers, utils } from "ethers";
import { AllowancePreference } from "./allowance.js";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const PANCAKESWAP_V2_ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function getAmountsIn(uint256 amountOut, address[] calldata path) view returns (uint256[] memory amounts)",
  "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)"
];

const SLIPPAGE_SCALE = 1_000_000;

type TokenMeta = {
  decimals: number;
  symbol: string;
};

export type TokenBalance = {
  address: string;
  symbol: string;
  decimals: number;
  raw: string;
  formatted: string;
};

export type PancakeSwapExactOutputQuote = {
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  amountOut: string;
  amountOutRaw: string;
  amountInQuoted: string;
  amountInQuotedRaw: string;
  amountInMax: string;
  amountInMaxRaw: string;
  slippage: number;
  path: string[];
};

export type PancakeSwapExecution = {
  wallet: string;
  quote: PancakeSwapExactOutputQuote;
  approval: {
    required: boolean;
    currentAllowanceRaw: string;
    requiredAllowanceRaw: string;
    approvalAllowanceRaw: string;
    approvalTxHash?: string;
    resetAllowanceTxHash?: string;
  };
  txHash: string;
  blockNumber?: number;
};

function normalizeAddress(address: string): string {
  return utils.getAddress(address);
}

function isSameAddress(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

function toSlippagePpm(slippage: number): number {
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 1) {
    throw new Error(`Invalid slippage value: ${slippage}. Expected a decimal between 0 and 1.`);
  }
  return Math.ceil(slippage * SLIPPAGE_SCALE);
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeError = error as {
      reason?: unknown;
      error?: { message?: unknown; reason?: unknown } | unknown;
      data?: { message?: unknown } | unknown;
      message?: unknown;
    };

    if (typeof maybeError.reason === "string" && maybeError.reason.length > 0) {
      return maybeError.reason;
    }

    if (
      maybeError.error &&
      typeof maybeError.error === "object" &&
      "message" in maybeError.error &&
      typeof (maybeError.error as { message?: unknown }).message === "string"
    ) {
      return (maybeError.error as { message: string }).message;
    }

    if (
      maybeError.data &&
      typeof maybeError.data === "object" &&
      "message" in maybeError.data &&
      typeof (maybeError.data as { message?: unknown }).message === "string"
    ) {
      return (maybeError.data as { message: string }).message;
    }

    if (typeof maybeError.message === "string" && maybeError.message.length > 0) {
      return maybeError.message;
    }
  }

  return String(error);
}

export class PancakeSwapV2Service {
  private readonly provider: providers.JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly router: Contract;
  private readonly tokenContracts = new Map<string, Contract>();
  private readonly tokenMeta = new Map<string, TokenMeta>();
  private wbnbAddress?: string;

  constructor(params: { rpcUrl: string; privateKey: string; routerAddress: string }) {
    this.provider = new providers.JsonRpcProvider(params.rpcUrl);
    this.wallet = new Wallet(params.privateKey, this.provider);
    this.router = new Contract(normalizeAddress(params.routerAddress), PANCAKESWAP_V2_ROUTER_ABI, this.wallet);
  }

  getWalletAddress(): string {
    return this.wallet.address;
  }

  private async nativeSymbol(): Promise<string> {
    const network = await this.provider.getNetwork();
    return network.chainId === 56 ? "BNB" : "NATIVE";
  }

  private getTokenContract(tokenAddress: string): Contract {
    const normalized = normalizeAddress(tokenAddress);
    const existing = this.tokenContracts.get(normalized);
    if (existing) {
      return existing;
    }
    const contract = new Contract(normalized, ERC20_ABI, this.wallet);
    this.tokenContracts.set(normalized, contract);
    return contract;
  }

  private async getTokenMeta(tokenAddress: string): Promise<TokenMeta> {
    const normalized = normalizeAddress(tokenAddress);
    const cached = this.tokenMeta.get(normalized);
    if (cached) {
      return cached;
    }

    const tokenContract = this.getTokenContract(normalized);
    const [decimalsRaw, symbolRaw] = await Promise.all([tokenContract.decimals(), tokenContract.symbol()]);
    const meta: TokenMeta = {
      decimals: Number(decimalsRaw),
      symbol: String(symbolRaw)
    };

    this.tokenMeta.set(normalized, meta);
    return meta;
  }

  async getWalletTokenBalance(tokenAddress: string): Promise<TokenBalance> {
    const normalized = normalizeAddress(tokenAddress);
    const tokenContract = this.getTokenContract(normalized);
    const meta = await this.getTokenMeta(normalized);
    const rawBalance = (await tokenContract.balanceOf(this.wallet.address)) as BigNumber;

    return {
      address: normalized,
      symbol: meta.symbol,
      decimals: meta.decimals,
      raw: rawBalance.toString(),
      formatted: utils.formatUnits(rawBalance, meta.decimals)
    };
  }

  async parseTokenAmount(tokenAddress: string, amount: string): Promise<{ raw: string; symbol: string; decimals: number }> {
    const normalized = normalizeAddress(tokenAddress);
    const meta = await this.getTokenMeta(normalized);
    const rawAmount = utils.parseUnits(amount, meta.decimals);

    return {
      raw: rawAmount.toString(),
      symbol: meta.symbol,
      decimals: meta.decimals
    };
  }

  async formatTokenAmount(tokenAddress: string, amountRaw: string | BigNumber): Promise<string> {
    const normalized = normalizeAddress(tokenAddress);
    const meta = await this.getTokenMeta(normalized);
    return utils.formatUnits(BigNumber.from(amountRaw), meta.decimals);
  }

  private async getWbnbAddress(): Promise<string> {
    if (!this.wbnbAddress) {
      this.wbnbAddress = normalizeAddress(await this.router.WETH());
    }
    return this.wbnbAddress;
  }

  private async getBestPathForExactOutput(params: {
    tokenIn: string;
    tokenOut: string;
    amountOutRaw: BigNumber;
  }): Promise<{ path: string[]; amountInQuotedRaw: BigNumber }> {
    const tokenIn = normalizeAddress(params.tokenIn);
    const tokenOut = normalizeAddress(params.tokenOut);
    const wbnb = await this.getWbnbAddress();

    const candidates: string[][] = [[tokenIn, tokenOut]];
    if (!isSameAddress(tokenIn, wbnb) && !isSameAddress(tokenOut, wbnb)) {
      candidates.push([tokenIn, wbnb, tokenOut]);
    }

    let best: { path: string[]; amountInQuotedRaw: BigNumber } | undefined;
    const errors: string[] = [];

    for (const path of candidates) {
      try {
        const amounts = (await this.router.getAmountsIn(params.amountOutRaw, path)) as BigNumber[];
        const amountIn = amounts[0];
        if (!best || amountIn.lt(best.amountInQuotedRaw)) {
          best = { path, amountInQuotedRaw: amountIn };
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!best) {
      throw new Error(`Unable to quote PancakeSwap route for exact output. ${errors.join(" | ")}`);
    }

    return best;
  }

  async quoteExactOutput(params: {
    tokenIn: string;
    tokenOut: string;
    amountOut: string;
    slippage: number;
  }): Promise<PancakeSwapExactOutputQuote> {
    const tokenIn = normalizeAddress(params.tokenIn);
    const tokenOut = normalizeAddress(params.tokenOut);

    if (isSameAddress(tokenIn, tokenOut)) {
      throw new Error("tokenIn and tokenOut must be different for a swap.");
    }

    const [metaIn, metaOut] = await Promise.all([this.getTokenMeta(tokenIn), this.getTokenMeta(tokenOut)]);
    const amountOutRaw = utils.parseUnits(params.amountOut, metaOut.decimals);
    const route = await this.getBestPathForExactOutput({
      tokenIn,
      tokenOut,
      amountOutRaw
    });

    const slippagePpm = toSlippagePpm(params.slippage);
    const amountInMaxRaw = route.amountInQuotedRaw.mul(SLIPPAGE_SCALE + slippagePpm).div(SLIPPAGE_SCALE);

    return {
      tokenIn,
      tokenOut,
      tokenInSymbol: metaIn.symbol,
      tokenOutSymbol: metaOut.symbol,
      tokenInDecimals: metaIn.decimals,
      tokenOutDecimals: metaOut.decimals,
      amountOut: utils.formatUnits(amountOutRaw, metaOut.decimals),
      amountOutRaw: amountOutRaw.toString(),
      amountInQuoted: utils.formatUnits(route.amountInQuotedRaw, metaIn.decimals),
      amountInQuotedRaw: route.amountInQuotedRaw.toString(),
      amountInMax: utils.formatUnits(amountInMaxRaw, metaIn.decimals),
      amountInMaxRaw: amountInMaxRaw.toString(),
      slippage: params.slippage,
      path: route.path
    };
  }

  private async ensureAllowance(tokenAddress: string, requiredRaw: BigNumber, approvalRaw: BigNumber): Promise<{
    required: boolean;
    currentAllowanceRaw: string;
    requiredAllowanceRaw: string;
    approvalAllowanceRaw: string;
    approvalTxHash?: string;
    resetAllowanceTxHash?: string;
  }> {
    const token = this.getTokenContract(tokenAddress);
    const tokenMeta = await this.getTokenMeta(tokenAddress);

    if (approvalRaw.lt(requiredRaw)) {
      const [requiredFormatted, approvalFormatted] = await Promise.all([
        this.formatTokenAmount(tokenAddress, requiredRaw),
        this.formatTokenAmount(tokenAddress, approvalRaw)
      ]);
      throw new Error(
        `Allowance override is too low for ${tokenMeta.symbol}. ` +
          `Required for action: ${requiredFormatted}, allowance override: ${approvalFormatted}.`
      );
    }

    const currentAllowance = (await token.allowance(this.wallet.address, this.router.address)) as BigNumber;

    if (currentAllowance.gte(requiredRaw)) {
      return {
        required: false,
        currentAllowanceRaw: currentAllowance.toString(),
        requiredAllowanceRaw: requiredRaw.toString(),
        approvalAllowanceRaw: approvalRaw.toString()
      };
    }

    const sendApprove = async (amount: BigNumber): Promise<string> => {
      try {
        const estimatedGas = (await token.estimateGas.approve(this.router.address, amount)) as BigNumber;
        const tx = await token.approve(this.router.address, amount, {
          gasLimit: estimatedGas.mul(12).div(10)
        });
        const receipt = await tx.wait();
        if (receipt?.status === 0) {
          throw new Error("Approval transaction reverted.");
        }
        return tx.hash;
      } catch (error) {
        const reason = extractErrorMessage(error);
        const estimateFailed =
          reason.includes("UNPREDICTABLE_GAS_LIMIT") ||
          reason.includes("cannot estimate gas") ||
          reason.includes("gas required exceeds allowance");

        if (!estimateFailed) {
          throw error;
        }

        const tx = await token.approve(this.router.address, amount, {
          gasLimit: 120_000
        });
        const receipt = await tx.wait();
        if (receipt?.status === 0) {
          throw new Error("Approval transaction reverted after sending with manual gas limit.");
        }
        return tx.hash;
      }
    };

    let firstApproveError: unknown;
    try {
      const approvalTxHash = await sendApprove(approvalRaw);
      return {
        required: true,
        currentAllowanceRaw: currentAllowance.toString(),
        requiredAllowanceRaw: requiredRaw.toString(),
        approvalAllowanceRaw: approvalRaw.toString(),
        approvalTxHash
      };
    } catch (error) {
      firstApproveError = error;
    }

    const firstReason = extractErrorMessage(firstApproveError);
    if (firstReason.toLowerCase().includes("insufficient funds")) {
      const [nativeBalanceRaw, nativeSymbol] = await Promise.all([this.provider.getBalance(this.wallet.address), this.nativeSymbol()]);
      throw new Error(
        `Insufficient ${nativeSymbol} for ${tokenMeta.symbol} approval transaction. ` +
          `Wallet balance: ${utils.formatEther(nativeBalanceRaw)} ${nativeSymbol}. ` +
          `RPC reason: ${firstReason}.`
      );
    }

    if (currentAllowance.isZero()) {
      throw new Error(
        `Failed to approve ${tokenMeta.symbol} allowance for PancakeSwap router with zero existing allowance. ` +
          `Reason: ${firstReason}`
      );
    }

    try {
      // USDT-style tokens can require resetting allowance to 0 before increasing it.
      const resetAllowanceTxHash = await sendApprove(BigNumber.from(0));
      const approvalTxHash = await sendApprove(approvalRaw);
      return {
        required: true,
        currentAllowanceRaw: currentAllowance.toString(),
        requiredAllowanceRaw: requiredRaw.toString(),
        approvalAllowanceRaw: approvalRaw.toString(),
        resetAllowanceTxHash,
        approvalTxHash
      };
    } catch (resetFlowError) {
      throw new Error(
        `Failed to approve ${tokenMeta.symbol} allowance for PancakeSwap router. ` +
          `Initial approve reason: ${firstReason}. ` +
          `Reset-then-approve reason: ${extractErrorMessage(resetFlowError)}.`
      );
    }
  }

  async swapTokensForExactOutput(params: {
    tokenIn: string;
    tokenOut: string;
    amountOut: string;
    slippage: number;
    deadlineSeconds?: number;
    allowancePreference?: AllowancePreference;
  }): Promise<PancakeSwapExecution> {
    const quote = await this.quoteExactOutput({
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountOut: params.amountOut,
      slippage: params.slippage
    });

    const amountInMaxRaw = BigNumber.from(quote.amountInMaxRaw);
    const amountInQuotedRaw = BigNumber.from(quote.amountInQuotedRaw);
    const tokenIn = this.getTokenContract(quote.tokenIn);
    const tokenInBalanceRaw = (await tokenIn.balanceOf(this.wallet.address)) as BigNumber;
    if (tokenInBalanceRaw.lt(amountInQuotedRaw)) {
      const [available, quotedNeeded, maxNeeded] = await Promise.all([
        this.formatTokenAmount(quote.tokenIn, tokenInBalanceRaw),
        this.formatTokenAmount(quote.tokenIn, amountInQuotedRaw),
        this.formatTokenAmount(quote.tokenIn, amountInMaxRaw)
      ]);

      throw new Error(
        `Insufficient ${quote.tokenInSymbol} balance for swap. ` +
          `Available: ${available}, quoted needed: ${quotedNeeded}, max (with slippage): ${maxNeeded}.`
      );
    }

    const allowancePreference = params.allowancePreference ?? { kind: "required" };
    const approvalRaw =
      allowancePreference.kind === "unlimited"
        ? BigNumber.from("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
        : allowancePreference.kind === "custom"
          ? BigNumber.from((await this.parseTokenAmount(quote.tokenIn, allowancePreference.amount)).raw)
          : amountInMaxRaw;

    const approval = await this.ensureAllowance(quote.tokenIn, amountInMaxRaw, approvalRaw);

    const deadline = Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 600);

    let estimatedGas: BigNumber;
    try {
      estimatedGas = await this.router.estimateGas.swapTokensForExactTokens(
        BigNumber.from(quote.amountOutRaw),
        amountInMaxRaw,
        quote.path,
        this.wallet.address,
        deadline
      );
    } catch (error) {
      const [available, quotedNeeded, maxNeeded] = await Promise.all([
        this.formatTokenAmount(quote.tokenIn, tokenInBalanceRaw),
        this.formatTokenAmount(quote.tokenIn, amountInQuotedRaw),
        this.formatTokenAmount(quote.tokenIn, amountInMaxRaw)
      ]);
      const rawReason = extractErrorMessage(error);

      throw new Error(
        `Swap preflight failed on gas estimation. ` +
          `Route: ${quote.path.join(" -> ")}. ` +
          `Amount out: ${quote.amountOut} ${quote.tokenOutSymbol}. ` +
          `Quoted input: ${quotedNeeded} ${quote.tokenInSymbol}. ` +
          `Max input: ${maxNeeded} ${quote.tokenInSymbol}. ` +
          `Wallet balance: ${available} ${quote.tokenInSymbol}. ` +
          `RPC reason: ${rawReason}. ` +
          `Try increasing --slippage, reducing --amount-out, or ensuring deeper liquidity on this pair.`
      );
    }

    const swapTx = await this.router.swapTokensForExactTokens(
      BigNumber.from(quote.amountOutRaw),
      amountInMaxRaw,
      quote.path,
      this.wallet.address,
      deadline,
      {
        gasLimit: estimatedGas.mul(12).div(10)
      }
    );
    const receipt = await swapTx.wait();

    return {
      wallet: this.wallet.address,
      quote,
      approval,
      txHash: swapTx.hash,
      blockNumber: receipt?.blockNumber
    };
  }
}
