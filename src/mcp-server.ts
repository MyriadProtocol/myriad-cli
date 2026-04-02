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
  ObLimitOrderInput,
  ObMarketBookInput,
  ObMarketOrderInput,
  ObMarketsListInput,
  ObMarketTradesInput,
  ObOrderCancelInput,
  ObOrderCancelAllInput,
  ObOrdersListInput,
  ObPositionActionInput,
  ObPositionRedeemInput,
  ObPositionsListInput,
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

const OB_MARKETS_LIST_SCHEMA = z
  .object({
    state: z.string().optional(),
    keyword: z.string().optional(),
    sort: z.string().optional(),
    order: z.string().optional(),
    page: INTEGER_LIKE_SCHEMA.optional(),
    limit: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_MARKETS_SHOW_SCHEMA = z
  .object({
    market: z.union([z.string().trim().min(1), z.number().int()]),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_MARKETS_ORDERBOOK_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_MARKETS_TRADES_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA.optional(),
    page: INTEGER_LIKE_SCHEMA.optional(),
    limit: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_LIMIT_ORDER_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA,
    price: NUMBER_LIKE_SCHEMA,
    shares: NUMBER_LIKE_SCHEMA,
    timeInForce: z.string().optional(),
    waitMs: INTEGER_LIKE_SCHEMA.optional(),
    expiration: INTEGER_LIKE_SCHEMA.optional(),
    minFillShares: NUMBER_LIKE_SCHEMA.optional(),
    allowance: z.string().optional(),
    skipApproval: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_MARKET_ORDER_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    outcomeId: INTEGER_LIKE_SCHEMA,
    shares: NUMBER_LIKE_SCHEMA.optional(),
    value: NUMBER_LIKE_SCHEMA.optional(),
    timeInForce: z.string().optional(),
    waitMs: INTEGER_LIKE_SCHEMA.optional(),
    allowance: z.string().optional(),
    skipApproval: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_ORDERS_LIST_SCHEMA = z
  .object({
    trader: z.string().optional(),
    marketId: INTEGER_LIKE_SCHEMA.optional(),
    status: z.string().optional(),
    offset: INTEGER_LIKE_SCHEMA.optional(),
    limit: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_ORDERS_SHOW_SCHEMA = z
  .object({
    orderHash: z.string().trim().min(1),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_ORDERS_CANCEL_SCHEMA = z
  .object({
    orderHash: z.string().trim().min(1),
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_ORDERS_CANCEL_ALL_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_POSITIONS_LIST_SCHEMA = z
  .object({
    address: z.string().optional(),
    marketId: INTEGER_LIKE_SCHEMA.optional(),
    marketSlug: z.string().optional(),
    tokenAddress: z.string().optional(),
    page: INTEGER_LIKE_SCHEMA.optional(),
    limit: INTEGER_LIKE_SCHEMA.optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_POSITION_ACTION_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
    amount: NUMBER_LIKE_SCHEMA,
    allowance: z.string().optional(),
    skipApproval: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    ...API_OVERRIDE_SHAPE
  })
  .strict();

const OB_POSITION_REDEEM_SCHEMA = z
  .object({
    ...MARKET_REFERENCE_SHAPE,
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
  "claim_all",
  "ob_markets_list",
  "ob_markets_show",
  "ob_markets_orderbook",
  "ob_markets_trades",
  "ob_limit_buy",
  "ob_limit_sell",
  "ob_market_buy",
  "ob_market_sell",
  "ob_orders_list",
  "ob_orders_show",
  "ob_orders_cancel",
  "ob_orders_cancel_all",
  "ob_positions_list",
  "ob_positions_split",
  "ob_positions_merge",
  "ob_positions_redeem"
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
  obMarketsList(input: ObMarketsListInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obMarketsShow(marketArgument: string | number, input?: { networkId?: string | number }, overrides?: ApiRequestOverrides): Promise<unknown>;
  obMarketOrderbook(input: ObMarketBookInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obMarketTrades(input: ObMarketTradesInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obLimitBuy(input: ObLimitOrderInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obLimitSell(input: ObLimitOrderInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obMarketBuy(input: ObMarketOrderInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obMarketSell(input: ObMarketOrderInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obOrdersList(input: ObOrdersListInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obOrdersShow(input: { orderHash: string }, overrides?: ApiRequestOverrides): Promise<unknown>;
  obOrdersCancel(input: ObOrderCancelInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obOrdersCancelAll(input: ObOrderCancelAllInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obPositionsList(input: ObPositionsListInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obPositionsSplit(input: ObPositionActionInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obPositionsMerge(input: ObPositionActionInput, overrides?: ApiRequestOverrides): Promise<unknown>;
  obPositionsRedeem(input: ObPositionRedeemInput, overrides?: ApiRequestOverrides): Promise<unknown>;
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

  server.registerTool(
    "ob_markets_list",
    {
      title: "Orderbook Markets List",
      description: "List orderbook markets.",
      inputSchema: OB_MARKETS_LIST_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obMarketsList(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_markets_show",
    {
      title: "Orderbook Market Show",
      description: "Show an orderbook market by id or slug.",
      inputSchema: OB_MARKETS_SHOW_SCHEMA
    },
    async (args) => {
      const { market, apiBaseUrl, apiKey } = args;
      return executeTool(() => operations.obMarketsShow(market, {}, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_markets_orderbook",
    {
      title: "Orderbook Depth",
      description: "Get aggregated bids and asks for an orderbook market outcome.",
      inputSchema: OB_MARKETS_ORDERBOOK_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obMarketOrderbook(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_markets_trades",
    {
      title: "Orderbook Trades",
      description: "Get recent trades for an orderbook market.",
      inputSchema: OB_MARKETS_TRADES_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obMarketTrades(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_limit_buy",
    {
      title: "Orderbook Limit Buy",
      description: "Place a signed orderbook limit buy. Executes immediately unless dryRun is true.",
      inputSchema: OB_LIMIT_ORDER_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obLimitBuy(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_limit_sell",
    {
      title: "Orderbook Limit Sell",
      description: "Place a signed orderbook limit sell. Executes immediately unless dryRun is true.",
      inputSchema: OB_LIMIT_ORDER_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obLimitSell(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_market_buy",
    {
      title: "Orderbook Market Buy",
      description: "Place a synthesized orderbook market buy. Executes immediately unless dryRun is true.",
      inputSchema: OB_MARKET_ORDER_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obMarketBuy(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_market_sell",
    {
      title: "Orderbook Market Sell",
      description: "Place a synthesized orderbook market sell. Executes immediately unless dryRun is true.",
      inputSchema: OB_MARKET_ORDER_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obMarketSell(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_orders_list",
    {
      title: "Orderbook Orders List",
      description: "List orderbook orders for a trader.",
      inputSchema: OB_ORDERS_LIST_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obOrdersList(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_orders_show",
    {
      title: "Orderbook Order Show",
      description: "Show a single orderbook order by hash.",
      inputSchema: OB_ORDERS_SHOW_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obOrdersShow(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_orders_cancel",
    {
      title: "Orderbook Order Cancel",
      description: "Cancel an orderbook order. Executes immediately unless dryRun is true.",
      inputSchema: OB_ORDERS_CANCEL_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obOrdersCancel(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_orders_cancel_all",
    {
      title: "Orderbook Order Cancel All",
      description: "Cancel all open orderbook orders for the configured trader on a specific market.",
      inputSchema: OB_ORDERS_CANCEL_ALL_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obOrdersCancelAll(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_positions_list",
    {
      title: "Orderbook Positions List",
      description: "Get the Order Book portfolio for a wallet.",
      inputSchema: OB_POSITIONS_LIST_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obPositionsList(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_positions_split",
    {
      title: "Orderbook Positions Split",
      description: "Split collateral into YES + NO shares. Executes immediately unless dryRun is true.",
      inputSchema: OB_POSITION_ACTION_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obPositionsSplit(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_positions_merge",
    {
      title: "Orderbook Positions Merge",
      description: "Merge YES + NO shares back into collateral. Executes immediately unless dryRun is true.",
      inputSchema: OB_POSITION_ACTION_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obPositionsMerge(input, extractApiOverrides({ apiBaseUrl, apiKey })));
    }
  );

  server.registerTool(
    "ob_positions_redeem",
    {
      title: "Orderbook Positions Redeem",
      description: "Redeem a resolved or voided position. Executes immediately unless dryRun is true.",
      inputSchema: OB_POSITION_REDEEM_SCHEMA
    },
    async (args) => {
      const { apiBaseUrl, apiKey, ...input } = args;
      return executeTool(() => operations.obPositionsRedeem(input, extractApiOverrides({ apiBaseUrl, apiKey })));
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
