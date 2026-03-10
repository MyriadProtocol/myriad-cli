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
