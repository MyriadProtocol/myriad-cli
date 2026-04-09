# Myriad Order Book Recipes

Use launch-oriented, runtime-aware commands. If local defaults are not yet aligned with the active deployment, pass explicit chain/API/contract overrides before executing writes.

## Discovery

```bash
myriad --chain-id 56 ob markets list --state open --sort volume --order desc --limit 10 --json
```

```bash
myriad --chain-id 56 ob markets show 42 --json
```

```bash
myriad --chain-id 56 ob markets show will-btc-close-above-120k-on-friday --json
```

## Orderbook and Trades

```bash
myriad --chain-id 56 ob markets orderbook --market-id 42 --outcome-id 0 --json
```

```bash
myriad --chain-id 56 ob markets orderbook --market-id 42 --outcome-id 0 --render
```

```bash
myriad --chain-id 56 ob markets trades --market-id 42 --outcome-id 0 --limit 20 --json
```

## Limit Orders

```bash
myriad --chain-id 56 ob limit buy --market-id 42 --outcome-id 0 --price 0.55 --shares 5 --dry-run --json
```

```bash
myriad --chain-id 56 ob limit sell --market-slug will-btc-close-above-120k-on-friday --outcome-id 1 --price 0.61 --shares 3 --time-in-force GTC --json
```

## Market Orders

```bash
myriad --chain-id 56 ob market buy --market-id 42 --outcome-id 0 --shares 2 --dry-run --json
```

```bash
myriad --chain-id 56 ob market sell --market-id 42 --outcome-id 1 --value 25 --dry-run --json
```

## Orders

```bash
myriad --chain-id 56 ob orders list --json
```

```bash
myriad --chain-id 56 ob orders show 0xORDERHASH --json
```

```bash
myriad --chain-id 56 ob orders cancel 0xORDERHASH --dry-run --json
```

```bash
myriad --chain-id 56 ob orders cancel all --market-id 42 --dry-run --json
```

```bash
myriad --chain-id 56 ob orders cancel market --market-slug will-btc-close-above-120k-on-friday --dry-run --json
```

```bash
myriad --chain-id 56 ob orders cancel all --dry-run --json
```

```bash
myriad --chain-id 56 ob orders cancel batch 0xORDER1 0xORDER2 --dry-run --json
```

## Positions

```bash
myriad --chain-id 56 ob positions list --json
```

```bash
myriad --chain-id 56 ob positions split --market-id 42 --amount 10 --dry-run --json
```

```bash
myriad --chain-id 56 ob positions merge --market-slug will-btc-close-above-120k-on-friday --amount 5 --dry-run --json
```

```bash
myriad --chain-id 56 ob positions redeem --market-id 42 --dry-run --json
```

## Troubleshooting

- `Provide exactly one of --market-id or --market-slug`:
  Keep one selector only.
- Order remains unfilled:
  Inspect `ob markets orderbook`, recent trades, and the selected `--time-in-force`.
- Insufficient balance or allowance:
  Check `myriad wallet balances --json` and approval requirements before retrying.
- Runtime mismatch:
  Re-check chain, API base URL, and deployed order book addresses.
