This document describes the Order Book REST API endpoints exposed by the Myriad Protocol API. The Order Book replaces the AMM for order matching — traders sign EIP-712 orders off-chain, the API validates and stores them, and an on-chain matcher settles fills through the `MyriadCTFExchange` contract.

Base URL:

- Production: [`https://api-v2.myriadprotocol.com/`](https://api-v2.myriadprotocol.com/)

## Authentication

**API access is public**, with higher rate limits if an API key is provided. 

Some endpoints require authentication and whitelisting, such as `/markets/quote_with_fee` .

How to authenticate your request:

- Header: `x-api-key: <your_api_key>`
- Or Query: `?api_key=<your_api_key>`

To obtain an API key, please reach out to the Myriad team.

```bash
curl -H "x-api-key: YOUR_API_KEY" <https://api-v2.myriadprotocol.com/markets>
```

## Rate Limiting

- Requests with API key - 100 requests/second per IP and/or API key.
- Requests w/o API key - 30 requests/10 seconds per IP
- Headers included on responses:
    - `X-RateLimit-Limit`
    - `X-RateLimit-Remaining`
    - `X-RateLimit-Reset`

---

## Concepts

### Trading Model

By default, all endpoints return **AMM-only** data. To access Order Book data, you must explicitly pass the `trading_model` query parameter.

| Value | Description |
| --- | --- |
| `amm` | AMM markets only (default when parameter is omitted) |
| `ob` | Order Book markets only |
| `all` | Both AMM and Order Book markets |

The legacy `execution_mode` parameter (`0` = AMM, `1` = Order Book) is still supported but `trading_model` is preferred and takes precedence.

### Order Signing (EIP-712)

Orders are signed off-chain using the [EIP-712](https://eips.ethereum.org/EIPS/eip-712) typed data standard. The signing domain is:

```json
{
  "name": "MyriadCTFExchange",
  "version": "1",
  "chainId": "<chain_id>",
  "verifyingContract": "<exchange_contract_address>"
}
```

The `Order` struct:

```
Order(
  address trader,
  uint256 marketId,
  uint8   outcomeId,
  uint8   side,
  uint256 amount,
  uint256 price,
  uint256 minFillAmount,
  uint256 nonce,
  uint256 expiration
)
```

### Price and Amount Scale

- **Price:** integer in `[1, 1e18]` representing a fraction of 1 collateral token per share. `0.50` = `500000000000000000`.
- **Amount:** integer in the token's smallest unit (e.g. for 18-decimal tokens, `1e18` = 1 share).

### Sides

| Value | Meaning |
| --- | --- |
| `0` | **Buy** — buying outcome shares |
| `1` | **Sell** — selling outcome shares |

### Outcomes

| Value | Meaning |
| --- | --- |
| `0` | **Yes** |
| `1` | **No** |

### Time-in-Force

| TIF | Behaviour |
| --- | --- |
| **GTC** | Good-til-cancelled. Remains on the book until filled, cancelled, or the market closes. `expiration` must be `0`. |
| **GTD** | Good-til-date. Expires at the unix timestamp in `expiration`. `expiration` must be non-zero. |
| **FOK** | Fill-or-kill. Must be fully filled in a single matcher run or it is cancelled. |
| **FAK** | Fill-and-kill. Partial fill is allowed; the unfilled remainder is cancelled after the matcher run. |

### Match Types

The on-chain matcher supports three settlement modes:

| Type | Description |
| --- | --- |
| **Direct** | A BUY order is matched against a SELL order on the same outcome. Bid price >= ask price. |
| **Mint** | Two BUY orders on opposite outcomes (YES + NO) whose prices sum to 1. New shares are minted from collateral. |
| **Merge** | Two SELL orders on opposite outcomes whose prices sum to 1. Shares are burned and collateral is returned. |
| **Cross-market** | (NegRisk only) N BUY-YES orders across all outcomes of an event whose prices sum to 1. |

---

## Orders

### POST /orders

Place a new order. The order is validated, the trader's signature is verified, on-chain balance/allowance is checked, and the order is persisted and pushed to the matcher.

**Request body:**

```json
{
  "order": {
    "trader": "0x1234...abcd",
    "marketId": "42",
    "outcomeId": 0,
    "side": 0,
    "amount": "1000000000000000000",
    "price": "500000000000000000",
    "minFillAmount": "0",
    "nonce": "1",
    "expiration": "0"
  },
  "signature": "0x<130 hex chars>",
  "network_id": 56,
  "time_in_force": "GTC"
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `order.trader` | address | yes | The signer's wallet address (40 hex chars, `0x`-prefixed) |
| `order.marketId` | uint string | yes | On-chain market ID |
| `order.outcomeId` | `0` or `1` | yes | Outcome to trade |
| `order.side` | `0` or `1` | yes | `0` = buy, `1` = sell |
| `order.amount` | uint string | yes | Maximum number of shares (in wei). Must be > 0 |
| `order.price` | uint string | yes | Price per share in `[1, 1e18]` |
| `order.minFillAmount` | uint string | no | Minimum fill size (default `"0"`) |
| `order.nonce` | uint string | yes | Unique nonce for the order |
| `order.expiration` | uint string | yes | Unix timestamp for GTD; `"0"` for GTC/FOK/FAK |
| `signature` | hex string | yes | EIP-712 signature (`0x` + 130 hex chars = 65 bytes) |
| `network_id` | number | no | Network ID (defaults to server config) |
| `time_in_force` | string | no | `GTC` (default), `GTD`, `FOK`, `FAK` |

**Validation rules:**

- GTC orders must have `expiration = 0`.
- GTD orders must have `expiration > 0`.
- For **buy** orders: the trader must have sufficient collateral balance **and** allowance on the exchange contract for `notional + fee` (where `notional = amount * price / 1e18`).
- For **sell** orders: the trader must hold enough outcome shares in the ConditionalTokens contract **and** have approved the exchange via `setApprovalForAll`.

**Success response (`200`):**

```json
{
  "orderHash": "0x...",
  "status": "open",
  "timeInForce": "GTC"
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Invalid payload, market not open, insufficient balance/allowance, invalid signature |
| `404` | Market not found |
| `409` | Order already exists (duplicate hash) |
| `429` | Per-trader rate limit exceeded (10 orders / 10 seconds) |
| `500` | Server error or RPC failure |

---

### GET /orders

List orders with optional filters.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `trader` | address | Filter by trader wallet |
| `network_id` | number | Filter by network |
| `market_id` | number | Filter by on-chain market ID |
| `status` | string | `open`, `filled`, `cancelled`, `expired` |
| `limit` | number | 1-1000 (default 200) |
| `offset` | number | Offset for pagination (default 0) |

**Response (`200`):**

```json
{
  "data": [
    {
      "orderHash": "0x...",
      "order": {
        "trader": "0x...",
        "marketId": 42,
        "outcomeId": 0,
        "side": 0,
        "amount": "1000000000000000000",
        "price": "500000000000000000",
        "minFillAmount": "0",
        "nonce": "1",
        "expiration": "0"
      },
      "signature": "0x...",
      "status": "open",
      "filledAmount": "0",
      "timeInForce": "GTC",
      "createdAt": "2025-07-01T12:00:00.000Z"
    }
  ]
}
```

---

### GET /orders/:orderHash

Get a single order by its hash.

**Response (`200`):**

```json
{
  "orderHash": "0x...",
  "order": {
    "trader": "0x...",
    "marketId": 42,
    "outcomeId": 0,
    "side": 0,
    "amount": "1000000000000000000",
    "price": "500000000000000000",
    "minFillAmount": "0",
    "nonce": "1",
    "expiration": "0"
  },
  "signature": "0x...",
  "status": "open",
  "filledAmount": "0",
  "timeInForce": "GTC",
  "networkId": 56,
  "createdAt": "2025-07-01T12:00:00.000Z",
  "updatedAt": "2025-07-01T12:00:00.000Z",
  "cancelledAt": null,
  "filledAt": null
}
```

**Errors:** `404` if order not found.

---

### DELETE /orders/:orderHash

Cancel an open order. Requires the original order + signature in the request body for ownership verification.

**Request body:**

```json
{
  "order": {
    "trader": "0x...",
    "marketId": "42",
    "outcomeId": 0,
    "side": 0,
    "amount": "1000000000000000000",
    "price": "500000000000000000",
    "minFillAmount": "0",
    "nonce": "1",
    "expiration": "0"
  },
  "signature": "0x<130 hex chars>",
  "network_id": 56
}
```

**Success response (`200`):**

```json
{
  "orderHash": "0x...",
  "status": "cancelled"
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Missing body, invalid payload, hash mismatch, invalid signature, order already filled/expired |
| `404` | Order not found |

---

### POST /orders/cancel-batch

Cancel multiple orders in a single request. Each order requires its original order data and signature for ownership verification.

**Request body:**

```json
{
  "orders": [
    {
      "order": {
        "trader": "0x...",
        "marketId": "42",
        "outcomeId": 0,
        "side": 0,
        "amount": "1000000000000000000",
        "price": "500000000000000000",
        "minFillAmount": "0",
        "nonce": "1",
        "expiration": "0"
      },
      "signature": "0x<130 hex chars>"
    }
  ],
  "network_id": 56
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `orders` | array | yes | Array of `{order, signature}` objects (1-100 items) |
| `orders[].order` | object | yes | Full order struct (same as `POST /orders`) |
| `orders[].signature` | hex string | yes | EIP-712 signature for this order |
| `network_id` | number | no | Network ID (defaults to server config) |

**Success response (`200`):**

```json
{
  "cancelled": ["0xabc...", "0xdef..."],
  "errors": [
    { "orderHash": "0x123...", "reason": "Order not found" }
  ]
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Invalid payload or missing CLOB config |
| `500` | Server error |

---

### POST /orders/cancel-all

Cancel all open orders for a trader, optionally filtered by market. Requires an EIP-712 `CancelAll` signature to prove wallet ownership.

**EIP-712 `CancelAll` struct:**

```
CancelAll(
  address trader,
  uint256 marketId,
  uint256 timestamp
)
```

Set `marketId` to `0` to cancel across all markets. The signing domain is the same as for `Order` (see Order Signing).

**Request body:**

```json
{
  "trader": "0x1234...abcd",
  "market_id": 42,
  "timestamp": "1719835200",
  "signature": "0x<130 hex chars>",
  "network_id": 56
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `trader` | address | yes | Trader wallet address |
| `market_id` | number | no | On-chain market ID. Omit to cancel across all markets |
| `timestamp` | uint string | yes | Current unix timestamp (must be within 5 minutes of server time) |
| `signature` | hex string | yes | EIP-712 `CancelAll` signature |
| `network_id` | number | no | Network ID (defaults to server config) |

**Success response (`200`):**

```json
{
  "cancelled_count": 12,
  "market_ids_affected": ["uuid-...", "uuid-..."]
}
```

**Error responses:**

| Status | Condition |
| --- | --- |
| `400` | Invalid payload, bad signature, timestamp too old, missing CLOB config |
| `500` | Server error |

---

## Market Data

### GET /markets/:id/orderbook

Aggregated orderbook for an Order Book market outcome. Returns open, non-expired orders with remaining size, grouped by price level. Accepts either a numeric market ID (with `network_id`) or a market slug.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Network ID (required when using numeric ID) |
| `outcome` | `0` or `1` | Outcome to query (default `0`) |

**Response (`200`):**

```json
{
  "bids": [
    ["500000000000000000", "3000000000000000000"],
    ["490000000000000000", "1500000000000000000"]
  ],
  "asks": [
    ["510000000000000000", "2000000000000000000"],
    ["520000000000000000", "5000000000000000000"]
  ]
}
```

Each entry is `[price, remaining_amount]` as strings. Bids are sorted descending by price, asks ascending.

---

### GET /markets/:id/trades

Recent Order Book trades for a market, ordered by timestamp descending. Accepts either a numeric market ID (with `network_id`) or a market slug.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Network ID (required when using numeric ID) |
| `outcome` | `0` or `1` | Filter by outcome (optional) |
| `limit` | number | 1-200 (default 50) |
| `page` | number | Page number (default 1) |

**Response (`200`):**

```json
[
  {
    "price": "0.5",
    "priceAfterFees": "0.51",
    "amount": "1000000000000000000",
    "side": "buy",
    "outcome": 0,
    "txHash": "0x...",
    "timestamp": 1719835200,
    "fees": {
      "total": "10000000000000000",
      "lp": "0",
      "treasury": "5000000000000000",
      "distributor": "5000000000000000"
    }
  }
]
```

---

## Positions

Position endpoints return transaction calldata (`{ to, calldata, value }`) that the client signs and submits on-chain. All amounts are in the token's smallest unit (uint string, e.g. `"1000000000000000000"` for 1 token with 18 decimals).

### POST /positions/split

Split collateral into YES + NO outcome shares.

**Request body:**

```json
{
  "market_id": 42,
  "amount": "1000000000000000000",
  "network_id": 56
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `market_id` | number | yes | On-chain market ID |
| `amount` | uint string | yes | Collateral amount to split |
| `network_id` | number | no | Network ID |

**Response (`200`):**

```json
{
  "to": "0x<ConditionalTokens address>",
  "calldata": "0x...",
  "value": "0"
}
```

---

### POST /positions/merge

Merge YES + NO outcome shares back into collateral.

**Request body:** Same as `/positions/split`.

---

### POST /positions/redeem

Redeem winning outcome shares for collateral after market resolution.

**Request body:**

```json
{
  "market_id": 42,
  "network_id": 56
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `market_id` | number | yes | On-chain market ID |
| `network_id` | number | no | Network ID |

---

### POST /positions/redeem-voided

Redeem shares from a voided market at the market's voided payout ratios.

**Request body:** Same as `/positions/redeem`.

---

### POST /positions/neg-risk/split

Split collateral into YES + NO shares for a specific outcome within a NegRisk event. The underlying collateral is wrapped into WCOL by the NegRiskAdapter.

**Request body:**

```json
{
  "event_id": "0x<64 hex chars>",
  "outcome_index": 0,
  "amount": "1000000000000000000",
  "network_id": 56
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `event_id` | bytes32 hex | yes | NegRisk event ID |
| `outcome_index` | number | yes | Index of the outcome within the event |
| `amount` | uint string | yes | Underlying collateral amount |
| `network_id` | number | no | Network ID |

---

### POST /positions/neg-risk/merge

Merge YES + NO shares for a NegRisk outcome back into underlying collateral.

**Request body:** Same as `/positions/neg-risk/split`.

---

## Events

Events group multiple binary Order Book markets under a single parent (e.g. "Who will win the election?" with outcomes A, B, C, ...). Each sibling market is its own binary market with `Yes` / `No` outcomes. The `negRisk` flag determines the resolution semantics:

- **NegRisk events** (`negRisk: true`) — sibling markets are **mutually exclusive**: exactly one resolves to `Yes` and all others resolve to `No` (e.g. "Who will win the election?").
- **Non-NegRisk events** (`negRisk: false`) — sibling markets resolve **independently**, so zero, one, or multiple siblings can resolve to `Yes` (e.g. "Which teams will make the playoffs?").

> Only **published** events (`publishedAt IS NOT NULL`) are returned by `GET /events`, `GET /events/:id`, and `GET /events/:id/orderbook`. Unpublished events return `404`.
> 

### GET /events

List all published events with nested sibling markets and aggregated metrics.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Filter by network (optional) |
| `state` | string | Filter by state (optional) |

**Response (`200`):**

Each item is an event row with:

- `type: "event"` — discriminator (matches the shape produced by grouped endpoints elsewhere).
- `negRisk` / `negRiskId` — replaces the previous `ethEventId` field. `negRiskId` is the on-chain NegRisk event id (bytes32 hex).
- Aggregated trading metrics (`volume`, `volume24h`, `volumeNotional`, `volumeNotional24h`, `liquidity`, `users`, `featured`, `featuredAt`) summed/aggregated across the event's sibling markets.
- `markets` — array of fully-serialized sibling markets (same shape as `GET /markets` items, including their own `outcomes` and `externalSources`), ordered by `outcomeIndex`.
- `externalSources` — event-level external sources.

```json
{
  "data": [
    {
      "type": "event",
      "id": "uuid-...",
      "networkId": 56,
      "slug": "2028-election",
      "title": "Who will win the 2028 election?",
      "description": "...",
      "imageUrl": "https://...",
      "bannerImageUrl": "https://...",
      "state": "open",
      "resolvedOutcomeIndex": null,
      "expiresAt": "2028-11-05T00:00:00.000Z",
      "publishedAt": "2025-06-01T00:00:00.000Z",
      "negRisk": true,
      "negRiskId": "0x...",
      "volume": 123456.78,
      "volume24h": 1234.56,
      "volumeNotional": 234567.89,
      "volumeNotional24h": 2345.67,
      "liquidity": 9876.54,
      "users": 1234,
      "featured": false,
      "featuredAt": null,
      "externalSources": [],
      "markets": [
        {
          "id": 42,
          "title": "Candidate A",
          "outcomeIndex": 0,
          "state": "open",
          "outcomes": [ /* ... */ ],
          "externalSources": [ /* ... */ ]
          /* ...full market shape... */
        }
      ]
    }
  ]
}
```

> **Breaking changes vs. previous version:** the response no longer contains the
top-level `ethEventId`, `rules`, `createdAt`, or the minimal `outcomes` array
(`{ marketId, ethMarketId, title, outcomeIndex, state, tokenId }`). Use
`negRiskId` instead of `ethEventId`, and read sibling market data — including
`tokenId` — from `markets[].outcomes[]`.
> 

---

### GET /events/:id

Get a single published event by UUID or slug. Returns `404` if the event is unpublished or not found.

**Response (`200`):** A single event row with the exact same shape as one item in `GET /events` (the response is the event object directly, not wrapped in `data`).

---

### GET /events/:id/orderbook

Combined orderbook across all outcome markets in a published NegRisk event. Returns the orderbook per outcome market.

**Response (`200`):**

```json
{
  "outcomes": [
    {
      "marketId": "uuid-...",
      "ethMarketId": 42,
      "outcomeIndex": 0,
      "title": "Candidate A",
      "orderbook": {
        "bids": [["500000000000000000", "1000000000000000000"]],
        "asks": [["520000000000000000", "2000000000000000000"]]
      }
    },
    {
      "marketId": "uuid-...",
      "ethMarketId": 43,
      "outcomeIndex": 1,
      "title": "Candidate B",
      "orderbook": {
        "bids": [],
        "asks": []
      }
    }
  ]
}
```

---

### GET /events/:id/actions

Paginated trade actions across all outcome markets in an event, ordered by timestamp descending. Accepts an event UUID or slug.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `trading_model` | `amm`, `ob`, `all` | Filter outcome markets by trading model (default `amm`) |
| `since` | unix seconds | Only include actions at or after this timestamp |
| `until` | unix seconds | Only include actions at or before this timestamp |
| `only_relevant` | `1`/`true`/`yes` | Exclude wash-trade actions (where `relevant = false`) |
| `page` | number | Page number (default `1`) |
| `limit` | number | 1-100 (default `20`) |

**Response (`200`):**

```json
{
  "data": [
    {
      "user": "0x...",
      "action": "buy",
      "marketTitle": "Candidate A",
      "marketSlug": "candidate-a",
      "marketId": 42,
      "networkId": 56,
      "outcomeTitle": "Yes",
      "outcomeId": 0,
      "imageUrl": "https://...",
      "shares": 1.5,
      "value": 0.75,
      "timestamp": 1719835200,
      "blockNumber": 12345678,
      "token": "0x<collateral address>",
      "txId": "0x..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 137,
    "totalPages": 7,
    "hasNext": true,
    "hasPrev": false
  }
}
```

The `action` field is normalized: `split` is reported as `buy` and `merge` as `sell`. Maker-side actions are excluded (only `role = 'taker'` or null are returned).

**Errors:** `404` if the event is not found.

---

## Existing Endpoints with Order Book Support

The following existing endpoints support Order Book markets via the `trading_model` query parameter. **By default (no parameter), all endpoints return AMM-only data.** You must pass `trading_model=ob` to access Order Book data, or `trading_model=all` for both.

| Param | Values | Default | Description |
| --- | --- | --- | --- |
| `trading_model` | `amm`, `ob`, `all` | `amm` | Filter by trading model |

### GET /markets

Returns markets filtered by trading model.

Example: `GET /markets?trading_model=ob&network_id=56`

### GET /markets/:id

Returns a single market. Requires `trading_model=ob` or `trading_model=all` to return Order Book markets.

### GET /markets/:id/events

Returns market events. Requires `trading_model=ob` or `trading_model=all` to include Order Book market events.

### GET /users/:address/portfolio

Returns user portfolio positions. Pass `trading_model=ob` to get Order Book positions, or `trading_model=all` for both.

Example: `GET /users/0x.../portfolio?trading_model=ob`

### GET /users/:address/markets

Returns user markets with position data. Pass `trading_model=ob` to get Order Book positions, or `trading_model=all` for both. Includes on-chain balances from the ConditionalTokens contract.

Example: `GET /users/0x.../markets?trading_model=ob&network_id=56`

### GET /users/:address/events

Returns user action events. Pass `trading_model=ob` to filter to Order Book actions only.

---

## Order Lifecycle

```
 Trader                         API                           Matcher (on-chain)
   |                             |                                   |
   |  POST /orders (signed)      |                                   |
   | --------------------------► |                                   |
   |                             |  validate, verify sig,            |
   |                             |  check balance/allowance          |
   |                             |  insert into orders table         |
   |  ◄─ { orderHash, status }   |                                   |
   |                             |  NOTIFY orders_changed            |
   |                             | ────────────────────────────────► |
   |                             |                                   |  load open orders
   |                             |                                   |  find matches
   |                             |                                   |  call exchange contract
   |                             |                                   |  (matchMultipleOrdersWithFees
   |                             |                                   |   or matchCrossMarketOrders)
   |                             |  ◄──── OrdersMatched event ────── |
   |                             |  update orders + actions          |
   |                             |                                   |
   |  GET /orders/:hash          |                                   |
   | --------------------------► |                                   |
   |  ◄─ { status: "filled" }    |                                   |
```

1. **Place order** — trader signs an EIP-712 order and sends it to `POST /orders`.
2. **Validation** — the API verifies the signature, checks on-chain balance/allowance, and stores the order.
3. **Matching** — the matcher service loads open orders, finds compatible pairs/sets, and calls the exchange contract.
4. **Settlement** — the exchange contract atomically transfers shares and collateral on-chain.
5. **Sync** — the API listens for `OrdersMatched` / `OrderCancelled` events and updates order statuses.

---

## Errors

Common errors across all Order Book endpoints:

| Status | Condition |
| --- | --- |
| `400` | Invalid request parameters or validation failure |
| `401` | Missing or invalid API key |
| `404` | Resource not found |
| `409` | Duplicate order |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## Networks

Order Book markets are currently deployed on **BNB Smart Chain**. See the [Contract Addresses](https://docs.myriad.markets/builders/contract-addresses).