import { BigNumber, constants, Contract, providers, utils, Wallet } from "ethers";
import { AllowancePreference } from "./allowance.js";

const ERC20_ALLOWANCE_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const ERC1155_APPROVAL_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)"
];

const ORDERBOOK_MANAGER_ABI = ["function getMarketResolvedOutcome(uint256 marketId) view returns (int8)"];

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

export class EvmExecutionService {
  private readonly provider: providers.JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly expectedChainId: number;

  constructor(params: { rpcUrl: string; privateKey: string; chainId: number }) {
    this.provider = new providers.JsonRpcProvider(params.rpcUrl);
    this.wallet = new Wallet(params.privateKey, this.provider);
    this.expectedChainId = params.chainId;
  }

  getAddress(): string {
    return this.wallet.address;
  }

  private async getNativeSymbol(): Promise<string> {
    const network = await this.provider.getNetwork();
    if (network.chainId === 56 || network.chainId === 97) {
      return "BNB";
    }
    return "NATIVE";
  }

  async assertChain(): Promise<void> {
    const network = await this.provider.getNetwork();
    if (network.chainId !== this.expectedChainId) {
      throw new Error(
        `RPC chain mismatch: provider is on chain ${network.chainId}, expected ${this.expectedChainId}. ` +
          "Check --rpc-url or --chain-id."
      );
    }
  }

  private async sendApprove(token: Contract, spenderAddress: string, amountRaw: BigNumber): Promise<string> {
    try {
      const estimatedGas = (await token.estimateGas.approve(spenderAddress, amountRaw)) as BigNumber;
      const tx = await token.approve(spenderAddress, amountRaw, {
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

      const tx = await token.approve(spenderAddress, amountRaw, {
        gasLimit: 120_000
      });
      const receipt = await tx.wait();
      if (receipt?.status === 0) {
        throw new Error("Approval transaction reverted after sending with manual gas limit.");
      }
      return tx.hash;
    }
  }

  private async sendApprovalForAll(token: Contract, operatorAddress: string): Promise<string> {
    try {
      const estimatedGas = (await token.estimateGas.setApprovalForAll(operatorAddress, true)) as BigNumber;
      const tx = await token.setApprovalForAll(operatorAddress, true, {
        gasLimit: estimatedGas.mul(12).div(10)
      });
      const receipt = await tx.wait();
      if (receipt?.status === 0) {
        throw new Error("setApprovalForAll transaction reverted.");
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

      const tx = await token.setApprovalForAll(operatorAddress, true, {
        gasLimit: 140_000
      });
      const receipt = await tx.wait();
      if (receipt?.status === 0) {
        throw new Error("setApprovalForAll reverted after sending with manual gas limit.");
      }
      return tx.hash;
    }
  }

  async getTokenDecimals(tokenAddress: string, fallback = 18): Promise<number> {
    try {
      const token = new Contract(utils.getAddress(tokenAddress), ERC20_ALLOWANCE_ABI, this.provider);
      const decimalsRaw = await token.decimals();
      return Number(decimalsRaw);
    } catch {
      return fallback;
    }
  }

  async ensureErc20Allowance(params: {
    tokenAddress: string;
    spenderAddress: string;
    requiredAmount: string;
    allowancePreference?: AllowancePreference;
  }): Promise<{
    approved: boolean;
    symbol: string;
    requiredAllowanceRaw: string;
    approvalAllowanceRaw: string;
    currentAllowanceRaw: string;
    approvalTxHash?: string;
    resetAllowanceTxHash?: string;
  }> {
    await this.assertChain();

    const token = new Contract(utils.getAddress(params.tokenAddress), ERC20_ALLOWANCE_ABI, this.wallet);
    const [decimalsRaw, symbolRaw, currentAllowanceRawBn] = await Promise.all([
      token.decimals(),
      token.symbol(),
      token.allowance(this.wallet.address, utils.getAddress(params.spenderAddress))
    ]);

    const decimals = Number(decimalsRaw);
    const symbol = String(symbolRaw);
    const requiredRaw = utils.parseUnits(params.requiredAmount, decimals);
    const preference = params.allowancePreference ?? { kind: "required" };
    const approvalRaw =
      preference.kind === "unlimited"
        ? constants.MaxUint256
        : preference.kind === "custom"
          ? utils.parseUnits(preference.amount, decimals)
          : requiredRaw;

    if (approvalRaw.lt(requiredRaw)) {
      throw new Error(
        `Allowance override is too low for ${symbol}. ` +
          `Required for action: ${params.requiredAmount}, allowance override: ${
            preference.kind === "custom" ? preference.amount : "0"
          }.`
      );
    }

    const currentAllowance = currentAllowanceRawBn as BigNumber;
    if (currentAllowance.gte(requiredRaw)) {
      return {
        approved: true,
        symbol,
        requiredAllowanceRaw: requiredRaw.toString(),
        approvalAllowanceRaw: approvalRaw.toString(),
        currentAllowanceRaw: currentAllowance.toString()
      };
    }

    let firstApproveError: unknown;
    try {
      const approvalTxHash = await this.sendApprove(token, utils.getAddress(params.spenderAddress), approvalRaw);
      return {
        approved: false,
        symbol,
        requiredAllowanceRaw: requiredRaw.toString(),
        approvalAllowanceRaw: approvalRaw.toString(),
        currentAllowanceRaw: currentAllowance.toString(),
        approvalTxHash
      };
    } catch (error) {
      firstApproveError = error;
    }

    const firstReason = extractErrorMessage(firstApproveError);
    if (firstReason.toLowerCase().includes("insufficient funds")) {
      const [nativeBalanceRaw, nativeSymbol] = await Promise.all([this.provider.getBalance(this.wallet.address), this.getNativeSymbol()]);
      throw new Error(
        `Insufficient ${nativeSymbol} for ERC20 approval transaction. ` +
          `Wallet balance: ${utils.formatEther(nativeBalanceRaw)} ${nativeSymbol}. ` +
          `RPC reason: ${firstReason}.`
      );
    }

    if (currentAllowance.isZero()) {
      throw new Error(`Failed to approve ${symbol} allowance. Reason: ${firstReason}`);
    }

    try {
      const resetAllowanceTxHash = await this.sendApprove(token, utils.getAddress(params.spenderAddress), BigNumber.from(0));
      const approvalTxHash = await this.sendApprove(token, utils.getAddress(params.spenderAddress), approvalRaw);
      return {
        approved: false,
        symbol,
        requiredAllowanceRaw: requiredRaw.toString(),
        approvalAllowanceRaw: approvalRaw.toString(),
        currentAllowanceRaw: currentAllowance.toString(),
        resetAllowanceTxHash,
        approvalTxHash
      };
    } catch (resetFlowError) {
      const resetReason = extractErrorMessage(resetFlowError);
      throw new Error(
        `Failed to approve ${symbol} allowance. ` +
          `Initial approve reason: ${firstReason}. ` +
          `Reset-then-approve reason: ${resetReason}.`
      );
    }
  }

  async ensureErc1155ApprovalForAll(params: {
    tokenAddress: string;
    operatorAddress: string;
  }): Promise<{
    approved: boolean;
    currentApproval: boolean;
    approvalTxHash?: string;
  }> {
    await this.assertChain();

    const token = new Contract(utils.getAddress(params.tokenAddress), ERC1155_APPROVAL_ABI, this.wallet);
    const currentApproval = Boolean(
      await token.isApprovedForAll(this.wallet.address, utils.getAddress(params.operatorAddress))
    );

    if (currentApproval) {
      return {
        approved: true,
        currentApproval
      };
    }

    try {
      const approvalTxHash = await this.sendApprovalForAll(token, utils.getAddress(params.operatorAddress));
      return {
        approved: false,
        currentApproval,
        approvalTxHash
      };
    } catch (error) {
      const reason = extractErrorMessage(error);
      if (reason.toLowerCase().includes("insufficient funds")) {
        const [nativeBalanceRaw, nativeSymbol] = await Promise.all([
          this.provider.getBalance(this.wallet.address),
          this.getNativeSymbol()
        ]);
        throw new Error(
          `Insufficient ${nativeSymbol} for ERC1155 approval transaction. ` +
            `Wallet balance: ${utils.formatEther(nativeBalanceRaw)} ${nativeSymbol}. ` +
            `RPC reason: ${reason}.`
        );
      }

      throw new Error(`Failed to approve ERC1155 operator. Reason: ${reason}`);
    }
  }

  async getResolvedOutcome(managerAddress: string, marketId: number): Promise<number> {
    await this.assertChain();
    const manager = new Contract(utils.getAddress(managerAddress), ORDERBOOK_MANAGER_ABI, this.provider);
    const result = await manager.getMarketResolvedOutcome(marketId);
    return Number(result);
  }

  async sendContractCalldata(params: {
    to: string;
    calldata: string;
    valueWei?: string;
  }): Promise<{
    txHash: string;
    blockNumber?: number;
    gasUsed?: string;
    effectiveGasPrice?: string;
    status?: number;
  }> {
    await this.assertChain();

    const request: providers.TransactionRequest = {
      to: utils.getAddress(params.to),
      data: params.calldata,
      value: params.valueWei ? BigNumber.from(params.valueWei) : undefined
    };

    let estimatedGas: BigNumber;
    try {
      estimatedGas = (await this.wallet.estimateGas(request)) as BigNumber;
    } catch (error) {
      const reason = extractErrorMessage(error);
      throw new Error(
        `Failed to estimate gas for transaction call. ` +
          `To: ${request.to}. ` +
          `RPC reason: ${reason}.`
      );
    }

    try {
      const tx = await this.wallet.sendTransaction({
        ...request,
        gasLimit: estimatedGas.mul(12).div(10)
      });
      const receipt = await tx.wait();

      return {
        txHash: tx.hash,
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed?.toString(),
        effectiveGasPrice: receipt?.effectiveGasPrice?.toString(),
        status: receipt?.status
      };
    } catch (error) {
      const reason = extractErrorMessage(error);
      if (reason.toLowerCase().includes("insufficient funds")) {
        const [nativeBalanceRaw, nativeSymbol] = await Promise.all([this.provider.getBalance(this.wallet.address), this.getNativeSymbol()]);
        throw new Error(
          `Insufficient ${nativeSymbol} for transaction gas. ` +
            `Wallet balance: ${utils.formatEther(nativeBalanceRaw)} ${nativeSymbol}. ` +
            `RPC reason: ${reason}.`
        );
      }
      throw new Error(`Failed to send transaction. Reason: ${reason}`);
    }
  }
}
