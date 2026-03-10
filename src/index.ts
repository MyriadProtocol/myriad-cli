#!/usr/bin/env node

import process from "node:process";
import { Command, CommanderError } from "commander";
import dotenv from "dotenv";
import { createRequire } from "node:module";
import { loadRuntimeConfig, parseInteger, RuntimeConfig } from "./config.js";
import {
  ClaimAllInput,
  ClaimInput,
  ClaimVoidedInput,
  ListMarketsInput,
  MyriadOperations,
  PortfolioInput,
  StableSwapInput,
  TradeBuyInput,
  TradeSellInput,
  WalletDepositInput,
  WalletDepositResult,
  WalletBalancesInput
} from "./operations.js";
import { startMyriadMcpServer } from "./mcp-server.js";
import { renderMarketShowTable, renderMarketsListTable, renderPlainTables, renderPortfolioTable } from "./output-format.js";
import { setupWalletInteractive } from "./wallet-store.js";

dotenv.config();
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: string };
const cliVersion = packageJson.version ?? "0.0.0";

type GlobalOptions = {
  plain?: boolean;
  json?: boolean;
  apiBaseUrl?: string;
  apiKey?: string;
  chainId?: string;
  rpcUrl?: string;
  privateKey?: string;
  predictionMarketAddress?: string;
  predictionMarketQuerierAddress?: string;
  collateralTokenAddress?: string;
  usdtTokenAddress?: string;
  usd1TokenAddress?: string;
  pancakeRouterV2Address?: string;
  allowance?: string;
};

type MarketsShowOptions = {
  networkId?: string;
};

type RequestedOutputMode = "json" | "plain";
type EffectiveOutputMode = "json" | "plain";

function toRuntimeConfig(command: Command): RuntimeConfig {
  const options = command.optsWithGlobals<GlobalOptions>();
  return loadRuntimeConfig({
    apiBaseUrl: options.apiBaseUrl,
    apiKey: options.apiKey,
    allowance: options.allowance,
    chainId: options.chainId ? parseInteger(options.chainId, "chain-id") : undefined,
    rpcUrl: options.rpcUrl,
    privateKey: options.privateKey,
    predictionMarketAddress: options.predictionMarketAddress,
    predictionMarketQuerierAddress: options.predictionMarketQuerierAddress,
    collateralTokenAddress: options.collateralTokenAddress,
    usdtTokenAddress: options.usdtTokenAddress,
    usd1TokenAddress: options.usd1TokenAddress,
    pancakeRouterV2Address: options.pancakeRouterV2Address
  });
}

function createOperations(command: Command): MyriadOperations {
  const options = command.optsWithGlobals<GlobalOptions>();
  return new MyriadOperations({
    runtime: toRuntimeConfig(command),
    globalAllowance: options.allowance
  });
}

function resolveRequestedOutputMode(options: GlobalOptions): RequestedOutputMode {
  if (options.json) {
    return "json";
  }

  return "plain";
}

function resolveEffectiveOutputMode(options: GlobalOptions): EffectiveOutputMode {
  return resolveRequestedOutputMode(options) === "plain" ? "plain" : "json";
}

function output(command: Command, payload: unknown): void {
  const options = command.optsWithGlobals<GlobalOptions>();
  if (resolveEffectiveOutputMode(options) === "plain") {
    console.log(renderPlainTables(payload));
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

function formatWalletDepositInstructions(payload: WalletDepositResult): string {
  return [
    `On ${payload.network}:`,
    `Send ${payload.assets.native.symbol} to ${payload.wallet} for gas.`,
    `Send ${payload.assets.collateral.symbol} (token address ${payload.assets.collateral.address}) to ${payload.wallet} to trade.`
  ].join("\n");
}

function resolveOutputModeFromArgv(argv: string[]): EffectiveOutputMode {
  const hasJson = argv.includes("--json");
  if (hasJson) {
    return "json";
  }

  return "plain";
}

function commandPath(command: Command): string {
  const segments: string[] = [];
  let current: Command | null = command;

  while (current) {
    segments.push(current.name());
    current = current.parent ?? null;
  }

  return segments.reverse().join(" ");
}

function formatCommandOverview(command: Command): string {
  const commands = command.commands;
  const width = commands.reduce((max, child) => Math.max(max, child.name().length), 0);
  const commandLines = commands.map((child) => {
    const description = child.description();
    if (!description) {
      return `  ${child.name()}`;
    }
    return `  ${child.name().padEnd(width)}  ${description}`;
  });

  const isRoot = command.parent == null;
  const overviewTitle = isRoot ? `myriad v${command.version()}` : `${commandPath(command)} (myriad v${program.version()})`;
  const listLabel = isRoot ? "Available commands:" : "Available subcommands:";
  const helpTarget = isRoot ? "myriad <command>" : `${commandPath(command)} <subcommand>`;

  return [overviewTitle, "", listLabel, ...commandLines, "", `Run \`${helpTarget} --help\` for details.`].join("\n");
}

const program = new Command();
const argvOutputMode = resolveOutputModeFromArgv(process.argv);

program
  .name("myriad")
  .description("Myriad Markets CLI for AI agents (MYRIAD API v2 + wallet execution)")
  .version(cliVersion)
  .option("--plain", "Output ASCII tables (default)")
  .option("--json", "Output JSON")
  .option("--api-base-url <url>", "MYRIAD API v2 base URL")
  .option("--api-key <key>", "MYRIAD API key (optional; higher rate limits and protected endpoints)")
  .option("--chain-id <id>", "EVM chain id (default: 56 / BNB Chain)")
  .option("--rpc-url <url>", "RPC URL for the selected chain")
  .option("--private-key <hex>", "Override signer private key for this command")
  .option("--prediction-market-address <address>", "PredictionMarket contract address")
  .option("--prediction-market-querier-address <address>", "PredictionMarketQuerier contract address")
  .option("--collateral-token-address <address>", "Collateral ERC20 token address")
  .option("--usdt-token-address <address>", "USDT token address (used for BNB stable swaps)")
  .option("--usd1-token-address <address>", "USD1 token address (used for BNB stable swaps)")
  .option("--pancake-router-v2-address <address>", "PancakeSwap V2 router address")
  .option("--allowance <amount|UNLIMITED>", "Global ERC20 allowance override for approvals")
  .exitOverride()
  .configureOutput({
    writeErr: (str) => {
      if (argvOutputMode === "plain") {
        process.stderr.write(str);
      }
    }
  });

program.action((_options, command) => {
  console.log(formatCommandOverview(command));
});

program
  .command("mcp")
  .description("Run as an MCP server over stdio")
  .action(async (_options, command: Command) => {
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    await startMyriadMcpServer({
      runtime: toRuntimeConfig(command),
      globalAllowance: globalOptions.allowance
    });
  });

const marketsCommand = program.command("markets").description("Browse markets from MYRIAD API v2");

marketsCommand
  .command("list")
  .description("List markets")
  .option("--state <state>", "Market state: open | closed | resolved", "open")
  .option("--network-id <id>", "Filter by network id")
  .option("--keyword <text>", "Keyword search")
  .option("--sort <field>", "Sort: volume | volume_24h | liquidity | expires_at | published_at | featured", "volume")
  .option("--order <order>", "Sort order: asc | desc", "desc")
  .option("--page <page>", "Page number", "1")
  .option("--limit <limit>", "Items per page", "20")
  .action(async (options: ListMarketsInput, command) => {
    const result = await createOperations(command).listMarkets(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderMarketsListTable(result));
      return;
    }
    output(command, result);
  });

marketsCommand
  .command("show")
  .description("Get market details by market id or slug")
  .argument("<market>", "Market id or slug")
  .option("--network-id <id>", "Required when <market> is an id")
  .action(async (marketArgument: string, options: MarketsShowOptions, command) => {
    const result = await createOperations(command).showMarket(marketArgument, options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderMarketShowTable(result));
      return;
    }
    output(command, result);
  });

program
  .command("portfolio")
  .description("Get portfolio for the configured wallet")
  .option("--network-id <id>", "Filter by network id")
  .option("--market-id <id>", "Filter by market id")
  .option("--market-slug <slug>", "Filter by market slug")
  .option("--token-address <address>", "Filter by token address")
  .option("--page <page>", "Page number", "1")
  .option("--limit <limit>", "Items per page", "20")
  .action(async (options: PortfolioInput, command) => {
    const result = await createOperations(command).portfolio(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderPortfolioTable(result));
      return;
    }
    output(command, result);
  });

const walletCommand = program.command("wallet").description("Wallet utilities");

walletCommand
  .command("setup")
  .alias("import")
  .description("Interactively create a wallet or import a private key/seed phrase into keychain-backed encrypted wallet storage")
  .action(async (_options, command) => {
    const result = await setupWalletInteractive();
    output(command, {
      ok: true,
      ...result
    });
  });

walletCommand
  .command("deposit")
  .description("Show how to fund the signer wallet with native gas token and collateral token")
  .option("--address <address>", "Wallet address (defaults to configured wallet)")
  .action(async (options: WalletDepositInput, command) => {
    const result = await createOperations(command).walletDeposit(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "json") {
      output(command, result);
      return;
    }

    console.log(formatWalletDepositInstructions(result));
  });

walletCommand
  .command("balances")
  .description("Get native + collateral balances; on BNB also include USDT and USD1")
  .option("--address <address>", "Wallet address (defaults to configured wallet)")
  .action(async (options: WalletBalancesInput, command) => {
    const result = await createOperations(command).walletBalances(options);
    output(command, result);
  });

const swapCommand = program.command("swap").description("Swap tokens via PancakeSwap on BNB Chain");

swapCommand
  .command("stable")
  .description("Swap between USDT and USD1 on BNB Chain (exact output)")
  .requiredOption("--from <symbol>", "Source token: usdt | usd1")
  .requiredOption("--to <symbol>", "Destination token: usdt | usd1")
  .requiredOption("--amount-out <amount>", "Amount of destination token to receive")
  .option("--slippage <decimal>", "Swap slippage tolerance (0-1)", "0.005")
  .option("--allowance <amount|UNLIMITED>", "Allowance override for swap token approval")
  .option("--dry-run", "Only quote the swap; do not submit transaction")
  .action(async (options: StableSwapInput, command) => {
    const result = await createOperations(command).swapStable(options);
    output(command, result);
  });

const tradeCommand = program.command("trade").description("Execute trades onchain using API quote calldata");

tradeCommand
  .command("buy")
  .description("Buy outcome shares in an open market")
  .requiredOption("--outcome-id <id>", "Outcome id")
  .requiredOption("--value <amount>", "Token amount to spend")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .option("--network-id <id>", "Market network id")
  .option("--slippage <decimal>", "Slippage tolerance (0-1)", "0.05")
  .option("--allowance <amount|UNLIMITED>", "Allowance override for market collateral approval")
  .option("--swap-slippage <decimal>", "PancakeSwap slippage for auto swap (0-1)", "0.005")
  .option("--swap-allowance <amount|UNLIMITED>", "Allowance override for auto-swap token approval")
  .option("--no-auto-swap", "Disable automatic USDT/USD1 swap when spend balance is insufficient")
  .option("--dry-run", "Quote only; do not submit transaction")
  .option("--skip-approval", "Skip ERC20 allowance check")
  .action(async (options: TradeBuyInput, command) => {
    const result = await createOperations(command).tradeBuy(options);
    output(command, result);
  });

tradeCommand
  .command("sell")
  .description("Sell shares from a market position")
  .requiredOption("--outcome-id <id>", "Outcome id")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .option("--network-id <id>", "Market network id")
  .option("--value <amount>", "Token amount to receive")
  .option("--shares <amount>", "Shares to sell")
  .option("--slippage <decimal>", "Slippage tolerance (0-1)", "0.05")
  .option("--dry-run", "Quote only; do not submit transaction")
  .action(async (options: TradeSellInput, command) => {
    const result = await createOperations(command).tradeSell(options);
    output(command, result);
  });

const claimCommand = program.command("claim").description("Claim market settlements");

claimCommand
  .command("winnings")
  .description("Claim winnings (or claim_voided when applicable if outcome id is provided)")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .option("--network-id <id>", "Market network id")
  .option("--outcome-id <id>", "Outcome id (only required for voided claims)")
  .option("--dry-run", "Build claim payload only; do not submit transaction")
  .action(async (options: ClaimInput, command) => {
    const result = await createOperations(command).claimWinnings(options);
    output(command, result);
  });

claimCommand
  .command("voided")
  .description("Claim a voided market position (explicit claim_voided flow)")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .option("--network-id <id>", "Market network id")
  .requiredOption("--outcome-id <id>", "Voided outcome id to claim")
  .option("--dry-run", "Build claim payload only; do not submit transactions")
  .action(async (options: ClaimVoidedInput, command) => {
    const result = await createOperations(command).claimVoided(options);
    output(command, result);
  });

claimCommand
  .command("all")
  .description("Claim all claimable positions (winnings and voided) for signer wallet / --wallet")
  .option("--wallet <address>", "Wallet to scan for claimable positions (defaults to configured signer wallet)")
  .option("--network-id <id>", "Network id filter (defaults to runtime chain)")
  .option("--page-size <n>", "Page size for portfolio scan", "100")
  .option("--dry-run", "Build all claim payloads only; do not submit transactions")
  .action(async (options: ClaimAllInput, command) => {
    const result = await createOperations(command).claimAll(options);
    output(command, result);
  });

for (const commandGroup of [marketsCommand, walletCommand, swapCommand, tradeCommand, claimCommand]) {
  commandGroup.action((_options, command) => {
    console.log(formatCommandOverview(command));
  });
}

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const errorCode =
    error instanceof CommanderError
      ? error.code
      : typeof error === "object" && error !== null && typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code?: unknown }).code)
        : undefined;

  if (error instanceof CommanderError) {
    if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
      process.exit(0);
    }
    if (argvOutputMode === "plain") {
      process.exit(error.exitCode ?? 1);
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  if (argvOutputMode === "plain") {
    console.error(message);
  } else {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: message,
          code: errorCode
        },
        null,
        2
      )
    );
  }
  process.exit(1);
});
