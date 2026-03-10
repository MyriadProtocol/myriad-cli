---
name: myriad-wallet-ops
description: Set up and troubleshoot Myriad signer wallet operations, including keychain-backed encrypted storage and signer resolution precedence. Use when handling wallet setup, wallet loading failures, TTY/keychain issues, legacy wallet format errors, balance checks, or signer source precedence questions.
user-invocable: true
allowed-tools: Bash(myriad wallet *)
---

# Myriad Wallet Ops

## Overview

Use this skill for wallet onboarding and signer troubleshooting in Myriad CLI runtime workflows.

## Wallet Setup Flow

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
2. Environment `MYRIAD_PRIVATE_KEY` (or `PRIVATE_KEY`).
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

- Do not execute trade strategy in this skill; hand off to `/myriad-trade-execution`.
- Do not orchestrate MCP tool chains here; hand off to `/myriad-mcp-orchestration`.

## Reference

- Use [references/recipes.md](../../skills/myriad-wallet-ops/references/recipes.md) for wallet setup and incident-response command patterns.
