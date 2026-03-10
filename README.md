# Myriad CLI

Build AI trading agents on Myriad prediction markets in minutes.

Myriad CLI gives one interface for the full loop: discover markets, make decisions, execute trades, and claim winnings, with MCP support out of the box.

## What You Can Build

- **Discover** live opportunities across open markets using sorting and keyword search.
- **Decide** with fast market inspection and portfolio context.
- **Execute** buys and sells.
- **Claim** winnings.
- **Automate** the full workflow through MCP tool orchestration.

## Start in 90 Seconds

Install (requires Node.js and npm):

```bash
npm i -g @myriadmarkets/cli
```

Set up a signer wallet (interactive create/import):

```bash
myriad wallet setup
```

Fund your wallet for trading:

```bash
myriad wallet deposit
```

Find markets:

```bash
myriad markets list --state open --order volume --sort desc --limit 5 --json
```

Buy a position:

```bash
myriad trade buy --market-id 164 --outcome-id 0 --value 25 --json
```

Use the `--dry-run` flag to preview trades without executing them.

Run as MCP server:

```bash
myriad mcp
```

## Use cases

### 1) Event-Driven Trader Agent

Your agent spots a news catalyst, scans markets, and stages a trade.

```bash
myriad markets list --state open --keyword election --limit 10 --json
myriad trade buy --market-id 164 --outcome-id 0 --value 25 --dry-run --json
```

Go deeper:

- [Market discovery skill](skills/myriad-market-discovery/SKILL.md)
- [Trade execution skill](skills/myriad-trade-execution/SKILL.md)

### 2) Portfolio Monitor Agent

Your agent checks exposure, cash, and gas before every trading cycle.

```bash
myriad wallet balances --json
myriad wallet deposit --json
myriad portfolio --limit 20 --json
```

Go deeper:

- [Wallet ops skill](skills/myriad-wallet-ops/SKILL.md)
- [Market discovery skill](skills/myriad-market-discovery/SKILL.md)

### 3) Winnings sweeper agent

Your agent regularly sweeps resolved positions and claims winnings.

```bash
myriad claim all --dry-run --json
myriad claim all --json
```

Go deeper:

- [Claims skill](skills/myriad-claims/SKILL.md)

### 4) Multi-Agent Trading Desk (MCP)

One scout agent reads markets, another agent trades.

```bash
myriad mcp
```

Go deeper:

- [MCP orchestration skill](skills/myriad-mcp-orchestration/SKILL.md)

## MCP in One Minute

MCP client config:

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

Safe rule for every agent:

1. Use read tools first (`markets_*`, `portfolio`, `wallet_balances`).
2. Use `dryRun: true` first for write tools (`trade_*`, `swap_stable`, `claim_*`).
3. Execute without `dryRun` only after validation.

## Command Map

Core command groups: `markets` -> `trade` -> `claim` -> `wallet` -> `swap` -> `mcp`

## Skills

| Skill | Owns |
| --- | --- |
| [myriad-market-discovery](skills/myriad-market-discovery/SKILL.md) | Market scanning, filtering, and candidate selection |
| [myriad-trade-execution](skills/myriad-trade-execution/SKILL.md) | Buy/sell execution patterns, slippage and allowance strategy |
| [myriad-claims](skills/myriad-claims/SKILL.md) | Winnings, voided claims, and claim-all workflows |
| [myriad-wallet-ops](skills/myriad-wallet-ops/SKILL.md) | Wallet onboarding, signer resolution, keychain issues |
| [myriad-mcp-orchestration](skills/myriad-mcp-orchestration/SKILL.md) | MCP sequencing, safety rules, and per-call override behavior |

## Defaults and Risk (Read Once)

- JSON is the default output mode.
- Default chain is BNB Chain (`chainId=56`).
- Default API base URL is `https://api-v2.myriadprotocol.com/`.
- Default slippage: trades `0.05`, stable swaps `0.005`.
- On BNB Chain, buy flow can auto-swap `USDT`/`USD1` if required spend token balance is insufficient.
- Light risk note: prediction market execution is probabilistic and market conditions can change quickly; use dry-runs before writing transactions.

## Configuration Layers

Myriad CLI resolves config values in this order:

1. CLI flags (for example `--rpc-url`, `--chain-id`, `--allowance`).
2. Environment variables (`MYRIAD_*`) and `.env` in the current working directory.
3. Global machine config file:
  - `$XDG_CONFIG_HOME/myriad/config.json` when `XDG_CONFIG_HOME` is set.
  - Otherwise `~/.config/myriad/config.json`.
4. Built-in network defaults.

Supported global config keys:
`apiBaseUrl`, `apiKey`, `allowance`, `chainId`, `rpcUrl`, `predictionMarketAddress`, `predictionMarketQuerierAddress`, `collateralTokenAddress`, `usdtTokenAddress`, `usd1TokenAddress`, `pancakeRouterV2Address`.

Example global config:

```json
{
  "chainId": 56,
  "rpcUrl": "https://bsc-dataseed.binance.org/",
  "apiBaseUrl": "https://api-v2.myriadprotocol.com/",
  "apiKey": "optional-api-key",
  "allowance": "UNLIMITED"
}
```

Security note:
- Do not place private keys in global config.
- Use `myriad wallet setup` (encrypted wallet file + OS keychain), `MYRIAD_PRIVATE_KEY`, or `--private-key`.

## Further Reading

- [Myriad API v2 reference](MYRIAD_API_V2_REFERENCE.md)
- [.env defaults](.env.example)
- [All Myriad skills](skills)
