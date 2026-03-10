---
name: myriad-mcp-orchestration
description: Configure and operate Myriad as an MCP server over STDIO with safe tool-call orchestration. Use when tasks involve `myriad mcp`, MCP client configuration, tool sequencing, per-call API overrides (`apiBaseUrl`, `apiKey`), or safe handling of write-capable MCP tools.
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

## Safe Tool Orchestration

1. Discover first, write second.
- Call read tools (`markets_*`, `portfolio`, `wallet_balances`) before writes.

2. Use `dryRun` for all write-capable tools on first attempt.
- `swap_stable`, `trade_buy`, `trade_sell`, `claim_winnings`, `claim_voided`, `claim_all`.

3. Re-run without `dryRun` only after validating quote/payload assumptions.

4. Keep signer control server scoped.
- Never assume private key override is allowed per tool call.
- Only `apiBaseUrl` and `apiKey` are valid per-call API overrides.

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

- Do not perform wallet keychain remediation here; hand off to `$myriad-wallet-ops`.
- For detailed trading policy decisions, hand off to `$myriad-trade-execution`.

## Reference

- Use [references/recipes.md](references/recipes.md) for MCP-safe call ordering and payload patterns.
