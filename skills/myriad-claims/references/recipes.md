# Claims Recipes

## Winnings Claim

```bash
myriad claim winnings --market-id 164 --network-id 56 --json
```

## Voided Claim

```bash
myriad claim voided --market-id 164 --network-id 56 --outcome-id 0 --json
```

## Bulk Claim

```bash
myriad claim all --network-id 56 --json
```

```bash
myriad claim all --wallet 0xWalletAddress --network-id 56 --dry-run --json
```

## Troubleshooting

- `--outcome-id` required:
  Applies to `claim voided`; include the specific voided outcome id.
- Wallet mismatch with `claim all --wallet`:
  Use signer wallet address or omit `--wallet`.
- No claimable entries:
  This is a valid terminal state; do not force retries.
