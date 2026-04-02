---
name: myriad-market-discovery
description: Discover, filter, and inspect Myriad markets through `myriad markets ...` CLI workflows. Use when the task is to list open/closed/resolved AMM or general markets, drill into a market by id or slug, compare candidates, paginate/search/sort results, or produce JSON summaries before non-orderbook trade decisions.
user-invocable: true
allowed-tools: Bash(myriad markets *)
---

# Myriad Market Discovery

## Overview

Use this skill to find and evaluate markets through `myriad markets ...` before any AMM/general execution step. Keep outputs structured and decision oriented, defaulting to JSON.

## Workflow

1. Confirm runtime context before discovery.
- Do not assume orderbook/runtime defaults are correct for every deployment.
- Use explicit `--network-id` when resolving numeric ids across networks.
- Use `--json` unless the user explicitly requests human-readable output.

2. Start with broad market scans.
- Use `myriad markets list` with explicit `--state`, `--sort`, `--order`, `--page`, and `--limit`.
- Apply `--keyword` early when the user names a topic.

3. Drill into candidates.
- Use `myriad markets show <market>` for final inspection.
- Treat numeric `<market>` as market id and require `--network-id` when resolving by id.
- Treat non-numeric `<market>` as slug and omit `--network-id` unless needed for disambiguation.

4. Summarize for decision support.
- Return a compact ranking of candidates with rationale (liquidity, volume, expiry, and user intent fit).
- Call out missing details that block trading decisions.

5. Hand off order book discovery when relevant.
- If the user asks for `myriad ob ...`, order book depth, limit/market orders, or orderbook-specific markets, route to `/myriad-orderbook`.

## Command Patterns

Use these defaults unless the user specifies otherwise.

```bash
myriad markets list --state open --sort volume --order desc --page 1 --limit 20 --json
```

```bash
myriad markets list --state open --keyword btc --sort volume_24h --order desc --limit 10 --json
```

```bash
myriad markets show 164 --network-id 56 --json
```

```bash
myriad markets show will-btc-close-above-120k-on-friday --json
```

## Output Rules

- Prefer JSON-first responses for agent pipelines.
- Include the exact command used when reporting findings.
- When multiple markets match, provide the top choices and the tradeoff for each.
- If discovery results are empty, suggest concrete query refinements (state, keyword, sort, page).

## Boundaries

- Do not use this skill for `myriad ob markets ...`; hand off to `/myriad-orderbook`.
- Do not place trades in this skill; hand off to `/myriad-trade-execution`.
- Do not set up MCP in this skill; hand off to `/myriad-mcp-orchestration`.
- Do not troubleshoot wallet/keychain storage in this skill; hand off to `/myriad-wallet-ops`.

## Reference

- Use [references/recipes.md](../../skills/myriad-market-discovery/references/recipes.md) for command recipes and discovery troubleshooting.
