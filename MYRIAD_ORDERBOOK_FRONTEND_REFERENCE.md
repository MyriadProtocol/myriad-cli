### Contract Addresses

See the [Contract Addresses](https://docs.myriad.markets/builders/javascript-sdk#bnb-chain) page for deployed addresses on each chain.

---

## Architecture Overview

The CLOB system separates order matching from position settlement:

```
Trader (off-chain)          API                     Exchange (on-chain)
       │                     │                              │
       │ sign EIP-712 order  │                              │
       │ ──────────────────► │                              │
       │                     │  POST /orders                │
       │                     │  validate + store            │
       │                     │                              │
       │                     │  Matcher finds matches       │
       │                     │ ────────────────────────────►│
       │                     │  matchMultipleOrdersWithFees │
       │                     │                              │
       │                     │  ◄── OrdersMatched event ─── │
       │                     │                              │
       │  GET /orders/:hash  │                              │
       │ ──────────────────► │                              │
       │  ◄─ filled          │                              │
```

**Orders are signed off-chain and submitted to the API** (see the [CLOB API Reference](./MYRIAD_ORDER_BOOK_API_REFERENCE.md)). The matcher service settles fills on-chain.

---

## 1. Position Management

### Concepts

Each CLOB market has two outcomes: **YES (0)** and **NO (1)**. Outcome tokens are ERC1155 tokens managed by the `ConditionalTokens` contract. The token ID formula is:

```
tokenId = (marketId << 1) | outcomeId
```

- YES token: `(marketId << 1) | 0`
- NO token: `(marketId << 1) | 1`

### 1.1 Split Position

Deposit collateral to receive YES + NO outcome shares in equal amounts.

**Prerequisites:** Approve the ConditionalTokens contract to spend your collateral (ERC20).

```jsx
// 1. Approve collateral spending
const amount = '1000000'; // 1 USDC (6 decimals)
await erc20.approve({
  address: '0x<ConditionalTokensAddress>',
  amount,
});

// 2. Split: deposit collateral → receive YES + NO
await ct.splitPosition({
  marketId: 42,
  amount, // collateral amount in smallest unit
});
```

After splitting, you hold equal amounts of YES and NO shares. You can then sell one side on the CLOB to express a directional view.

### 1.2 Merge Positions

Burn equal amounts of YES + NO shares to recover collateral. The inverse of splitting.

```jsx
await ct.mergePositions({
  marketId: 42,
  amount: '1000000', // shares to merge (must hold this amount of both YES and NO)
});
```

### 1.3 Redeem Position (Resolved Market)

After a market is resolved, holders of the winning outcome can redeem their shares for collateral.

```jsx
await ct.redeemPositions({
  marketId: 42,
});
```

The contract pays out based on the resolved outcome. If you hold winning shares, you receive the full collateral amount. Losing shares are worth zero.

### 1.4 Redeem Voided Market

If a market is voided (cancelled), all participants can redeem their shares at the market's voided payout ratios.

```jsx
// Voided markets have custom payout ratios per outcome
// e.g., 50/50 returns half the collateral per share for each outcome
await ct.redeemPositions({
  marketId: 42,
});
```

> Note: The API provides a dedicated `POST /positions/redeem-voided` endpoint that generates the correct calldata for voided redemption via `redeemVoided(marketId)` on the ConditionalTokens contract.
> 

### 1.5 Get Token ID

Query the ERC1155 token ID for a specific outcome:

```jsx
const tokenId = await ct.getTokenId({
  marketId: 42,
  outcome: 0, // 0 = YES, 1 = NO
});
console.log('Token ID:', tokenId);
```

---

## 2. Order Management

### 2.1 EIP-712 Order Signing

Orders are signed off-chain using the EIP-712 standard. The order struct:

```jsx
const order = {
  trader: '0x<your_wallet_address>',
  marketId: 42,
  outcomeId: 0,          // 0 = YES, 1 = NO
  side: 0,               // 0 = BUY, 1 = SELL
  amount: '1000000000000000000',  // max shares (in wei)
  price: '500000000000000000',    // 0.50 per share (in 1e18)
  minFillAmount: '0',    // minimum fill size (0 = no minimum)
  nonce: '1',            // unique per order
  expiration: '0',       // 0 = GTC; unix timestamp for GTD
};
```

The EIP-712 domain:

```jsx
const domain = {
  name: 'MyriadCTFExchange',
  version: '1',
  chainId: 56,  // BNB Chain
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
```

**Signing with ethers.js:**

```jsx
import { ethers } from 'ethers';

const signer = new ethers.Wallet('<private_key>', provider);
const signature = await signer.signTypedData(domain, types, order);
```

### 2.2 Placing Orders via API

Once signed, submit the order to the Myriad Protocol API:

```jsx
const response = await fetch('<https://api-v2.myriadprotocol.com/orders>', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '<your_api_key>',
  },
  body: JSON.stringify({
    order,
    signature,
    network_id: 56,
    time_in_force: 'GTC', // GTC | GTD | FOK | FAK
  }),
});

const result = await response.json();
console.log(result);
// { orderHash: '0x...', status: 'open', timeInForce: 'GTC' }
```

See the [CLOB API Reference](https://www.notion.so/myriad-protocol-api/CLOB_API_REFERENCE.md) for full endpoint documentation.

### 2.3 Cancel Orders (On-Chain)

Cancel one or more orders directly on the exchange contract:

```jsx
await exchange.cancelOrders({
  orders: [order], // array of Order structs
});
```

Alternatively, cancel via the API (see `DELETE /orders/:orderHash` in the API reference).

### 2.4 Get Order Hash

Compute the EIP-712 hash of an order:

```jsx
const orderHash = await exchange.hashOrder({ order });
console.log('Order hash:', orderHash);
```

---

## 3. Approvals for Trading

Before placing orders, ensure the necessary approvals are in place.

### For BUY Orders (Collateral)

The exchange needs permission to move your ERC20 collateral:

```jsx
const approved = await erc20.isApproved({
  address: await polkamarkets.getAddress(),
  amount: '1000000000', // collateral amount needed
  spenderAddress: '0x<ExchangeAddress>',
});

if (!approved) {
  await erc20.approve({
    address: '0x<ExchangeAddress>',
    amount: '1000000000',
  });
}
```

### For SELL Orders (Outcome Shares)

The exchange needs ERC1155 approval to transfer your outcome tokens. This is done via `setApprovalForAll` on the ConditionalTokens contract (using the underlying Web3 contract):

```jsx
const ct_contract = ct.getContract();
await ct_contract.methods
  .setApprovalForAll('0x<ExchangeAddress>', true)
  .send({ from: await polkamarkets.getAddress() });
```

### For Splitting (Collateral)

When splitting, the ConditionalTokens contract needs to pull collateral:

```jsx
await erc20.approve({
  address: '0x<ConditionalTokensAddress>',
  amount: '1000000000',
});
```

---

## 4. Market Manager

### 4.1 Query Market State

```jsx
const market = await manager.getMarket({ marketId: 42 });
console.log(market);

const state = await manager.getMarketState({ marketId: 42 });
// 0 = open, 1 = closed, 2 = resolved

const isPaused = await manager.isMarketPaused({ marketId: 42 });

const collateral = await manager.getMarketCollateral({ marketId: 42 });

const resolvedOutcome = await manager.getMarketResolvedOutcome({ marketId: 42 });
// 0 = YES, 1 = NO, -1 = voided, -2 = unresolved

const tokenIds = await manager.getOutcomeTokenIds({ marketId: 42 });
// [yesTokenId, noTokenId]
```

### 4.2 Create Market (Admin)

```jsx
await manager.createMarket({
  closesAt: Math.floor(Date.now() / 1000) + 86400 * 7, // 1 week
  question: 'Will ETH hit $10k?',
  image: '<https://example.com/image.png>',
  feeModule: '0x<FeeModuleAddress>',
  oracle: '0x<OracleAddress>',
  oracleData: '0x',
});
```

### 4.3 Resolve Market (Admin)

```jsx
// Oracle-based resolution (permissionless if oracle reports result)
await manager.resolveMarket({ marketId: 42 });

// Admin resolution
await manager.adminResolveMarket({
  marketId: 42,
  outcomeId: 0, // YES wins
});
```

### 4.4 Pause / Unpause

```jsx
await manager.pauseMarket({ marketId: 42, paused: true });
await manager.pauseMarket({ marketId: 42, paused: false });
```

---

## 5. Fee Module

### 5.1 Query Fees

```jsx
// Get maker and taker fees at a specific price
const fees = await feeModule.getFeesAtPrice(42, '500000000000000000');
console.log(fees);
// { makerBps: 100, takerBps: 200 }  (1% maker, 2% taker)

// Get full fee schedule (100-element arrays)
const makerFees = await feeModule.getMarketMakerFees(42);
const takerFees = await feeModule.getMarketTakerFees(42);
```

Fee tiers are defined per-market and can vary by price bucket. Each bucket covers 1% of the price range (0–1). The fee is expressed in basis points (BPS), where 100 BPS = 1%.

### 5.2 Set Market Fees (Admin)

```jsx
// Flat fee: 1% maker, 2% taker at all price levels
const makerFeeBps = Array(100).fill(100);  // 1%
const takerFeeBps = Array(100).fill(200);  // 2%

await feeModule.setMarketFees({
  marketId: 42,
  makerFeeBps,
  takerFeeBps,
});
```

### 5.3 Fee Accounting

```jsx
// Check accrued fees
const accrued = await feeModule.accruedFees('0x<CollateralTokenAddress>');
console.log('Accrued fees:', accrued);

// Withdraw fees to treasury (FEE_ADMIN only)
await feeModule.withdrawFees(
  '0x<CollateralTokenAddress>',
  '0x<TreasuryAddress>',
  accrued,
);
```

---

## 6. NegRisk Events (Multi-Outcome Markets)

NegRisk events group multiple binary markets into a single mutually exclusive event. For example, "Who will win the election?" might have outcomes: A, B, C, Other. Each outcome is a separate binary CLOB market.

NegRisk operations use the `NegRiskAdapter` contract, which wraps collateral into `WrappedCollateral` (WCOL) and manages the split/merge lifecycle.

> Note: The NegRiskAdapter does not yet have a dedicated JS binding class. Use the API position endpoints or interact with the contract via the ABI directly.
> 

### 6.1 Split Position (NegRisk)

Split underlying collateral into YES + NO for a specific outcome within an event. The adapter wraps collateral into WCOL, then splits:

**Via API:**

```jsx
const response = await fetch('<https://api-v2.myriadprotocol.com/positions/neg-risk/split>', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '<your_api_key>',
  },
  body: JSON.stringify({
    event_id: '0x<64 hex chars>',
    outcome_index: 0,
    amount: '1000000',
    network_id: 56,
  }),
});

const { to, calldata, value } = await response.json();
// Sign and submit the transaction
```

### 6.2 Merge Position (NegRisk)

Merge YES + NO shares for one outcome back into underlying collateral:

**Via API:**

```jsx
const response = await fetch('<https://api-v2.myriadprotocol.com/positions/neg-risk/merge>', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': '<your_api_key>',
  },
  body: JSON.stringify({
    event_id: '0x<64 hex chars>',
    outcome_index: 0,
    amount: '1000000',
    network_id: 56,
  }),
});

const { to, calldata, value } = await response.json();
```

### 6.3 Cross-Market Matching

When BUY-YES orders across all outcomes of a NegRisk event have prices that sum to 1, they can be matched in a single cross-market trade. This is handled automatically by the matcher — no client-side action needed.

---

## 7. Admin Registry (Roles)

The CLOB system uses role-based access control:

| Role | Description |
| --- | --- |
| `DEFAULT_ADMIN_ROLE` | Full admin, can grant/revoke roles |
| `MARKET_ADMIN_ROLE` | Create markets and NegRisk events |
| `OPERATOR_ROLE` | Match orders on the exchange |
| `FEE_ADMIN_ROLE` | Set fees and withdraw treasury |
| `RESOLUTION_ADMIN_ROLE` | Resolve and void markets |

```jsx
// Check if an address has a role
const hasRole = await adminRegistry.hasRole({
  role: ethers.keccak256(ethers.toUtf8Bytes('OPERATOR_ROLE')),
  account: '0x...',
});

// Grant a role (requires DEFAULT_ADMIN_ROLE)
await adminRegistry.grantRole({
  role: ethers.keccak256(ethers.toUtf8Bytes('OPERATOR_ROLE')),
  account: '0x<OperatorAddress>',
});
```

---

## Complete Example: CLOB Trading Flow

```jsx
import * as polkamarketsjs from 'polkamarkets-js';
import { ethers } from 'ethers';

// 1. Initialize
const polkamarkets = new polkamarketsjs.Application({
  web3Provider: '<https://bsc-dataseed.binance.org>',
  web3PrivateKey: '<your_private_key>',
});

const ct = polkamarkets.getConditionalTokensContract({
  contractAddress: '0x<ConditionalTokensAddress>',
});

const erc20 = polkamarkets.getERC20Contract({
  contractAddress: '0x<CollateralAddress>',
});

// 2. Approve collateral for splitting
await erc20.approve({
  address: '0x<ConditionalTokensAddress>',
  amount: '1000000', // 1 USDC
});

// 3. Split collateral into YES + NO shares
await ct.splitPosition({
  marketId: 42,
  amount: '1000000',
});
console.log('Split complete: now hold YES + NO shares');

// 4. Approve exchange to transfer outcome shares (for sell orders)
const ctContract = ct.getContract();
await ctContract.methods
  .setApprovalForAll('0x<ExchangeAddress>', true)
  .send({ from: await polkamarkets.getAddress() });

// 5. Sign a SELL order for NO shares (expressing a YES view)
const provider = new ethers.JsonRpcProvider('<https://bsc-dataseed.binance.org>');
const signer = new ethers.Wallet('<your_private_key>', provider);

const order = {
  trader: await polkamarkets.getAddress(),
  marketId: 42,
  outcomeId: 1,          // NO
  side: 1,               // SELL
  amount: '1000000',     // 1 share
  price: '400000000000000000', // 0.40 per share
  minFillAmount: '0',
  nonce: '1',
  expiration: '0',       // GTC
};

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

const signature = await signer.signTypedData(domain, types, order);

// 6. Submit order to API
const res = await fetch('<https://api-v2.myriadprotocol.com/orders>', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': '<key>' },
  body: JSON.stringify({ order, signature, network_id: 56, time_in_force: 'GTC' }),
});
console.log(await res.json());
// { orderHash: '0x...', status: 'open', timeInForce: 'GTC' }

// 7. After market resolves — redeem winning shares
// (Only works if the market has been resolved)
await ct.redeemPositions({ marketId: 42 });
console.log('Winnings redeemed!');
```

---

## API Reference Quick Links

| Endpoint | Description |
| --- | --- |
| `POST /orders` | Place a signed CLOB order |
| `GET /orders` | List orders with filters |
| `GET /orders/:hash` | Get a single order |
| `DELETE /orders/:hash` | Cancel an order |
| `GET /markets/:id/orderbook` | Aggregated orderbook |
| `GET /markets/:id/trades` | Recent trades |
| `GET /events/:id/orderbook` | NegRisk event orderbook |
| `POST /positions/split` | Split collateral calldata |
| `POST /positions/merge` | Merge positions calldata |
| `POST /positions/redeem` | Redeem resolved calldata |
| `POST /positions/redeem-voided` | Redeem voided calldata |
| `POST /positions/neg-risk/split` | NegRisk split calldata |
| `POST /positions/neg-risk/merge` | NegRisk merge calldata |

Full API documentation: [CLOB API Reference](https://www.notion.so/myriad-protocol-api/CLOB_API_REFERENCE.md)