#!/usr/bin/env node

import process from "node:process";
import { Command, CommanderError } from "commander";
import dotenv from "dotenv";
import { loadRuntimeConfig, parseInteger, RuntimeConfig } from "./config.js";
import {
  OrderWaitProgressEvent,
  ClaimAllInput,
  ClaimInput,
  ClaimVoidedInput,
  ListMarketsInput,
  MyriadOperations,
  ObLimitOrderInput,
  ObMarketBookInput,
  ObMarketOrderInput,
  ObMarketsListInput,
  ObMarketTradesInput,
  ObOrderCancelAllInput,
  ObOrdersListInput,
  ObPositionActionInput,
  ObPositionRedeemInput,
  ObPositionsListInput,
  PortfolioInput,
  StableSwapInput,
  TradeBuyInput,
  TradeSellInput,
  WalletDepositInput,
  WalletDepositResult,
  WalletBalancesInput
} from "./operations.js";
import { startMyriadMcpServer } from "./mcp-server.js";
import {
  renderMarketShowTable,
  renderMarketsListTable,
  renderObOrderShowTable,
  renderObOrdersListTable,
  renderObOrderSubmission,
  renderOrderbookLadder,
  renderPlainTables,
  renderPortfolioTable
} from "./output-format.js";
import { setupWalletInteractive } from "./wallet-store.js";
import { runSkillsInstall, formatInstallSummary } from "./skills-install.js";
import { CLI_VERSION } from "./version.js";

dotenv.config();
const cliVersion = CLI_VERSION;

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
  obExchangeAddress?: string;
  obConditionalTokens?: string;
  obManager?: string;
  obNegRiskAdapter?: string;
  wrappedCollateral?: string;
  allowance?: string;
};

type MarketsShowOptions = {
  networkId?: string;
};

type ObMarketBookCommandOptions = ObMarketBookInput & {
  render?: boolean;
  levels?: string | number;
};

type RequestedOutputMode = "json" | "plain";
type EffectiveOutputMode = "json" | "plain";

function toRuntimeConfig(command: Command, defaults: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const options = command.optsWithGlobals<GlobalOptions>();
  return loadRuntimeConfig({
    ...defaults,
    apiBaseUrl: options.apiBaseUrl ?? defaults.apiBaseUrl,
    apiKey: options.apiKey ?? defaults.apiKey,
    allowance: options.allowance ?? defaults.allowance,
    chainId: options.chainId ? parseInteger(options.chainId, "chain-id") : defaults.chainId,
    rpcUrl: options.rpcUrl ?? defaults.rpcUrl,
    privateKey: options.privateKey,
    predictionMarketAddress: options.predictionMarketAddress,
    predictionMarketQuerierAddress: options.predictionMarketQuerierAddress,
    collateralTokenAddress: options.collateralTokenAddress,
    usdtTokenAddress: options.usdtTokenAddress,
    usd1TokenAddress: options.usd1TokenAddress,
    pancakeRouterV2Address: options.pancakeRouterV2Address,
    obExchangeAddress: options.obExchangeAddress,
    obConditionalTokens: options.obConditionalTokens,
    obManager: options.obManager,
    obNegRiskAdapter: options.obNegRiskAdapter,
    wrappedCollateral: options.wrappedCollateral
  });
}

function createOperations(command: Command, defaults: Partial<RuntimeConfig> = {}): MyriadOperations {
  const options = command.optsWithGlobals<GlobalOptions>();
  const outputMode = resolveEffectiveOutputMode(options);
  const progressReporter =
    outputMode === "plain" && Boolean(process.stdout?.isTTY)
      ? (event: OrderWaitProgressEvent) => {
          if (event.type === "posted") {
            console.log(`Order posted with ${event.timeInForce}`);
            return;
          }

          console.log(`Waiting for matching response (${event.remainingSeconds} more seconds)`);
        }
      : undefined;
  return new MyriadOperations({
    runtime: toRuntimeConfig(command, defaults),
    globalAllowance: options.allowance,
    orderWaitProgressReporter: progressReporter
  });
}

function createOrderbookOperations(command: Command): MyriadOperations {
  return createOperations(command);
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
  .option("--ob-exchange-address <address>", "Orderbook exchange contract address")
  .option("--ob-conditional-tokens <address>", "Orderbook ConditionalTokens contract address")
  .option("--ob-manager <address>", "Orderbook market manager contract address")
  .option("--ob-neg-risk-adapter <address>", "Orderbook NegRisk adapter contract address")
  .option("--wrapped-collateral <address>", "Orderbook wrapped collateral token address")
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
  .description("Interactively create a wallet or import a private key/seed phrase into keychain-backed encrypted wallet storage (macOS/Linux for keychain persistence; use --private-key or MYRIAD_PRIVATE_KEY on Windows)")
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

const obCommand = program.command("ob").description("Myriad Order Book tools on BNB Chain");

const obMarketsCommand = obCommand.command("markets").description("Discover orderbook markets and market data");

obMarketsCommand
  .command("list")
  .description("List orderbook markets")
  .option("--state <state>", "Market state", "open")
  .option("--keyword <text>", "Keyword search")
  .option("--sort <field>", "Sort field", "volume_24h")
  .option("--order <order>", "Sort order: asc | desc", "desc")
  .option("--page <page>", "Page number", "1")
  .option("--limit <limit>", "Items per page", "20")
  .action(async (options: ObMarketsListInput, command) => {
    const result = await createOrderbookOperations(command).obMarketsList(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderMarketsListTable(result));
      return;
    }
    output(command, result);
  });

obMarketsCommand
  .command("show")
  .description("Show an orderbook market by id or slug")
  .argument("<market>", "Market id or slug")
  .action(async (marketArgument: string, _options, command) => {
    const result = await createOrderbookOperations(command).obMarketsShow(marketArgument);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderMarketShowTable(result));
      return;
    }
    output(command, result);
  });

obMarketsCommand
  .command("orderbook")
  .description("Show aggregated bids and asks for an orderbook market outcome")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .option("--outcome-id <id>", "Outcome id (0=yes, 1=no)", "0")
  .option("--render", "Render a terminal orderbook ladder")
  .option("--levels <n>", "Visible levels per side when rendering", "10")
  .action(async (options: ObMarketBookCommandOptions, command) => {
    const operations = createOrderbookOperations(command);
    const result = await operations.obMarketOrderbook(options);
    if (options.render === true) {
      const visibleLevels = parseInteger(String(options.levels ?? "10"), "levels");
      if (visibleLevels <= 0) {
        throw new Error("levels must be a positive integer.");
      }
      const tradesResult = await operations.obMarketTrades({
        marketId: options.marketId,
        marketSlug: options.marketSlug,
        outcomeId: options.outcomeId,
        page: 1,
        limit: 1
      });
      const latestTrade =
        typeof tradesResult === "object" &&
        tradesResult !== null &&
        "data" in tradesResult &&
        Array.isArray((tradesResult as { data?: unknown }).data)
          ? ((tradesResult as { data: Array<Record<string, unknown>> }).data[0] ?? null)
          : null;

      console.log(
        renderOrderbookLadder(
          {
            ...(result as Record<string, unknown>),
            lastPrice: latestTrade?.price
          },
          { levels: visibleLevels }
        )
      );
      return;
    }
    output(command, result);
  });

obMarketsCommand
  .command("trades")
  .description("Show recent orderbook trades for a market")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .option("--outcome-id <id>", "Outcome id (optional)")
  .option("--page <page>", "Page number", "1")
  .option("--limit <limit>", "Items per page", "50")
  .action(async (options: ObMarketTradesInput, command) => {
    const result = await createOrderbookOperations(command).obMarketTrades(options);
    output(command, result);
  });

const obLimitCommand = obCommand.command("limit").description("Place orderbook limit orders");

obLimitCommand
  .command("buy")
  .description("Place a limit buy order")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .requiredOption("--outcome-id <id>", "Outcome id")
  .requiredOption("--price <price>", "Limit price as a decimal in [0,1]")
  .requiredOption("--shares <amount>", "Shares to buy")
  .option("--time-in-force <tif>", "Time in force: GTC | GTD | FOK | FAK", "GTC")
  .option("--wait-ms <ms>", "Wait for order status updates after submission (0 disables polling)")
  .option("--expiration <unix>", "Required when --time-in-force is GTD")
  .option("--min-fill-shares <amount>", "Minimum fill size in shares")
  .option("--allowance <amount|UNLIMITED>", "Allowance override for collateral approval")
  .option("--skip-approval", "Skip allowance checks")
  .option("--dry-run", "Build and sign the order without posting it")
  .action(async (options: ObLimitOrderInput, command) => {
    const result = await createOrderbookOperations(command).obLimitBuy(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderObOrderSubmission(result));
      return;
    }
    output(command, result);
  });

obLimitCommand
  .command("sell")
  .description("Place a limit sell order")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .requiredOption("--outcome-id <id>", "Outcome id")
  .requiredOption("--price <price>", "Limit price as a decimal in [0,1]")
  .requiredOption("--shares <amount>", "Shares to sell")
  .option("--time-in-force <tif>", "Time in force: GTC | GTD | FOK | FAK", "GTC")
  .option("--wait-ms <ms>", "Wait for order status updates after submission (0 disables polling)")
  .option("--expiration <unix>", "Required when --time-in-force is GTD")
  .option("--min-fill-shares <amount>", "Minimum fill size in shares")
  .option("--skip-approval", "Skip ERC1155 approval check")
  .option("--dry-run", "Build and sign the order without posting it")
  .action(async (options: ObLimitOrderInput, command) => {
    const result = await createOrderbookOperations(command).obLimitSell(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderObOrderSubmission(result));
      return;
    }
    output(command, result);
  });

const obMarketCommand = obCommand.command("market").description("Place synthesized orderbook market orders");

obMarketCommand
  .command("buy")
  .description("Place a market buy order derived from the current orderbook")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .requiredOption("--outcome-id <id>", "Outcome id")
  .option("--shares <amount>", "Shares to buy")
  .option("--value <amount>", "Best-effort collateral spend target")
  .option("--time-in-force <tif>", "Time in force: FAK | FOK", "FAK")
  .option("--wait-ms <ms>", "Wait for order status updates after submission (0 disables polling)")
  .option("--allowance <amount|UNLIMITED>", "Allowance override for collateral approval")
  .option("--skip-approval", "Skip allowance checks")
  .option("--dry-run", "Build and sign the order without posting it")
  .action(async (options: ObMarketOrderInput, command) => {
    const result = await createOrderbookOperations(command).obMarketBuy(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderObOrderSubmission(result));
      return;
    }
    output(command, result);
  });

obMarketCommand
  .command("sell")
  .description("Place a market sell order derived from the current orderbook")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .requiredOption("--outcome-id <id>", "Outcome id")
  .option("--shares <amount>", "Shares to sell")
  .option("--value <amount>", "Best-effort proceeds target")
  .option("--time-in-force <tif>", "Time in force: FAK | FOK", "FAK")
  .option("--wait-ms <ms>", "Wait for order status updates after submission (0 disables polling)")
  .option("--skip-approval", "Skip ERC1155 approval check")
  .option("--dry-run", "Build and sign the order without posting it")
  .action(async (options: ObMarketOrderInput, command) => {
    const result = await createOrderbookOperations(command).obMarketSell(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderObOrderSubmission(result));
      return;
    }
    output(command, result);
  });

const obOrdersCommand = obCommand.command("orders").description("Inspect and manage orderbook orders");

obOrdersCommand
  .command("list")
  .description("List orderbook orders")
  .option("--trader <address>", "Trader wallet address (defaults to configured wallet)")
  .option("--market-id <id>", "Filter by market id")
  .option("--status <status>", "Filter by status")
  .option("--offset <offset>", "Pagination offset", "0")
  .option("--limit <limit>", "Items per page", "50")
  .action(async (options: ObOrdersListInput, command) => {
    const result = await createOrderbookOperations(command).obOrdersList(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderObOrdersListTable(result));
      return;
    }
    output(command, result);
  });

obOrdersCommand
  .command("show")
  .description("Show a single orderbook order")
  .argument("<orderHash>", "Order hash")
  .action(async (orderHash: string, _options, command) => {
    const result = await createOrderbookOperations(command).obOrdersShow({ orderHash });
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderObOrderShowTable(result));
      return;
    }
    output(command, result);
  });

obOrdersCommand
  .command("cancel")
  .description("Cancel an orderbook order, or use 'all' to cancel all open orders on a market")
  .argument("<orderHashOrAll>", "Order hash, or 'all' to cancel all open orders on a market")
  .option("--market-id <id>", "Market id (required with 'all')")
  .option("--market-slug <slug>", "Market slug (required with 'all')")
  .option("--dry-run", "Build the cancel request without sending it")
  .action(async (orderHashOrAll: string, options: ObOrderCancelAllInput, command) => {
    const operations = createOrderbookOperations(command);
    const result =
      orderHashOrAll.trim().toLowerCase() === "all"
        ? await operations.obOrdersCancelAll(options)
        : await operations.obOrdersCancel({ orderHash: orderHashOrAll, dryRun: options.dryRun });
    output(command, result);
  });

const obPositionsCommand = obCommand.command("positions").description("Consult and manage orderbook positions");

obPositionsCommand
  .command("list")
  .description("List the orderbook portfolio for a wallet")
  .option("--address <address>", "Wallet address (defaults to configured wallet)")
  .option("--market-id <id>", "Filter by market id")
  .option("--market-slug <slug>", "Filter by market slug")
  .option("--token-address <address>", "Filter by token address")
  .option("--page <page>", "Page number", "1")
  .option("--limit <limit>", "Items per page", "20")
  .action(async (options: ObPositionsListInput, command) => {
    const result = await createOrderbookOperations(command).obPositionsList(options);
    const globalOptions = command.optsWithGlobals() as GlobalOptions;
    if (resolveEffectiveOutputMode(globalOptions) === "plain") {
      console.log(renderPortfolioTable(result));
      return;
    }
    output(command, result);
  });

obPositionsCommand
  .command("split")
  .description("Split collateral into YES + NO shares")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .requiredOption("--amount <amount>", "Collateral amount to split")
  .option("--allowance <amount|UNLIMITED>", "Allowance override for collateral approval")
  .option("--skip-approval", "Skip allowance checks")
  .option("--dry-run", "Build calldata without sending it")
  .action(async (options: ObPositionActionInput, command) => {
    const result = await createOrderbookOperations(command).obPositionsSplit(options);
    output(command, result);
  });

obPositionsCommand
  .command("merge")
  .description("Merge YES + NO shares back into collateral")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .requiredOption("--amount <amount>", "Amount to merge")
  .option("--dry-run", "Build calldata without sending it")
  .action(async (options: ObPositionActionInput, command) => {
    const result = await createOrderbookOperations(command).obPositionsMerge(options);
    output(command, result);
  });

obPositionsCommand
  .command("redeem")
  .description("Redeem a resolved or voided market position")
  .option("--market-id <id>", "Market id")
  .option("--market-slug <slug>", "Market slug")
  .option("--dry-run", "Build calldata without sending it")
  .action(async (options: ObPositionRedeemInput, command) => {
    const result = await createOrderbookOperations(command).obPositionsRedeem(options);
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

const skillsCommand = program.command("skills").description("Manage agent platform skills");

skillsCommand
  .command("install")
  .description("Install Myriad skills for Claude Code, OpenClaw, or Codex")
  .option("--target <platform>", "Target platform: claude | openclaw | codex | all", "all")
  .option("--force", "Overwrite existing skill files")
  .action((options: { target: string; force?: boolean }) => {
    const validTargets = ["claude", "openclaw", "codex", "all"];
    if (!validTargets.includes(options.target)) {
      console.error(`Invalid target "${options.target}". Use: ${validTargets.join(" | ")}`);
      process.exit(1);
    }
    const results = runSkillsInstall(options.target, { force: options.force });
    console.log(formatInstallSummary(results));
  });

for (const commandGroup of [
  marketsCommand,
  walletCommand,
  swapCommand,
  tradeCommand,
  obCommand,
  obMarketsCommand,
  obLimitCommand,
  obMarketCommand,
  obOrdersCommand,
  obPositionsCommand,
  claimCommand,
  skillsCommand
]) {
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
