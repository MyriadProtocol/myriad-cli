import {
  ApiListResponse,
  ClaimRequest,
  ClaimResponse,
  Market,
  PortfolioMarketItem,
  PortfolioPosition,
  QuoteRequest,
  QuoteResponse
} from "./types.js";

type RequestOptions = {
  method?: "GET" | "POST";
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

  async getMarketById(marketId: number, networkId: number): Promise<Market> {
    const response = await this.request<Market | { data: Market }>(`markets/${marketId}`, {
      query: { network_id: networkId }
    });
    return unwrapPayload<Market>(response);
  }

  async getMarketBySlug(slug: string): Promise<Market> {
    const response = await this.request<Market | { data: Market }>(`markets/${slug}`);
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
}
