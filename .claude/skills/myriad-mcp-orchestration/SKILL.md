---
name: myriad-mcp-orchestration
description: Configure and operate Myriad as an MCP server over STDIO with safe tool-call orchestration. Use when tasks involve myriad mcp, MCP client configuration, tool sequencing, per-call API overrides (apiBaseUrl, apiKey), or safe handling of write-capable MCP tools.
user-invocable: true
allowed-tools: Bash(myriad mcp)
---

# Myriad MCP Orchestration

## Overview

Use this skill to run Myriad through MCP clients with predictable tool sequencing and safe write execution behavior.

## Server Setup

1. Launch MCP server.

```bash
myriad mcp
```

2. Use STDIO MCP client configuration.

```json
{
  "mcpServers": {
    "myriad": {
      "command": "myriad",
      "args": ["mcp"]
    }
  }
}
```

3. Confirm tool inventory matches expected names.
- `markets_list`, `markets_show`
- `users_portfolio`, `portfolio`
- `wallet_balances`
- `swap_stable`
- `trade_buy`, `trade_sell`
- `claim_winnings`, `claim_voided`, `claim_all`
- `ob_markets_list`, `ob_markets_show`, `ob_markets_orderbook`, `ob_markets_trades`
- `ob_events_list`, `ob_events_show`, `ob_events_orderbook`, `ob_events_actions`
- `ob_limit_buy`, `ob_limit_sell`, `ob_market_buy`, `ob_market_sell`
- `ob_orders_list`, `ob_orders_show`, `ob_orders_cancel`, `ob_orders_cancel_all`, `ob_orders_cancel_batch`
- `ob_positions_list`, `ob_positions_split`, `ob_positions_merge`, `ob_positions_neg_risk_split`, `ob_positions_neg_risk_merge`, `ob_positions_redeem`

## Safe Tool Orchestration

1. Discover first, write second.
- Call read tools (`markets_*`, `portfolio`, `wallet_balances`) before writes.

2. Use `dryRun` for all write-capable tools on first attempt.
- `swap_stable`, `trade_buy`, `trade_sell`, `claim_winnings`, `claim_voided`, `claim_all`.

3. Re-run without `dryRun` only after validating quote/payload assumptions.

4. Keep signer control server scoped.
- Never assume private key override is allowed per tool call.
- Only `apiBaseUrl` and `apiKey` are valid per-call API overrides.

## Safe Sequences

For AMM workflows:

1. `markets_list` or `markets_show`
2. `wallet_balances` and `portfolio`
3. `trade_buy` or `trade_sell` with `dryRun=true`
4. Repeat the validated write call with `dryRun=false`

For order book workflows:

1. `ob_events_list`/`ob_events_show` for grouped events, or `ob_markets_list`/`ob_markets_show` for binary markets
2. `ob_events_orderbook`/`ob_events_actions` for event context, or `ob_markets_orderbook`/`ob_markets_trades` for a sibling market
3. `wallet_balances` and `ob_positions_list`
4. `ob_limit_*` or `ob_market_*` with `dryRun=true`
5. `ob_orders_*`, `ob_positions_*`, and `ob_positions_neg_risk_*` for post-trade management

## API Override Rules

- Allowed per call: `apiBaseUrl`, `apiKey`.
- Disallowed per call: signer private key and other undeclared fields.
- If a call returns schema validation error, remove unknown fields and retry.

## Failure Handling

- Tool call `isError=true`:
  Inspect returned text and structured payload, then retry with corrected arguments.
- Unknown field rejection:
  Validate against tool input schema and only pass documented keys.
- Server startup issues:
  Confirm CLI is installed/build is available and command path is correct.

## Boundaries

- Do not perform wallet keychain remediation here; hand off to `/myriad-wallet-ops`.
- For detailed trading policy decisions, hand off to `/myriad-trade-execution`.
- For order book-specific execution policy, hand off to `/myriad-orderbook`.

## Reference

- Use [references/recipes.md](../../skills/myriad-mcp-orchestration/references/recipes.md) for MCP-safe call ordering and payload patterns.
