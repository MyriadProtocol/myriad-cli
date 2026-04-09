import {
  ApiListResponse,
  ClaimRequest,
  ClaimResponse,
  ClobOrder,
  ClobOrderRecord,
  Market,
  OrderbookResponse,
  OrderbookTrade,
  PortfolioMarketItem,
  PortfolioPosition,
  PositionCalldataResponse,
  QuoteRequest,
  QuoteResponse
} from "./types.js";

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

function toQueryString(query: RequestOptions["query"]): URLSearchParams {
  const params = new URLSearchParams();
  if (!query) {
    return params;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, String(value));
  }
  return params;
}

function unwrapPayload<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

export class MyriadApiClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(params: { baseUrl: string; apiKey?: string }) {
    this.baseUrl = normalizeBaseUrl(params.baseUrl);
    this.apiKey = params.apiKey;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const query = toQueryString(options.query);
    query.forEach((value, key) => url.searchParams.set(key, value));

    const headers = new Headers();
    headers.set("accept", "application/json");
    if (this.apiKey) {
      headers.set("x-api-key", this.apiKey);
    }
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let maybeJson: unknown = {};
    if (text.length > 0) {
      try {
        maybeJson = JSON.parse(text);
      } catch (error) {
        if (!response.ok) {
          throw new Error(`MYRIAD API request failed (${response.status}): ${text || response.statusText}`);
        }
        throw new Error(`MYRIAD API returned a non-JSON payload for ${path}.`);
      }
    }

    if (!response.ok) {
      const errorDetail =
        (maybeJson && typeof maybeJson === "object" && "error" in maybeJson && String((maybeJson as { error: unknown }).error)) ||
        text ||
        response.statusText;
      if (response.status === 401 && !this.apiKey) {
        throw new Error(
          `MYRIAD API request failed (${response.status}): ${errorDetail}. This endpoint may require MYRIAD_API_KEY; set --api-key or MYRIAD_API_KEY for expanded access and higher rate limits.`
        );
      }
      throw new Error(`MYRIAD API request failed (${response.status}): ${errorDetail}`);
    }

    return maybeJson as T;
  }

  async listMarkets(query: Record<string, string | number | boolean | undefined> = {}): Promise<ApiListResponse<Market>> {
    const response = await this.request<{ data?: Market[]; pagination?: ApiListResponse<Market>["pagination"] } | Market[]>(
      "markets",
      {
        query
      }
    );

    if (Array.isArray(response)) {
      return { data: response };
    }

    return {
      data: response.data ?? [],
      pagination: response.pagination
    };
  }

  async getMarketById(
    marketId: number,
    networkId: number,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<Market> {
    const response = await this.request<Market | { data: Market }>(`markets/${marketId}`, {
      query: {
        network_id: networkId,
        ...query
      }
    });
    return unwrapPayload<Market>(response);
  }

  async getMarketBySlug(
    slug: string,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<Market> {
    const response = await this.request<Market | { data: Market }>(`markets/${slug}`, {
      query
    });
    return unwrapPayload<Market>(response);
  }

  async quote(request: QuoteRequest): Promise<QuoteResponse> {
    const response = await this.request<QuoteResponse | { data: QuoteResponse }>("markets/quote", {
      method: "POST",
      body: request
    });
    return unwrapPayload<QuoteResponse>(response);
  }

  async claim(request: ClaimRequest): Promise<ClaimResponse> {
    const response = await this.request<ClaimResponse | { data: ClaimResponse }>("markets/claim", {
      method: "POST",
      body: request
    });
    return unwrapPayload<ClaimResponse>(response);
  }

  async getPortfolio(
    address: string,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<ApiListResponse<PortfolioPosition>> {
    const response = await this.request<
      { data?: PortfolioPosition[]; pagination?: ApiListResponse<PortfolioPosition>["pagination"] } | PortfolioPosition[]
    >(`users/${address}/portfolio`, {
      query
    });

    if (Array.isArray(response)) {
      return { data: response };
    }

    return {
      data: response.data ?? [],
      pagination: response.pagination
    };
  }

  async getPortfolioMarkets(
    address: string,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<ApiListResponse<PortfolioMarketItem>> {
    const response = await this.request<
      { data?: PortfolioMarketItem[]; pagination?: ApiListResponse<PortfolioMarketItem>["pagination"] } | PortfolioMarketItem[]
    >(`users/${address}/markets`, {
      query
    });

    if (Array.isArray(response)) {
      return { data: response };
    }

    return {
      data: response.data ?? [],
      pagination: response.pagination
    };
  }

  async getMarketOrderbook(
    marketId: number,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<OrderbookResponse> {
    const response = await this.request<OrderbookResponse | { data: OrderbookResponse }>(`markets/${marketId}/orderbook`, {
      query
    });
    return unwrapPayload<OrderbookResponse>(response);
  }

  async getMarketTrades(
    marketId: number,
    query: Record<string, string | number | boolean | undefined> = {}
  ): Promise<ApiListResponse<OrderbookTrade>> {
    const response = await this.request<
      { data?: OrderbookTrade[]; pagination?: ApiListResponse<OrderbookTrade>["pagination"] } | OrderbookTrade[]
    >(`markets/${marketId}/trades`, {
      query
    });

    if (Array.isArray(response)) {
      return { data: response };
    }

    return {
      data: response.data ?? [],
      pagination: response.pagination
    };
  }

  async createOrder(request: {
    order: ClobOrder;
    signature: string;
    network_id?: number;
    time_in_force?: string;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("orders", {
      method: "POST",
      body: request
    });
  }

  async listOrders(query: Record<string, string | number | boolean | undefined> = {}): Promise<ApiListResponse<ClobOrderRecord>> {
    const response = await this.request<
      { data?: ClobOrderRecord[]; pagination?: ApiListResponse<ClobOrderRecord>["pagination"] } | ClobOrderRecord[]
    >("orders", {
      query
    });

    if (Array.isArray(response)) {
      return { data: response };
    }

    return {
      data: response.data ?? [],
      pagination: response.pagination
    };
  }

  async getOrder(orderHash: string): Promise<ClobOrderRecord> {
    const response = await this.request<ClobOrderRecord | { data: ClobOrderRecord }>(`orders/${orderHash}`);
    return unwrapPayload<ClobOrderRecord>(response);
  }

  async cancelOrder(
    orderHash: string,
    request: {
      order: ClobOrder;
      signature: string;
      network_id?: number;
    }
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(`orders/${orderHash}`, {
      method: "DELETE",
      body: request
    });
  }

  async cancelOrdersBatch(request: {
    orders: Array<{
      order: ClobOrder;
      signature: string;
    }>;
    network_id?: number;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("orders/cancel-batch", {
      method: "POST",
      body: request
    });
  }

  async cancelAllOrders(request: {
    trader: string;
    timestamp: string;
    signature: string;
    market_id?: number;
    network_id?: number;
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("orders/cancel-all", {
      method: "POST",
      body: request
    });
  }

  async splitPosition(request: { market_id: number; amount: string; network_id?: number }): Promise<PositionCalldataResponse> {
    const response = await this.request<PositionCalldataResponse | { data: PositionCalldataResponse }>("positions/split", {
      method: "POST",
      body: request
    });
    return unwrapPayload<PositionCalldataResponse>(response);
  }

  async mergePosition(request: { market_id: number; amount: string; network_id?: number }): Promise<PositionCalldataResponse> {
    const response = await this.request<PositionCalldataResponse | { data: PositionCalldataResponse }>("positions/merge", {
      method: "POST",
      body: request
    });
    return unwrapPayload<PositionCalldataResponse>(response);
  }

  async redeemPosition(request: { market_id: number; network_id?: number }): Promise<PositionCalldataResponse> {
    const response = await this.request<PositionCalldataResponse | { data: PositionCalldataResponse }>("positions/redeem", {
      method: "POST",
      body: request
    });
    return unwrapPayload<PositionCalldataResponse>(response);
  }

  async redeemVoidedPosition(request: { market_id: number; network_id?: number }): Promise<PositionCalldataResponse> {
    const response = await this.request<PositionCalldataResponse | { data: PositionCalldataResponse }>(
      "positions/redeem-voided",
      {
        method: "POST",
        body: request
      }
    );
    return unwrapPayload<PositionCalldataResponse>(response);
  }
}
