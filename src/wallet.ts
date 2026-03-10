import { Contract, providers, utils } from "ethers";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)"
];

export type NativeBalance = {
  symbol: string;
  raw: string;
  formatted: string;
};

export type TokenBalance = {
  label: string;
  address: string;
  symbol: string;
  decimals: number;
  raw: string;
  formatted: string;
};

function uniqueAddressesWithLabels(entries: Array<{ label: string; address: string }>): Array<{ label: string; address: string }> {
  const seen = new Set<string>();
  const output: Array<{ label: string; address: string }> = [];

  for (const entry of entries) {
    const normalized = entry.address.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(entry);
  }

  return output;
}

export class WalletBalanceService {
  private readonly provider: providers.JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new providers.JsonRpcProvider(rpcUrl);
  }

  async getNativeBalance(address: string, symbol: string): Promise<NativeBalance> {
    const raw = await this.provider.getBalance(address);
    return {
      symbol,
      raw: raw.toString(),
      formatted: utils.formatEther(raw)
    };
  }

  async getTokenBalances(address: string, tokenEntries: Array<{ label: string; address: string }>): Promise<TokenBalance[]> {
    const uniqueTokens = uniqueAddressesWithLabels(tokenEntries);

    return Promise.all(
      uniqueTokens.map(async (entry) => {
        const token = new Contract(utils.getAddress(entry.address), ERC20_ABI, this.provider);
        const [symbolRaw, decimalsRaw, balanceRaw] = await Promise.all([token.symbol(), token.decimals(), token.balanceOf(address)]);
        const decimals = Number(decimalsRaw);

        return {
          label: entry.label,
          address: utils.getAddress(entry.address),
          symbol: String(symbolRaw),
          decimals,
          raw: balanceRaw.toString(),
          formatted: utils.formatUnits(balanceRaw, decimals)
        };
      })
    );
  }
}
