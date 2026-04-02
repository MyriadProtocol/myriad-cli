This guide walks through the end-to-end flow for trading on Myriad's Order Book. It covers authentication, market discovery, order placement, position management, and redemption.

For detailed reference, see:

[Order Book API Reference (Provisional)](./MYRIAD_ORDER_BOOK_API_REFERENCE.md)

Full REST API documentation (orders, orderbook, trades, positions, events)

[Order Book Frontend Docs (Provisional)](./MYRIAD_ORDERBOOK_FRONTEND_REFERENCE.md)

JavaScript SDK for on-chain interactions (split, merge, redeem, approvals)

---

## Overview

The Myriad Order Book is a hybrid off-chain/on-chain order book for prediction markets. Traders sign orders off-chain using EIP-712 and submit them to the REST API. A matcher service finds compatible orders and settles them atomically on-chain via the `MyriadCTFExchange` contract.

Each market has two outcomes. Example: **YES (0)** and **NO (1)**. Outcome shares are ERC1155 tokens. Collateral is an ERC20 token (e.g. USDC, USD1).

```
┌──────────--┐      POST /orders       ┌───────────-┐     matchOrders()    ┌──────────────-┐
│  Trader    │ ──────────────────────► │    API     │ ───────────────────► │  Exchange     │
│ (off-chain │  signed EIP-712 order   │  validates │  settles on-chain    │  (on-chain)   │
│  signing)  │ ◄────────────────────── │  + stores  │ ◄─────────────────   │  transfers    │
│            │   { orderHash, status } │            │   OrdersMatched      │  shares +     │
└──────────--┘                         └───────────-┘   event              │  collateral   │
                                                                           └──────────────-┘
```

---

## 1. Authentication & Order Signing

### API Authentication

All API requests require an API key:

```bash
curl -H "x-api-key: YOUR_API_KEY" <https://api-v2.myriadprotocol.com/markets>
```

### Order Signing (EIP-712)

Orders are signed off-chain using the EIP-712 typed data standard. You can sign with either **polkamarkets-js** or **ethers.js**.

### Order Structure

```jsx
const order = {
  trader: '0xYourWallet',
  marketId: '42',
  outcomeId: 0,                        // 0 = YES, 1 = NO
  side: 0,                             // 0 = BUY, 1 = SELL
  amount: '1000000000000000000',       // shares in wei
  price: '500000000000000000',         // 0.50 in 1e18
  minFillAmount: '0',
  nonce: '1',
  expiration: '0',                     // 0 = GTC
};
```

**Price scale:** prices are integers in `[1, 1e18]` where `1e18 = 1.00` (one full collateral token per share).

### Option A: Using the SDK

```jsx
import * as polkamarketsjs from 'polkamarkets-js';

const polkamarkets = new polkamarketsjs.Application({
  web3Provider: '<https://bsc-dataseed.binance.org>',
  web3PrivateKey: '<your_private_key>',
});

const exchange = polkamarkets.getMyriadCTFExchangeContract({
  contractAddress: '0x<ExchangeAddress>',
});

// Compute the EIP-712 order hash
const orderHash = await exchange.hashOrder({ order });

// Sign using the web3 provider (eth_signTypedData_v4)
const traderAddress = await polkamarkets.getAddress();
const web3 = polkamarkets.web3;

const typedData = JSON.stringify({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Order: [
      { name: 'trader', type: 'address' },
      { name: 'marketId', type: 'uint256' },
      { name: 'outcomeId', type: 'uint8' },
      { name: 'side', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
      { name: 'price', type: 'uint256' },
      { name: 'minFillAmount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiration', type: 'uint256' },
    ],
  },
  primaryType: 'Order',
  domain: {
    name: 'MyriadCTFExchange',
    version: '1',
    chainId: 56,
    verifyingContract: '0x<ExchangeAddress>',
  },
  message: order,
});

const signature = await web3.currentProvider.request({
  method: 'eth_signTypedData_v4',
  params: [traderAddress, typedData],
});
```

### Option B: Using ethers.js

```jsx
import { ethers } from 'ethers';

const domain = {
  name: 'MyriadCTFExchange',
  version: '1',
  chainId: 56,
  verifyingContract: '0x<ExchangeAddress>',
};

const types = {
  Order: [
    { name: 'trader', type: 'address' },
    { name: 'marketId', type: 'uint256' },
    { name: 'outcomeId', type: 'uint8' },
    { name: 'side', type: 'uint8' },
    { name: 'amount', type: 'uint256' },
    { name: 'price', type: 'uint256' },
    { name: 'minFillAmount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
  ],
};

const signer = new ethers.Wallet('<private_key>', provider);
const signature = await signer.signTypedData(domain, types, order);
```

---

## 2. Fetching Markets

### List CLOB Markets

Use `execution_mode=1` to filter for CLOB markets:

```bash
GET /markets?execution_mode=1&state=open&sort=volume_24h&limit=20
```

```jsx
const res = await fetch(
  '<https://api-v2.myriadprotocol.com/markets?execution_mode=1&state=open&sort=volume_24h&limit=20>',
  { headers: { 'x-api-key': 'YOUR_API_KEY' } }
);
const { data, pagination } = await res.json();
```

Each market includes `id` (on-chain market ID), `networkId`, `title`, `outcomes`, `fees`, and more.

### Get Market Orderbook

```bash
GET /markets/42/orderbook?network_id=56&outcome=0
```

Returns aggregated bids and asks as `[price, remaining_amount]` tuples sorted by best price.

### List NegRisk Events

For multi-outcome markets (e.g. "Who wins the election?"):

```bash
GET /events?network_id=56&state=open
```

Each event contains an `outcomes` array linking to individual binary markets.

---

## 3. Placing Orders

### Prerequisites

Before placing orders, ensure the correct approvals are in place:

| Order side | What to approve | Spender |
| --- | --- | --- |
| **BUY** | ERC20 collateral (`approve`) | Exchange contract |
| **SELL** | ERC1155 outcome shares (`setApprovalForAll`) | Exchange contract |

```jsx
// For BUY orders: approve collateral
await erc20.approve({
  address: '0x<ExchangeAddress>',
  amount: '1000000000',
});

// For SELL orders: approve outcome shares
await ct.getContract().methods
  .setApprovalForAll('0x<ExchangeAddress>', true)
  .send({ from: traderAddress });
```

### Submit an Order

```jsx
const res = await fetch('<https://api-v2.myriadprotocol.com/orders>', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'YOUR_API_KEY',
  },
  body: JSON.stringify({
    order,
    signature,
    network_id: 56,
    time_in_force: 'GTC',  // GTC | GTD | FOK | FAK
  }),
});

const { orderHash, status } = await res.json();
```

The API validates the signature, checks on-chain balance/allowance, and stores the order. The matcher picks it up automatically.

### Time-in-Force Options

| TIF | Behaviour |
| --- | --- |
| **GTC** | Good-til-cancelled. `expiration` must be `0`. |
| **GTD** | Good-til-date. `expiration` is a unix timestamp. |
| **FOK** | Fill-or-kill. Must fill fully or the order is cancelled. |
| **FAK** | Fill-and-kill. Partial fill allowed; remainder cancelled. |

### Cancel an Order

```bash
DELETE /orders/0x<orderHash>
```

With the original order + signature in the request body for ownership verification.

---

## 4. Splitting & Merging Positions

Splitting converts collateral into equal amounts of YES + NO shares. Merging is the inverse.

### Split (Collateral → YES + NO)

```jsx
// Via SDK (direct on-chain call)
await erc20.approve({ address: '0x<ConditionalTokens>', amount: '1000000' });
await ct.splitPosition({ marketId: 42, amount: '1000000' });

// Via API (returns calldata to sign)
const res = await fetch('<https://api-v2.myriadprotocol.com/positions/split>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'YOUR_API_KEY' },
  body: JSON.stringify({ market_id: 42, amount: '1000000', network_id: 56 }),
});
const { to, calldata, value } = await res.json();
```

### Merge (YES + NO → Collateral)

```jsx
// Via SDK
await ct.mergePositions({ marketId: 42, amount: '1000000' });

// Via API
const res = await fetch('<https://api-v2.myriadprotocol.com/positions/merge>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'YOUR_API_KEY' },
  body: JSON.stringify({ market_id: 42, amount: '1000000', network_id: 56 }),
});
```

### NegRisk Split & Merge

For multi-outcome events, use the NegRisk endpoints which handle collateral wrapping automatically:

```jsx
// Split for a specific outcome within an event
const res = await fetch('<https://api-v2.myriadprotocol.com/positions/neg-risk/split>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'YOUR_API_KEY' },
  body: JSON.stringify({
    event_id: '0x<bytes32>',
    outcome_index: 0,
    amount: '1000000',
    network_id: 56,
  }),
});
```

---

## 5. Redeeming Positions

After a market resolves, winning shareholders can redeem their shares for collateral.

### Redeem Winning Shares

```jsx
// Via SDK
await ct.redeemPositions({ marketId: 42 });

// Via API (returns calldata)
const res = await fetch('<https://api-v2.myriadprotocol.com/positions/redeem>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'YOUR_API_KEY' },
  body: JSON.stringify({ market_id: 42, network_id: 56 }),
});
const { to, calldata, value } = await res.json();
```

### Redeem Voided Market

If a market is voided (cancelled), shares are redeemable at the market's voided payout ratios:

```jsx
// Via API
const res = await fetch('<https://api-v2.myriadprotocol.com/positions/redeem-voided>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': 'YOUR_API_KEY' },
  body: JSON.stringify({ market_id: 42, network_id: 56 }),
});
```

### Check Portfolio

To see which positions are redeemable:

```bash
GET /users/0xYourWallet/portfolio?execution_mode=1
GET /users/0xYourWallet/markets?state=resolved
```

The response includes `winningsToClaim` and `winningsClaimed` flags per position.

---

## Quick Reference

| Step | Method | Endpoint / SDK |
| --- | --- | --- |
| List CLOB markets | GET | `/markets?execution_mode=1` |
| View orderbook | GET | `/markets/:id/orderbook` |
| View trades | GET | `/markets/:id/trades` |
| Place order | POST | `/orders` |
| Check order | GET | `/orders/:hash` |
| Cancel order | DELETE | `/orders/:hash` |
| Split position | POST | `/positions/split` or `ct.splitPosition()` |
| Merge position | POST | `/positions/merge` or `ct.mergePositions()` |
| Redeem winnings | POST | `/positions/redeem` or `ct.redeemPositions()` |
| Redeem voided | POST | `/positions/redeem-voided` |
| NegRisk split | POST | `/positions/neg-risk/split` |
| NegRisk merge | POST | `/positions/neg-risk/merge` |
| User portfolio | GET | `/users/:address/portfolio` |
