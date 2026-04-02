# Wallet Ops Recipes

## Setup and Verify

```bash
myriad wallet setup
```

```bash
myriad wallet deposit --json
```


```bash
myriad wallet balances --json
```

## One-Off Signer Override

```bash
myriad --private-key 0x... wallet balances --json
```


## Trade/Claim Readiness Check

1. Run `myriad wallet balances --json`.
2. Ensure native gas balance is non-zero.
3. Ensure target collateral token balance is sufficient.
4. Deposit either with `myriad wallet balances --json` if needed.
5. Run target command with `--dry-run` first.

## Order Book Readiness Check

1. Run `myriad wallet balances --json`.
2. Ensure BNB gas is available for BNB Smart Chain execution.
3. Ensure USD1 balance is sufficient for buy/split workflows.
4. Verify the signer matches the intended order book wallet.
5. Verify the active order book runtime before launching mainnet writes.

## Troubleshooting

- Keychain not available:
  Validate host keychain service and user session unlock state.
- Wallet file exists but cannot decrypt:
  Re-run setup to refresh keychain secret and encrypted payload.
