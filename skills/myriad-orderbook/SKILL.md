---
name: myriad-orderbook
description: Operate Myriad's full order book workflow through `myriad ob ...`. Use when the task involves order book event or market discovery, event/orderbook/trade inspection, `--render`, limit or market orders, open-order management, bulk cancel by market, or order book position actions like list, split, merge, NegRisk split/merge, and redeem.
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["myriad"]},"primaryEnv":"MYRIAD_API_KEY","emoji":"\uD83D\uDCD2","os":["darwin","linux","win32"]}}
---

# Myriad Order Book

## Overview

Use this skill for the full `myriad ob ...` workflow: discover events and markets, inspect depth, place orders, manage open orders, and manage positions.

Treat the order book as a production BNB Smart Chain workflow by default. Use explicit runtime overrides only when targeting a non-production deployment.

## Runtime Sanity

Before execution:

1. Verify the active order book runtime.
- Prefer explicit runtime verification over assumptions.
- Pin `--chain-id`, API base URL, and contract addresses only when you intentionally need a non-default deployment.

2. Verify signer and balances.
- Confirm the signer exists.
- Confirm native BNB gas is available.
- Confirm USD1 balance is sufficient for buy/split flows.

3. Keep selectors clean.
- Use exactly one of `--market-id` or `--market-slug`.
- Use explicit `--outcome-id` when acting on a specific outcome.
- For event position actions, use exactly one of `--event` or `--neg-risk-id` and set `--outcome-index`.

## Recommended Workflow

1. Discover markets.
- Start with `myriad ob events list` for grouped multi-outcome events.
- Use `myriad ob events show` to inspect sibling markets before trading an event outcome.
- Start with `myriad ob markets list`.
- Use `myriad ob markets show` for final market inspection.

2. Inspect liquidity before writing.
- Use `myriad ob events orderbook --render` for NegRisk event-level depth.
- Use `myriad ob events actions` for event-level taker trade history.
- Use `myriad ob markets orderbook` for current depth.
- Use `myriad ob markets orderbook --render` for a terminal ladder view.
- Use `myriad ob markets trades` to inspect recent prints and last-price context.

3. Dry-run writes first.
- Use `--dry-run` before any order or position write.

4. Manage the lifecycle after submit.
- Use `myriad ob orders list/show` to inspect status.
- Use `myriad ob orders cancel` for single orders.
- Use `myriad ob orders cancel batch <hash...>` for selected-order cleanup.
- Use `myriad ob orders cancel market --market-id|--market-slug` for explicit market-scoped cleanup.
- Use `myriad ob orders cancel all` for all-markets cleanup, or keep `myriad ob orders cancel all --market-id|--market-slug` for compatibility-scoped cleanup.

5. Manage positions explicitly.
- `myriad ob positions list` for portfolio consultation.
- `myriad ob positions split` for collateral -> YES + NO.
- `myriad ob positions merge` for YES + NO -> collateral.
- `myriad ob positions neg-risk split` and `merge` for NegRisk event outcome positions.
- `myriad ob positions redeem` for settled outcomes.

## Command Patterns

```bash
myriad --chain-id 56 ob markets list --state open --limit 10 --json
```

```bash
myriad --chain-id 56 ob events list --state open --json
```

```bash
myriad --chain-id 56 ob events orderbook 2028-election --render
```

```bash
myriad --chain-id 56 ob markets orderbook --market-id 42 --outcome-id 0 --render
```

```bash
myriad --chain-id 56 ob limit buy --market-id 42 --outcome-id 0 --price 0.55 --shares 5 --dry-run --json
```

```bash
myriad --chain-id 56 ob market sell --market-id 42 --outcome-id 1 --shares 2 --dry-run --json
```

```bash
myriad --chain-id 56 ob orders cancel batch 0xORDER1 0xORDER2 --dry-run --json
```

```bash
myriad --chain-id 56 ob orders cancel market --market-slug will-btc-close-above-120k --dry-run --json
```

```bash
myriad --chain-id 56 ob orders cancel all --dry-run --json
```

```bash
myriad --chain-id 56 ob positions neg-risk split --event 2028-election --outcome-index 0 --amount 10 --dry-run --json
```

## Execution Guidance

- Limit orders:
  Use explicit `--price` and `--shares`; set `--time-in-force` deliberately and add `--expiration` when using GTD-style workflows.
- Market orders:
  Treat `--shares` as the native exact mode.
  Treat `--value` as a best-effort convenience derived from the current book snapshot, not a hard guaranteed spend or proceeds cap.
- Approvals:
  Buy flows need ERC20 allowance.
  Sell flows need ERC1155 approval.

## Failure Handling

- Wrong chain or deployment:
  Re-check chain, API base URL, and order book contract settings before retrying.
- Missing signer:
  Route to `$myriad-wallet-ops`.
- Missing USD1 or gas:
  Top up balances before retrying.
- Missing approvals:
  Re-run with explicit allowance strategy or allow the standard approval flow.
- Insufficient depth:
  Reduce order size, switch to limit pricing, or wait for the book to refill.
- Selector mismatch:
  Keep only one of `--market-id` or `--market-slug`.
- Event selector mismatch:
  Keep only one of `--event` or `--neg-risk-id`.

## Boundaries

- Do not use `$myriad-trade-execution` for `myriad ob ...`; this skill owns the order book workflow.
- For wallet/keychain repair, hand off to `$myriad-wallet-ops`.
- For MCP sequencing details, hand off to `$myriad-mcp-orchestration`.

## Reference

- Use [references/recipes.md](references/recipes.md) for discovery, render, order, cancel, and position recipes.
