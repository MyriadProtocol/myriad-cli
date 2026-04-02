import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

export type NetworkConfig = {
  name: string;
  rpcUrl?: string;
  apiBaseUrl?: string;
  predictionMarketAddress?: string;
  predictionMarketQuerierAddress?: string;
  defaultTokenAddress?: string;
  usdtTokenAddress?: string;
  usd1TokenAddress?: string;
  pancakeRouterV2Address?: string;
  obExchangeAddress?: string;
  obConditionalTokens?: string;
  obManager?: string;
  obNegRiskAdapter?: string;
  wrappedCollateral?: string;
};

export type RuntimeConfig = {
  apiBaseUrl: string;
  apiKey?: string;
  allowance?: string;
  chainId: number;
  rpcUrl: string;
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
};

export type GlobalConfigFile = {
  apiBaseUrl?: string;
  apiKey?: string;
  allowance?: string;
  chainId?: number;
  rpcUrl?: string;
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
};

type TextFileReader = (filePath: string, encoding: BufferEncoding) => string;

export type GlobalConfigLoadOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  readFile?: TextFileReader;
};

export type RuntimeConfigLoadOptions = GlobalConfigLoadOptions & {
  globalConfig?: GlobalConfigFile;
};

export const NETWORKS: Record<number, NetworkConfig> = {
  56: {
    name: "BNB Chain",
    apiBaseUrl: "https://api-v2.myriadprotocol.com/",
    rpcUrl: "https://bsc-dataseed.binance.org/",
    predictionMarketAddress: "0x39E66eE6b2ddaf4DEfDEd3038E0162180dbeF340",
    predictionMarketQuerierAddress: "0xDeFb36c47754D2e37d44b8b8C647D4D643e03bAd",
    defaultTokenAddress: "0x55d398326f99059fF775485246999027B3197955",
    usdtTokenAddress: "0x55d398326f99059fF775485246999027B3197955",
    usd1TokenAddress: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
    pancakeRouterV2Address: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    obExchangeAddress: "0xa0b6f8ef8EdB64f395018D1933f2273Ce9f0f16A",
    obConditionalTokens: "0x6413734f92248D4B29ae35883290BD93212654Dc",
    obManager: "0xaB5591E280fF9Bf368DB60c3b775b5C7Ba5ea3dB",
    obNegRiskAdapter: "0xd96F26703Ddbf7d1Cb6858640eca34cF1893d53A",
    wrappedCollateral: "0x9F124ce59D8De0274574949400640a2677067ACC"
  },
  97: {
    name: "BSC Testnet"
  }
};

const DEFAULT_API_BASE_URL = "https://api-v2.myriadprotocol.com/";
const GLOBAL_CONFIG_DIR_NAME = "myriad";
const GLOBAL_CONFIG_FILE_NAME = "config.json";
const GLOBAL_CONFIG_KEYS = [
  "apiBaseUrl",
  "apiKey",
  "allowance",
  "chainId",
  "rpcUrl",
  "predictionMarketAddress",
  "predictionMarketQuerierAddress",
  "collateralTokenAddress",
  "usdtTokenAddress",
  "usd1TokenAddress",
  "pancakeRouterV2Address",
  "obExchangeAddress",
  "obConditionalTokens",
  "obManager",
  "obNegRiskAdapter",
  "wrappedCollateral"
] as const;
const GLOBAL_CONFIG_KEY_SET = new Set<string>(GLOBAL_CONFIG_KEYS);

export function parseInteger(input: string, fieldName: string): number {
  const parsed = Number.parseInt(input, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${fieldName} must be an integer. Received: ${input}`);
  }
  return parsed;
}

export function parseNumber(input: string, fieldName: string): number {
  const parsed = Number.parseFloat(input);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a number. Received: ${input}`);
  }
  return parsed;
}

function parseOptionalGlobalString(value: unknown, key: string, configPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Global config key "${key}" in ${configPath} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function parseGlobalConfig(raw: string, configPath: string): GlobalConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Global config at ${configPath} is not valid JSON: ${details}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Global config at ${configPath} must be a JSON object.`);
  }

  const value = parsed as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!GLOBAL_CONFIG_KEY_SET.has(key)) {
      throw new Error(
        `Unsupported global config key "${key}" in ${configPath}. Supported keys: ${GLOBAL_CONFIG_KEYS.join(", ")}.`
      );
    }
  }

  const result: GlobalConfigFile = {};

  result.apiBaseUrl = parseOptionalGlobalString(value.apiBaseUrl, "apiBaseUrl", configPath);
  result.apiKey = parseOptionalGlobalString(value.apiKey, "apiKey", configPath);
  result.allowance = parseOptionalGlobalString(value.allowance, "allowance", configPath);
  result.rpcUrl = parseOptionalGlobalString(value.rpcUrl, "rpcUrl", configPath);
  result.predictionMarketAddress = parseOptionalGlobalString(
    value.predictionMarketAddress,
    "predictionMarketAddress",
    configPath
  );
  result.predictionMarketQuerierAddress = parseOptionalGlobalString(
    value.predictionMarketQuerierAddress,
    "predictionMarketQuerierAddress",
    configPath
  );
  result.collateralTokenAddress = parseOptionalGlobalString(
    value.collateralTokenAddress,
    "collateralTokenAddress",
    configPath
  );
  result.usdtTokenAddress = parseOptionalGlobalString(value.usdtTokenAddress, "usdtTokenAddress", configPath);
  result.usd1TokenAddress = parseOptionalGlobalString(value.usd1TokenAddress, "usd1TokenAddress", configPath);
  result.pancakeRouterV2Address = parseOptionalGlobalString(
    value.pancakeRouterV2Address,
    "pancakeRouterV2Address",
    configPath
  );
  result.obExchangeAddress = parseOptionalGlobalString(value.obExchangeAddress, "obExchangeAddress", configPath);
  result.obConditionalTokens = parseOptionalGlobalString(
    value.obConditionalTokens,
    "obConditionalTokens",
    configPath
  );
  result.obManager = parseOptionalGlobalString(value.obManager, "obManager", configPath);
  result.obNegRiskAdapter = parseOptionalGlobalString(value.obNegRiskAdapter, "obNegRiskAdapter", configPath);
  result.wrappedCollateral = parseOptionalGlobalString(value.wrappedCollateral, "wrappedCollateral", configPath);

  if (value.chainId !== undefined) {
    if (typeof value.chainId === "number") {
      if (!Number.isInteger(value.chainId)) {
        throw new Error(`Global config key "chainId" in ${configPath} must be an integer.`);
      }
      result.chainId = value.chainId;
    } else if (typeof value.chainId === "string") {
      result.chainId = parseInteger(value.chainId, "chainId");
    } else {
      throw new Error(`Global config key "chainId" in ${configPath} must be an integer.`);
    }
  }

  return result;
}

export function resolveGlobalConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir()
): string {
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim();
  const configRoot = xdgConfigHome && xdgConfigHome.length > 0 ? xdgConfigHome : path.join(homeDir, ".config");
  return path.join(configRoot, GLOBAL_CONFIG_DIR_NAME, GLOBAL_CONFIG_FILE_NAME);
}

export function loadGlobalConfigFile(options: GlobalConfigLoadOptions = {}): GlobalConfigFile {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const configPath = resolveGlobalConfigPath(env, homeDir);
  const readFile = options.readFile ?? readFileSync;

  try {
    const raw = readFile(configPath, "utf8");
    return parseGlobalConfig(raw, configPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }

    if (error instanceof Error && error.message.startsWith("Global config")) {
      throw error;
    }

    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read global config at ${configPath}: ${details}`);
  }
}

export function loadRuntimeConfig(
  overrides: Partial<RuntimeConfig> = {},
  options: RuntimeConfigLoadOptions = {}
): RuntimeConfig {
  const env = options.env ?? process.env;
  const globalConfig =
    options.globalConfig ??
    loadGlobalConfigFile({
      env,
      homeDir: options.homeDir,
      readFile: options.readFile
    });

  const chainId =
    overrides.chainId ??
    (env.MYRIAD_CHAIN_ID ? parseInteger(env.MYRIAD_CHAIN_ID, "MYRIAD_CHAIN_ID") : globalConfig.chainId ?? 56);
  const networkConfig = NETWORKS[chainId];

  const predictionMarketAddress =
    overrides.predictionMarketAddress ??
    env.MYRIAD_PM_CONTRACT ??
    globalConfig.predictionMarketAddress ??
    networkConfig?.predictionMarketAddress;

  const predictionMarketQuerierAddress =
    overrides.predictionMarketQuerierAddress ??
    env.MYRIAD_PM_QUERIER_CONTRACT ??
    globalConfig.predictionMarketQuerierAddress ??
    networkConfig?.predictionMarketQuerierAddress;

  const collateralTokenAddress =
    overrides.collateralTokenAddress ??
    env.MYRIAD_COLLATERAL_TOKEN ??
    globalConfig.collateralTokenAddress ??
    networkConfig?.defaultTokenAddress;

  const usdtTokenAddress =
    overrides.usdtTokenAddress ??
    env.MYRIAD_USDT_TOKEN ??
    globalConfig.usdtTokenAddress ??
    networkConfig?.usdtTokenAddress;

  const usd1TokenAddress =
    overrides.usd1TokenAddress ??
    env.MYRIAD_USD1_TOKEN ??
    globalConfig.usd1TokenAddress ??
    networkConfig?.usd1TokenAddress;

  const pancakeRouterV2Address =
    overrides.pancakeRouterV2Address ??
    env.MYRIAD_PANCAKE_ROUTER_V2 ??
    globalConfig.pancakeRouterV2Address ??
    networkConfig?.pancakeRouterV2Address;

  const obExchangeAddress =
    overrides.obExchangeAddress ??
    env.MYRIAD_OB_EXCHANGE_ADDRESS ??
    globalConfig.obExchangeAddress ??
    networkConfig?.obExchangeAddress;

  const obConditionalTokens =
    overrides.obConditionalTokens ??
    env.MYRIAD_OB_CONDITIONAL_TOKENS ??
    globalConfig.obConditionalTokens ??
    networkConfig?.obConditionalTokens;

  const obManager =
    overrides.obManager ??
    env.MYRIAD_OB_MANAGER ??
    globalConfig.obManager ??
    networkConfig?.obManager;

  const obNegRiskAdapter =
    overrides.obNegRiskAdapter ??
    env.MYRIAD_OB_NEG_RISK_ADAPTER ??
    globalConfig.obNegRiskAdapter ??
    networkConfig?.obNegRiskAdapter;

  const wrappedCollateral =
    overrides.wrappedCollateral ??
    env.MYRIAD_WRAPPED_COLLATERAL ??
    globalConfig.wrappedCollateral ??
    networkConfig?.wrappedCollateral;

  const rpcUrl = overrides.rpcUrl ?? env.MYRIAD_RPC_URL ?? globalConfig.rpcUrl ?? networkConfig?.rpcUrl;
  if (!rpcUrl) {
    throw new Error(`Missing RPC config for chain ${chainId}. Set MYRIAD_RPC_URL via flags, environment, or global config.`);
  }

  return {
    apiBaseUrl:
      overrides.apiBaseUrl ?? env.MYRIAD_API_BASE_URL ?? globalConfig.apiBaseUrl ?? networkConfig?.apiBaseUrl ?? DEFAULT_API_BASE_URL,
    apiKey: overrides.apiKey ?? env.MYRIAD_API_KEY ?? globalConfig.apiKey,
    allowance: overrides.allowance ?? env.MYRIAD_ALLOWANCE ?? globalConfig.allowance,
    chainId,
    rpcUrl,
    privateKey: overrides.privateKey ?? env.MYRIAD_PRIVATE_KEY ?? env.PRIVATE_KEY,
    predictionMarketAddress,
    predictionMarketQuerierAddress,
    collateralTokenAddress,
    usdtTokenAddress,
    usd1TokenAddress,
    pancakeRouterV2Address,
    obExchangeAddress,
    obConditionalTokens,
    obManager,
    obNegRiskAdapter,
    wrappedCollateral
  };
}

export function assertCollateralConfig(config: RuntimeConfig): RuntimeConfig & { collateralTokenAddress: string } {
  if (!config.collateralTokenAddress) {
    throw new Error(
      `Collateral token is not configured for chain ${config.chainId}. Set MYRIAD_COLLATERAL_TOKEN or --collateral-token-address.`
    );
  }
  return config as RuntimeConfig & { collateralTokenAddress: string };
}

export function assertAmmConfig(config: RuntimeConfig): RuntimeConfig & {
  predictionMarketAddress: string;
  predictionMarketQuerierAddress: string;
  collateralTokenAddress: string;
} {
  const withCollateral = assertCollateralConfig(config);
  if (!withCollateral.predictionMarketAddress || !withCollateral.predictionMarketQuerierAddress) {
    throw new Error(
      `AMM deployment config is incomplete for chain ${config.chainId}. ` +
        "Set MYRIAD_PM_CONTRACT and MYRIAD_PM_QUERIER_CONTRACT via flags, environment, or global config."
    );
  }

  return withCollateral as RuntimeConfig & {
    predictionMarketAddress: string;
    predictionMarketQuerierAddress: string;
    collateralTokenAddress: string;
  };
}

export function assertOrderbookConfig(config: RuntimeConfig): RuntimeConfig & {
  collateralTokenAddress: string;
  obExchangeAddress: string;
  obConditionalTokens: string;
  obManager: string;
} {
  const withCollateral = assertCollateralConfig(config);
  if (!withCollateral.obExchangeAddress || !withCollateral.obConditionalTokens || !withCollateral.obManager) {
    throw new Error(
      `Orderbook deployment config is incomplete for chain ${config.chainId}. ` +
        "Set MYRIAD_OB_EXCHANGE_ADDRESS, MYRIAD_OB_CONDITIONAL_TOKENS, and MYRIAD_OB_MANAGER."
    );
  }

  return withCollateral as RuntimeConfig & {
    collateralTokenAddress: string;
    obExchangeAddress: string;
    obConditionalTokens: string;
    obManager: string;
  };
}

export function assertTradingConfig(config: RuntimeConfig): RuntimeConfig & { privateKey: string } {
  if (!config.privateKey) {
    throw new Error(
      "A signer wallet is required for trade and claim commands. Run `myriad wallet setup`, set MYRIAD_PRIVATE_KEY, or pass --private-key."
    );
  }
  return config as RuntimeConfig & { privateKey: string };
}
