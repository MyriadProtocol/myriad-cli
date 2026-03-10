import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

export type NetworkConfig = {
  name: string;
  rpcUrl: string;
  predictionMarketAddress: string;
  predictionMarketQuerierAddress: string;
  defaultTokenAddress: string;
  usdtTokenAddress?: string;
  usd1TokenAddress?: string;
  pancakeRouterV2Address?: string;
};

export type RuntimeConfig = {
  apiBaseUrl: string;
  apiKey?: string;
  allowance?: string;
  chainId: number;
  rpcUrl: string;
  privateKey?: string;
  predictionMarketAddress: string;
  predictionMarketQuerierAddress: string;
  collateralTokenAddress: string;
  usdtTokenAddress?: string;
  usd1TokenAddress?: string;
  pancakeRouterV2Address?: string;
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
    rpcUrl: "https://bsc-dataseed.binance.org/",
    predictionMarketAddress: "0x39E66eE6b2ddaf4DEfDEd3038E0162180dbeF340",
    predictionMarketQuerierAddress: "0xDeFb36c47754D2e37d44b8b8C647D4D643e03bAd",
    defaultTokenAddress: "0x55d398326f99059fF775485246999027B3197955",
    usdtTokenAddress: "0x55d398326f99059fF775485246999027B3197955",
    usd1TokenAddress: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
    pancakeRouterV2Address: "0x10ED43C718714eb63d5aA57B78B54704E256024E"
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
  "pancakeRouterV2Address"
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

  const rpcUrl = overrides.rpcUrl ?? env.MYRIAD_RPC_URL ?? globalConfig.rpcUrl ?? networkConfig?.rpcUrl;

  if (!predictionMarketAddress || !predictionMarketQuerierAddress || !collateralTokenAddress || !rpcUrl) {
    throw new Error(
      `Missing deployment config for chain ${chainId}. Set MYRIAD_PM_CONTRACT, MYRIAD_PM_QUERIER_CONTRACT, MYRIAD_COLLATERAL_TOKEN, and MYRIAD_RPC_URL via flags, environment, or global config.`
    );
  }

  return {
    apiBaseUrl: overrides.apiBaseUrl ?? env.MYRIAD_API_BASE_URL ?? globalConfig.apiBaseUrl ?? DEFAULT_API_BASE_URL,
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
    pancakeRouterV2Address
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
