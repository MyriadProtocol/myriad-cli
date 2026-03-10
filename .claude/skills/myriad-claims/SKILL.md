---
name: myriad-claims
description: Execute claim workflows on Myriad for winnings and voided outcomes. Use when tasks include claim winnings, claim voided, claim all, claim dry-runs, outcome-id handling for voided markets, or portfolio-based claim scanning and execution.
user-invocable: true
allowed-tools: Bash(myriad claim *), Bash(myriad wallet balances *)
---

# Myriad Claims

## Overview

Use this skill to settle claimable positions with explicit control over winnings, voided outcomes, and bulk claim scans.

## Claim Workflow

1. Resolve claim target.
- Use market id or slug.
- Keep one market selector per command.

2. Run dry-run first for safety.

```bash
myriad claim winnings --market-id 164 --network-id 56 --dry-run --json
```

3. Execute real claim after payload review.

```bash
myriad claim winnings --market-id 164 --network-id 56 --json
```

## Voided Market Workflow

`claim voided` requires `--outcome-id`.

```bash
myriad claim voided --market-id 164 --network-id 56 --outcome-id 0 --dry-run --json
```

```bash
myriad claim voided --market-id 164 --network-id 56 --outcome-id 0 --json
```

## Claim-All Workflow

Use portfolio scan to settle all claimable positions.

```bash
myriad claim all --network-id 56 --dry-run --json
```

```bash
myriad claim all --network-id 56 --json
```

If `--wallet` is passed, it must match signer wallet context.

## Failure Handling

- Missing signer wallet:
  Run `myriad wallet setup` or pass `--private-key`.
- Network mismatch:
  Align `--chain-id` with market network.
- Voided claim missing outcome:
  Add `--outcome-id`.
- No claimable positions:
  Return clear no-op result and avoid retries.

## Boundaries

- Do not perform new market discovery logic here; hand off to `/myriad-market-discovery`.
- Do not troubleshoot keychain storage internals here; hand off to `/myriad-wallet-ops`.

## Reference

- Use [references/recipes.md](../../skills/myriad-claims/references/recipes.md) for claim command variants and triage patterns.
