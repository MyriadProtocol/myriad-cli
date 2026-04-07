---
name: myriad-wallet-ops
description: Set up and troubleshoot Myriad signer wallet operations, including keychain-backed encrypted storage, signer resolution precedence, balance checks, and launch-readiness checks for AMM and order book workflows.
user-invocable: true
metadata: {"openclaw":{"requires":{"bins":["myriad"]},"emoji":"\uD83D\uDD11","os":["darwin","linux","win32"]}}
---

# Myriad Wallet Ops

## Overview

Use this skill for wallet onboarding and signer troubleshooting in Myriad CLI runtime workflows.

## Wallet Setup Flow

Keychain-backed wallet persistence is currently supported on macOS and Linux. On Windows, use `MYRIAD_PRIVATE_KEY` or `--private-key` for now.

1. Run interactive setup in a TTY.

```bash
myriad wallet setup
```

2. Import either private key or seed phrase.
3. Confirm encrypted wallet file is written to `~/.config/myriad/wallet.enc.json`.
4. Confirm master secret is stored in OS keychain backend.

## Signer Resolution Precedence

Resolve signer in this order.

1. Command-level `--private-key`.
2. Environment `MYRIAD_PRIVATE_KEY` (legacy `PRIVATE_KEY` fallback is still accepted for compatibility but should be avoided in new setups).
3. Configured keychain-backed wallet from `wallet setup`.

If none is available, fail closed and return signer configuration error.

## Operational Checks

1. Verify wallet address from configured storage when signer source is implicit.
2. Verify balances before trade or claim.

```bash
myriad wallet balances --json
```

```bash
myriad wallet balances --address 0xWalletAddress --json
```

## Order Book Launch Readiness

Before `myriad ob ...` writes, confirm:

1. Native BNB gas is available.
2. USD1 balance is sufficient for the intended workflow.
3. The signer is present and matches the execution wallet.
4. Runtime settings match the active BNB Smart Chain order book deployment rather than stale defaults.

## Troubleshooting Patterns

- `Interactive wallet setup requires a TTY terminal`:
  Re-run in an interactive terminal session.
- `KEYCHAIN_UNAVAILABLE`:
  Ensure OS keychain service is available and unlocked.
- `LEGACY_WALLET_FORMAT`:
  Re-run `myriad wallet setup`; no automatic migration is performed.
- Signer missing during trade/claim:
  Set up wallet or pass `--private-key` for one-off execution.

## Boundaries

- Do not execute detailed order book trading logic here; hand off to `$myriad-orderbook`.
- Do not execute trade strategy in this skill; hand off to `$myriad-trade-execution`.
- Do not orchestrate MCP tool chains here; hand off to `$myriad-mcp-orchestration`.

## Reference

- Use [references/recipes.md](references/recipes.md) for wallet setup and incident-response command patterns.
