# Trade Execution Recipes

## Buy Recipes

```bash
myriad trade buy --market-id 164 --network-id 56 --outcome-id 0 --value 25 --dry-run --json
```

```bash
myriad trade buy --market-id 164 --network-id 56 --outcome-id 0 --value 25 --allowance UNLIMITED --swap-allowance 100 --json
```

```bash
myriad trade buy --market-id 164 --network-id 56 --outcome-id 0 --value 25 --no-auto-swap --json
```

## Sell Recipes

```bash
myriad trade sell --market-id 164 --network-id 56 --outcome-id 0 --value 15 --slippage 0.05 --json
```

```bash
myriad trade sell --market-id 164 --network-id 56 --outcome-id 0 --shares 20 --json
```

## Swap-Related Recipe

```bash
myriad swap stable --from usdt --to usd1 --amount-out 50 --dry-run --json
```

## Troubleshooting

- `Provide exactly one of --market-id or --market-slug`:
  Keep only one market selector in buy/sell commands.
- `Wallet signer is not configured`:
  Run `myriad wallet setup` or pass `--private-key`.
- `Market network mismatch`:
  Set matching `--chain-id` and network-specific contracts.
- Gas failures:
  Top up BNB before retries.
