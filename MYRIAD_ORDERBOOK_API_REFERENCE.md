# # Order Book API Reference (Provisional)

This document describes the CLOB (Central Limit Order Book) REST API endpoints exposed by the Myriad Protocol API. The CLOB replaces the AMM for order matching — traders sign EIP-712 orders off-chain, the API validates and stores them, and an on-chain matcher settles fills through the `MyriadCTFExchange` contract.

Base URL:

- Production: [`https://api-v2.myriadprotocol.com/`](https://api-v2.myriadprotocol.com/)
- Staging / Testnet: [`https://api-ob-staging.myriadprotocol.com/`](https://api-ob-staging.myriadprotocol.com/)

## Authentication

All endpoints require an API key.

- Header: `x-api-key: <your_api_key>`
- Or Query: `?api_key=<your_api_key>`

To obtain an API key, please reach out to the Myriad team.

## Rate Limiting

- **Global:** 5 requests/second per IP and/or API key.
- **Order placement:** 10 orders per 10-second window per trader address.
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Concepts

### Execution Modes

Markets have an `execution_mode` field:

| Mode | Value | Description |
| --- | --- | --- |
| AMM | `0` | Trades executed via the on-chain Automated Market Maker |
| CLOB | `1` | Trades executed via the Central Limit Order Book |

CLOB endpoints only apply to markets with `execution_mode = 1`.

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
| **Direct** | A BUY order is matched against a SELL order on the same outcome. Bid price ≥ ask price. |
| **Mint** | Two BUY orders on opposite outcomes (YES + NO) whose prices sum to 1. New shares are minted from collateral. |
| **Merge** | Two SELL orders on opposite outcomes whose prices sum to 1. Shares are burned and collateral is returned. |
| **Cross-market** | (NegRisk only) N BUY-YES orders across all outcomes of an event whose prices sum to 1. |

---

## Orders

### POST /orders

Place a new CLOB order. The order is validated, the trader's signature is verified, on-chain balance/allowance is checked, and the order is persisted and pushed to the matcher.

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

List CLOB orders with optional filters.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `trader` | address | Filter by trader wallet |
| `network_id` | number | Filter by network |
| `market_id` | number | Filter by on-chain market ID |
| `status` | string | `open`, `filled`, `cancelled`, `expired` |
| `limit` | number | 1–1000 (default 200) |
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

## Orderbook

### GET /markets/:marketId/orderbook

Aggregated orderbook for a CLOB market outcome. Returns open, non-expired orders with remaining size, grouped by price level.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Network ID (optional) |
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

### GET /events/:id/orderbook

Combined orderbook for all outcomes in a NegRisk event. Returns the orderbook per outcome market.

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

## Trades

### GET /markets/:marketId/trades

Recent CLOB trades for a market, ordered by timestamp descending.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Network ID (optional) |
| `outcome` | `0` or `1` | Filter by outcome (optional) |
| `limit` | number | 1–200 (default 50) |
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

## Events (NegRisk)

NegRisk events group multiple binary CLOB markets into a single mutually exclusive event (e.g. "Who will win the election?" with outcomes A, B, C, ...). Each outcome is a separate binary market.

### GET /events

List all events with nested outcome markets.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Filter by network (optional) |
| `state` | string | Filter by state (optional) |

**Response (`200`):**

```json
{
  "data": [
    {
      "id": "uuid-...",
      "ethEventId": "0x...",
      "networkId": 56,
      "title": "Who will win the 2028 election?",
      "description": "...",
      "slug": "2028-election",
      "imageUrl": "https://...",
      "state": "open",
      "resolvedOutcomeIndex": null,
      "expiresAt": "2028-11-05T00:00:00.000Z",
      "publishedAt": "2025-06-01T00:00:00.000Z",
      "createdAt": "2025-06-01T00:00:00.000Z",
      "outcomes": [
        {
          "marketId": "uuid-...",
          "ethMarketId": 42,
          "title": "Candidate A",
          "outcomeIndex": 0,
          "state": "open"
        },
        {
          "marketId": "uuid-...",
          "ethMarketId": 43,
          "title": "Candidate B",
          "outcomeIndex": 1,
          "state": "open"
        }
      ],
      "externalSources": []
    }
  ]
}
```

---

### GET /events/:id

Get a single event by UUID or slug.

**Response:** Same shape as a single item in `GET /events`, with an additional `slug` field per outcome.

---

### GET /events/:id/orderbook

Combined orderbook across all outcome markets. See [Orderbook](https://www.notion.so/Order-Book-API-Reference-Provisional-329c9e49da82806e822fc6b971862886?pvs=21) above.

---

## Existing Endpoints with CLOB Support

The following existing endpoints have been extended to support CLOB markets.

### GET /markets

Supports an additional filter:

| Param | Type | Description |
| --- | --- | --- |
| `execution_mode` | `0` or `1` | Filter by AMM (`0`) or CLOB (`1`) |

### GET /users/:address/portfolio

When called with `execution_mode=1`, returns CLOB positions with on-chain balances from the ConditionalTokens contract.

### GET /users/:address/markets

Includes CLOB position data when the market has `executionMode = 1`.

---

## Order Lifecycle

```
 Trader                         API                           Matcher (on-chain)
   │                             │                                   │
   │  POST /orders (signed)      │                                   │
   │ ──────────────────────────► │                                   │
   │                             │  validate, verify sig,            │
   │                             │  check balance/allowance          │
   │                             │  insert into clob_orders          │
   │  ◄─ { orderHash, status }   │                                   │
   │                             │  NOTIFY clob_orders_changed       │
   │                             │ ────────────────────────────────► │
   │                             │                                   │  load open orders
   │                             │                                   │  find matches
   │                             │                                   │  call exchange contract
   │                             │                                   │  (matchMultipleOrdersWithFees
   │                             │                                   │   or matchCrossMarketOrders)
   │                             │  ◄──── OrdersMatched event ────── │
   │                             │  update clob_orders + actions     │
   │                             │                                   │
   │  GET /orders/:hash          │                                   │
   │ ──────────────────────────► │                                   │
   │  ◄─ { status: "filled" }    │                                   │
```

1. **Place order** — trader signs an EIP-712 order and sends it to `POST /orders`.
2. **Validation** — the API verifies the signature, checks on-chain balance/allowance, and stores the order.
3. **Matching** — the matcher service loads open orders, finds compatible pairs/sets, and calls the exchange contract.
4. **Settlement** — the exchange contract atomically transfers shares and collateral on-chain.
5. **Sync** — the API listens for `OrdersMatched` / `OrderCancelled` events and updates order statuses.

---

## Errors

Common errors across all CLOB endpoints:

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

CLOB markets are currently deployed on **BNB Smart Chain**. See the main [API Reference](https://www.notion.so/API_REFERENCE.md#networks) for contract addresses.

This document describes the CLOB (Central Limit Order Book) REST API endpoints exposed by the Myriad Protocol API. The CLOB replaces the AMM for order matching — traders sign EIP-712 orders off-chain, the API validates and stores them, and an on-chain matcher settles fills through the `MyriadCTFExchange` contract.

Base URL:

- Production: [`https://api-v2.myriadprotocol.com/`](https://api-v2.myriadprotocol.com/)

## Authentication

All endpoints require an API key.

- Header: `x-api-key: <your_api_key>`
- Or Query: `?api_key=<your_api_key>`

To obtain an API key, please reach out to the Myriad team.

## Rate Limiting

- **Global:** 5 requests/second per IP and/or API key.
- **Order placement:** 10 orders per 10-second window per trader address.
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Concepts

### Execution Modes

Markets have an `execution_mode` field:

| Mode | Value | Description |
| --- | --- | --- |
| AMM | `0` | Trades executed via the on-chain Automated Market Maker |
| CLOB | `1` | Trades executed via the Central Limit Order Book |

CLOB endpoints only apply to markets with `execution_mode = 1`.

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
| **Direct** | A BUY order is matched against a SELL order on the same outcome. Bid price ≥ ask price. |
| **Mint** | Two BUY orders on opposite outcomes (YES + NO) whose prices sum to 1. New shares are minted from collateral. |
| **Merge** | Two SELL orders on opposite outcomes whose prices sum to 1. Shares are burned and collateral is returned. |
| **Cross-market** | (NegRisk only) N BUY-YES orders across all outcomes of an event whose prices sum to 1. |

---

## Orders

### POST /orders

Place a new CLOB order. The order is validated, the trader's signature is verified, on-chain balance/allowance is checked, and the order is persisted and pushed to the matcher.

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

List CLOB orders with optional filters.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `trader` | address | Filter by trader wallet |
| `network_id` | number | Filter by network |
| `market_id` | number | Filter by on-chain market ID |
| `status` | string | `open`, `filled`, `cancelled`, `expired` |
| `limit` | number | 1–1000 (default 200) |
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

## Orderbook

### GET /markets/:marketId/orderbook

Aggregated orderbook for a CLOB market outcome. Returns open, non-expired orders with remaining size, grouped by price level.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Network ID (optional) |
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

### GET /events/:id/orderbook

Combined orderbook for all outcomes in a NegRisk event. Returns the orderbook per outcome market.

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

## Trades

### GET /markets/:marketId/trades

Recent CLOB trades for a market, ordered by timestamp descending.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Network ID (optional) |
| `outcome` | `0` or `1` | Filter by outcome (optional) |
| `limit` | number | 1–200 (default 50) |
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

## Events (NegRisk)

NegRisk events group multiple binary CLOB markets into a single mutually exclusive event (e.g. "Who will win the election?" with outcomes A, B, C, ...). Each outcome is a separate binary market.

### GET /events

List all events with nested outcome markets.

**Query parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `network_id` | number | Filter by network (optional) |
| `state` | string | Filter by state (optional) |

**Response (`200`):**

```json
{
  "data": [
    {
      "id": "uuid-...",
      "ethEventId": "0x...",
      "networkId": 56,
      "title": "Who will win the 2028 election?",
      "description": "...",
      "slug": "2028-election",
      "imageUrl": "https://...",
      "state": "open",
      "resolvedOutcomeIndex": null,
      "expiresAt": "2028-11-05T00:00:00.000Z",
      "publishedAt": "2025-06-01T00:00:00.000Z",
      "createdAt": "2025-06-01T00:00:00.000Z",
      "outcomes": [
        {
          "marketId": "uuid-...",
          "ethMarketId": 42,
          "title": "Candidate A",
          "outcomeIndex": 0,
          "state": "open"
        },
        {
          "marketId": "uuid-...",
          "ethMarketId": 43,
          "title": "Candidate B",
          "outcomeIndex": 1,
          "state": "open"
        }
      ],
      "externalSources": []
    }
  ]
}
```

---

### GET /events/:id

Get a single event by UUID or slug.

**Response:** Same shape as a single item in `GET /events`, with an additional `slug` field per outcome.

---

### GET /events/:id/orderbook

Combined orderbook across all outcome markets. See [Orderbook](https://www.notion.so/Order-Book-API-Reference-Provisional-329c9e49da82806e822fc6b971862886?pvs=21) above.

---

## Existing Endpoints with CLOB Support

The following existing endpoints have been extended to support CLOB markets.

### GET /markets

Supports an additional filter:

| Param | Type | Description |
| --- | --- | --- |
| `execution_mode` | `0` or `1` | Filter by AMM (`0`) or CLOB (`1`) |

### GET /users/:address/portfolio

When called with `execution_mode=1`, returns CLOB positions with on-chain balances from the ConditionalTokens contract.

### GET /users/:address/markets

Includes CLOB position data when the market has `executionMode = 1`.

---

## Order Lifecycle

```
 Trader                         API                           Matcher (on-chain)
   │                             │                                   │
   │  POST /orders (signed)      │                                   │
   │ ──────────────────────────► │                                   │
   │                             │  validate, verify sig,            │
   │                             │  check balance/allowance          │
   │                             │  insert into clob_orders          │
   │  ◄─ { orderHash, status }   │                                   │
   │                             │  NOTIFY clob_orders_changed       │
   │                             │ ────────────────────────────────► │
   │                             │                                   │  load open orders
   │                             │                                   │  find matches
   │                             │                                   │  call exchange contract
   │                             │                                   │  (matchMultipleOrdersWithFees
   │                             │                                   │   or matchCrossMarketOrders)
   │                             │  ◄──── OrdersMatched event ────── │
   │                             │  update clob_orders + actions     │
   │                             │                                   │
   │  GET /orders/:hash          │                                   │
   │ ──────────────────────────► │                                   │
   │  ◄─ { status: "filled" }    │                                   │
```

1. **Place order** — trader signs an EIP-712 order and sends it to `POST /orders`.
2. **Validation** — the API verifies the signature, checks on-chain balance/allowance, and stores the order.
3. **Matching** — the matcher service loads open orders, finds compatible pairs/sets, and calls the exchange contract.
4. **Settlement** — the exchange contract atomically transfers shares and collateral on-chain.
5. **Sync** — the API listens for `OrdersMatched` / `OrderCancelled` events and updates order statuses.

---

## Errors

Common errors across all CLOB endpoints:

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

CLOB markets are currently deployed on **BNB Smart Chain**. See the main [API Reference](https://www.notion.so/API_REFERENCE.md#networks) for contract addresses.
