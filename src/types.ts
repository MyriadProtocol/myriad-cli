export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type ApiListResponse<T> = {
  data: T[];
  pagination?: Pagination;
};

export type MarketOutcome = {
  id: number;
  title: string;
  price?: number;
  shares?: number;
  sharesHeld?: number;
};

export type MarketToken = {
  address: string;
  symbol: string;
  name?: string;
  decimals?: number;
};

export type Market = {
  id: number;
  slug: string;
  title: string;
  description?: string;
  state: "open" | "closed" | "resolved" | string;
  networkId: number;
  token?: MarketToken;
  outcomes?: MarketOutcome[];
  [key: string]: unknown;
};

export type QuoteAction = "buy" | "sell";

export type MarketReferenceById = {
  market_id: number;
  network_id: number;
};

export type MarketReferenceBySlug = {
  market_slug: string;
  network_id?: number;
};

export type MarketReference = MarketReferenceById | MarketReferenceBySlug;

export type QuoteRequest = MarketReference & {
  outcome_id: number;
  action: QuoteAction;
  value?: number;
  shares?: number;
  slippage?: number;
};

export type QuoteResponse = {
  value: number;
  shares: number;
  shares_threshold: number;
  price_average: number;
  price_before: number;
  price_after: number;
  calldata: string;
  net_amount: number;
  fees: {
    treasury?: number;
    distributor?: number;
    fee?: number;
    frontend?: number;
  };
  [key: string]: unknown;
};

export type ClaimRequest = MarketReference & {
  outcome_id?: number;
};

export type ClaimResponse = {
  action: "claim_winnings" | "claim_voided" | string;
  outcome_id: number;
  calldata: string;
  [key: string]: unknown;
};

export type PortfolioPosition = {
  marketId: number;
  outcomeId: number;
  networkId: number;
  shares: number;
  price: number;
  value: number;
  profit: number;
  roi: number | null;
  winningsToClaim: boolean;
  winningsClaimed: boolean;
  status: "ongoing" | "lost" | "won" | "claimed" | "sold" | string;
  [key: string]: unknown;
};

export type PortfolioMarketPosition = {
  marketId?: number;
  outcomeId?: number;
  networkId?: number;
  winningsToClaim?: boolean;
  winningsClaimed?: boolean;
  voidedWinningsToClaim?: boolean;
  voidedWinningsClaimed?: boolean;
  status?: string;
  [key: string]: unknown;
};

export type PortfolioMarketItem = {
  market?: Market;
  portfolio?: {
    positions?: PortfolioMarketPosition[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
