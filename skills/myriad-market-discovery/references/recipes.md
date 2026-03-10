# Market Discovery Recipes

## Quick Recipes

```bash
myriad markets list --state open --limit 5 --json
```

```bash
myriad markets list --state resolved --sort published_at --order desc --limit 20 --json
```

```bash
myriad markets list --state open --network-id 56 --keyword election --sort volume --order desc --json
```

```bash
myriad markets show 164 --network-id 56 --json
```

```bash
myriad markets show will-btc-close-above-120k-on-friday --json
```

## Troubleshooting

- `Provide exactly one of --market-id or --market-slug`:
  This error comes from trade/claim flows, not `markets show`. For discovery, pass only one `<market>` argument.
- Empty list results:
  Relax `--keyword`, switch `--state`, and try `--page 1 --limit 50`.
- API 401 on restricted endpoints:
  Add `--api-key` or set `MYRIAD_API_KEY`.
- Non-JSON output expected:
  Add `--json` explicitly; JSON is default but explicit flags improve reproducibility.
