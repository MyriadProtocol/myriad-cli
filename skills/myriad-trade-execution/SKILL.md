---
name: myriad-trade-execution
description: Execute Myriad buy/sell flows safely with preflight checks, dry-run quoting, allowance strategy, and BNB-chain stablecoin auto-swap awareness. Use when the task includes `trade buy`, `trade sell`, swap-aware execution planning, slippage/approval configuration, or trade error recovery.
---

# Myriad Trade Execution

## Overview

Use this skill to convert a trade intent into a safe, executable command sequence. Enforce preflight checks before signing transactions.

## Preflight Checklist

Run this checklist before any write action.

1. Validate wallet accessibility.
- Confirm the signer exists via configured wallet, `--private-key`, or `MYRIAD_PRIVATE_KEY`.
- If missing, route to `$myriad-wallet-ops`.

2. Validate balances.
- Run `myriad wallet balances --json`.
- Confirm native gas token balance and relevant collateral/stable token balances.

3. Validate market target.
- Resolve market with `myriad markets show` when the identifier is uncertain.
- Ensure only one selector is used: `--market-id` or `--market-slug`.

4. Validate execution parameters.
- Use explicit `--slippage` when user gives risk constraints.
- Start with `--dry-run` for first pass.

## Buy Workflow

1. Quote first.

```bash
myriad trade buy --market-id 164 --outcome-id 0 --value 25 --dry-run --json
```

2. Configure allowances deliberately.
- Per-action approval: `--allowance <amount|UNLIMITED>`.
- Auto-swap approval: `--swap-allowance <amount|UNLIMITED>`.
- Global override: root `--allowance` or `MYRIAD_ALLOWANCE`.

3. Decide auto-swap behavior.
- On BNB Chain, when spend token is USDT/USD1 and balance is insufficient, auto-swap may use PancakeSwap.
- Disable with `--no-auto-swap` when strict no-swap behavior is required.

4. Execute only after quote review.

```bash
myriad trade buy --market-id 164 --outcome-id 0 --value 25 --slippage 0.05 --json
```

## Sell Workflow

Use either target value or shares.

```bash
myriad trade sell --market-id 164 --outcome-id 0 --value 15 --dry-run --json
```

```bash
myriad trade sell --market-id 164 --outcome-id 0 --shares 20 --json
```

## Failure Handling

- Network mismatch error:
  Align runtime `--chain-id` and deployment addresses with market network.
- Missing signer error:
  Run `myriad wallet setup` or pass `--private-key` for one-off execution.
- Approval-related failure:
  Increase `--allowance` / `--swap-allowance` or use `UNLIMITED` with explicit user intent.
- Slippage failure:
  Re-quote, then adjust `--slippage` conservatively.

## Boundaries

- Do not run claim flows here; hand off to `$myriad-claims`.
- Do not define MCP server orchestration here; hand off to `$myriad-mcp-orchestration`.

## Reference

- Use [references/recipes.md](references/recipes.md) for buy/sell and swap-aware command recipes.
