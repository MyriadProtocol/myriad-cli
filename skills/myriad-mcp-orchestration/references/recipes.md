# MCP Orchestration Recipes

## Minimal Startup

```bash
myriad mcp
```

## Read-First Sequence

1. `markets_list` with `state=open`, `limit=10`.
2. `markets_show` for final market target.
3. `wallet_balances` and `portfolio`.
4. `trade_buy` with `dryRun=true`.
5. `trade_buy` with `dryRun=false` only after validation.

## Order Book Sequence

1. `ob_markets_list` or `ob_markets_show`.
2. `ob_markets_orderbook` and `ob_markets_trades`.
3. `wallet_balances` and `ob_positions_list`.
4. `ob_limit_buy` / `ob_limit_sell` or `ob_market_buy` / `ob_market_sell` with `dryRun=true`.
5. `ob_orders_list`, `ob_orders_cancel`, `ob_orders_cancel_all`, `ob_orders_cancel_batch`, or `ob_positions_*` as needed.

## API Override Example (Per Tool Call)

Use only these override fields when needed:
- `apiBaseUrl`
- `apiKey`

## Troubleshooting

- Unknown field error (for example `privateKey`):
  Remove unsupported arguments; tool schemas are strict.
- Write tool risk:
  Always issue the same call with `dryRun=true` first.
- Empty structured data:
  Read `content[0].text` and parse JSON payload where available.
