import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ApiRequestOverrides,
  ClaimAllInput,
  ClaimInput,
  ClaimVoidedInput,
  ListMarketsInput,
  MyriadOperations,
  OperationContext,
  PortfolioInput,
  StableSwapInput,
  TradeBuyInput,
  TradeSellInput,
  WalletBalancesInput
} from "./operations.js";

const INTEGER_LIKE_SCHEMA = z.union([z.number().int(), z.string().trim().min(1)]);
const NUMBER_LIKE_SCHEMA = z.union([z.number(), z.string().trim().min(1)]);

const API_OVERRIDE_SHAPE = {
  apiBaseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional()
} as const;

const LIST_MARKETS_SCHEMA = z
  .object({
    state: z.string().optional(),
    networkId: INTEGER_LIKE_SCHEMA.optional(),
    keyword: z.string().optional(),
    sort: z.string().optional(),
    order: z.string().optional(),
    page: INTEGER_LIKE_SCHEMA.optional(),
    limit: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const MARKETS_SHOW_SCHEMA = z
  .object({
    market: z.union([z.string().trim().min(1), z.number().int()]),
    networkId: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const USERS_PORTFOLIO_SCHEMA = z
  .object({
    address: z.string().trim().min(1),
    networkId: INTEGER_LIKE_SCHEMA.optional(),
    marketId: INTEGER_LIKE_SCHEMA.optional(),
    marketSlug: z.string().optional(),
    tokenAddress: z.string().optional(),
    page: INTEGER_LIKE_SCHEMA.optional(),
    limit: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const PORTFOLIO_SCHEMA = z
  .object({
    networkId: INTEGER_LIKE_SCHEMA.optional(),
    marketId: INTEGER_LIKE_SCHEMA.optional(),
    marketSlug: z.string().optional(),
    tokenAddress: z.string().optional(),
    page: INTEGER_LIKE_SCHEMA.optional(),
    limit: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const WALLET_BALANCES_SCHEMA = z
  .object({
    address: z.string().optional()
  })
  .strict();

const SWAP_STABLE_SCHEMA = z
  .object({
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
    amountOut: NUMBER_LIKE_SCHEMA,
    slippage: NUMBER_LIKE_SCHEMA.optional(),
    allowance: z.string().optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

const MARKET_REFERENCE_SHAPE = {
  marketId: INTEGER_LIKE_SCHEMA.optional(),
  marketSlug: z.string().optional(),
  networkId: INTEGER_LIKE_SCHEMA.optional()
} as const;

const TRADE_BUY_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA,
    value: NUMBER_LIKE_SCHEMA,
    slippage: NUMBER_LIKE_SCHEMA.optional(),
    allowance: z.string().optional(),
    swapSlippage: NUMBER_LIKE_SCHEMA.optional(),
    swapAllowance: z.string().optional(),
    autoSwap: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    skipApproval: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const TRADE_SELL_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA,
    value: NUMBER_LIKE_SCHEMA.optional(),
    shares: NUMBER_LIKE_SCHEMA.optional(),
    slippage: NUMBER_LIKE_SCHEMA.optional(),
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const CLAIM_WINNINGS_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA.optional(),
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const CLAIM_VOIDED_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA,
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const CLAIM_ALL_SCHEMA = z
  .object({
    wallet: z.string().optional(),
    networkId: INTEGER_LIKE_SCHEMA.optional(),
    pageSize: INTEGER_LIKE_SCHEMA.optional(),
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

export const MCP_TOOL_NAMES = [
  "markets_list",
  "markets_show",
  "users_portfolio",
  "portfolio",
  "wallet_balances",
  "swap_stable",
  "trade_buy",
  "trade_sell",
  "claim_winnings",
  "claim_voided",
  "claim_all"
] as const;

export type MyriadOperationsLike = {
  listMarkets(input: ListMarketsInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  showMarket(marketArgument: string | number, input: { networkId?: string | number }, overrides?: ApiRequestOverrides): Promise<unknown>;
  usersPortfolio(input: { address: string } & PortfolioInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  portfolio(input: PortfolioInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  walletBalances(input: WalletBalancesInput): Promise<unknown>;
  swapStable(input: StableSwapInput): Promise<unknown>;
  tradeBuy(input: TradeBuyInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  tradeSell(input: TradeSellInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  claimWinnings(input: ClaimInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  claimVoided(input: ClaimVoidedInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  claimAll(input: ClaimAllInput, overrides?: ApiRequestOverrides): Promise<unknown>;
};

function extractApiOverrides(input: { apiBaseUrl?: string; apiKey?: string }): ApiRequestOverrides {
  return {
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey
  };
}

function toStructuredContent(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

function createSuccessResult(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: toStructuredContent(payload)
  };
}

function createErrorResult(error: unknown): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message
      }
    ],
    structuredContent: {
      ok: false,
      error: message
    }
  };
}

async function executeTool(call: () => Promise<unknown>): Promise<
  | {
      content: Array<{ type: "text"; text: string }>;
      structuredContent: Record<string, unknown>;
    }
  | {
      isError: true;
      content: Array<{ type: "text"; text: string }>;
      structuredContent: Record<string, unknown>;
    }
> {
  try {
    const payload = await call();
    return createSuccessResult(payload);
  } catch (error) {
    return createErrorResult(error);
  }
}

export function createMyriadMcpServer(operations: MyriadOperationsLike, serverInfo: { name: string; version: string }): McpServer {
  const server = new McpServer(serverInfo, {
    instructions:
      "Use these tools to read Myriad markets data and execute trades/claims onchain. Write tools execute immediately unless dryRun is true."
  });

  server.registerTool(
    "markets_list",
    {
      title: "List Markets",
      description: "List markets from the MYRIAD API.",
      inputSchema: LIST_MARKETS_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.listMarkets(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "markets_show",
    {
      title: "Show Market",
      description: "Get market details by id or slug.",
      inputSchema: MARKETS_SHOW_SCHEMA
    },
    async (args) => {
      const { market, networkId, apiBaseUrl, apiKey } = args;
      return executeTool(() =>
        operations.showMarket(market, { networkId }, extractApiOverrides({ apiBaseUrl, apiKey }))
      );
    }
  );

  server.registerTool(
    "users_portfolio",
    {
      title: "User Portfolio",
      description: "Get an address portfolio from MYRIAD API.",
      inputSchema: USERS_PORTFOLIO_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.usersPortfolio(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "portfolio",
    {
      title: "Signer Portfolio",
      description: "Get portfolio for the server signer wallet.",
      inputSchema: PORTFOLIO_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.portfolio(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "wallet_balances",
    {
      title: "Wallet Balances",
      description: "Get wallet native and token balances.",
      inputSchema: WALLET_BALANCES_SCHEMA
    },
    async (args) => executeTool(() => operations.walletBalances(args))
  );

  server.registerTool(
    "swap_stable",
    {
      title: "Swap Stable",
      description: "Swap USDT/USD1 on PancakeSwap. Executes immediately unless dryRun is true.",
      inputSchema: SWAP_STABLE_SCHEMA
    },
    async (args) => executeTool(() => operations.swapStable(args))
  );

  server.registerTool(
    "trade_buy",
    {
      title: "Trade Buy",
      description: "Buy outcome shares. Executes immediately unless dryRun is true.",
      inputSchema: TRADE_BUY_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.tradeBuy(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "trade_sell",
    {
      title: "Trade Sell",
      description: "Sell position shares. Executes immediately unless dryRun is true.",
      inputSchema: TRADE_SELL_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.tradeSell(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "claim_winnings",
    {
      title: "Claim Winnings",
      description: "Claim winnings or auto-select claim action. Executes immediately unless dryRun is true.",
      inputSchema: CLAIM_WINNINGS_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.claimWinnings(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "claim_voided",
    {
      title: "Claim Voided",
      description: "Claim voided market outcome. Executes immediately unless dryRun is true.",
      inputSchema: CLAIM_VOIDED_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.claimVoided(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "claim_all",
    {
      title: "Claim All",
      description: "Scan claimable positions and execute all claims. Executes immediately unless dryRun is true.",
      inputSchema: CLAIM_ALL_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.claimAll(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  return server;
}

export async function startMyriadMcpServer(context: OperationContext): Promise<void> {
  const server = createMyriadMcpServer(new MyriadOperations(context), {
    name: "myriad",
    version: "0.1.0"
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
