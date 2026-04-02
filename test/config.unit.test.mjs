import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadGlobalConfigFile,
  loadRuntimeConfig,
  resolveGlobalConfigPath
} from "../dist/config.js";

const DEFAULT_PM = "0x39E66eE6b2ddaf4DEfDEd3038E0162180dbeF340";
const DEFAULT_QUERIER = "0xDeFb36c47754D2e37d44b8b8C647D4D643e03bAd";
const DEFAULT_COLLATERAL = "0x55d398326f99059fF775485246999027B3197955";

async function withTempDir(prefix, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeGlobalConfig(homeOrXdgRoot, payload, options = {}) {
  const basePath = options.useXdg
    ? path.join(homeOrXdgRoot, "myriad")
    : path.join(homeOrXdgRoot, ".config", "myriad");

  await mkdir(basePath, { recursive: true });
  const filePath = path.join(basePath, "config.json");
  await writeFile(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

test("resolveGlobalConfigPath uses XDG_CONFIG_HOME when provided", () => {
  const resolved = resolveGlobalConfigPath(
    {
      XDG_CONFIG_HOME: "/tmp/my-config-home"
    },
    "/unused-home"
  );

  assert.equal(resolved, "/tmp/my-config-home/myriad/config.json");
});

test("resolveGlobalConfigPath falls back to ~/.config under home dir", () => {
  const resolved = resolveGlobalConfigPath({}, "/Users/example");
  assert.equal(resolved, "/Users/example/.config/myriad/config.json");
});

test("loadGlobalConfigFile returns empty object when file is missing", async () => {
  await withTempDir("myriad-config-test-", async (homeDir) => {
    const loaded = loadGlobalConfigFile({
      env: {},
      homeDir
    });

    assert.deepEqual(loaded, {});
  });
});

test("loadGlobalConfigFile fails for invalid JSON payload", async () => {
  await withTempDir("myriad-config-test-", async (homeDir) => {
    const configDir = path.join(homeDir, ".config", "myriad");
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, "config.json"), "{not-valid-json}");

    assert.throws(
      () =>
        loadGlobalConfigFile({
          env: {},
          homeDir
        }),
      /is not valid JSON/
    );
  });
});

test("loadGlobalConfigFile rejects unsupported keys", async () => {
  await withTempDir("myriad-config-test-", async (homeDir) => {
    await writeGlobalConfig(homeDir, {
      privateKey: "0xabc"
    });

    assert.throws(
      () =>
        loadGlobalConfigFile({
          env: {},
          homeDir
        }),
      /Unsupported global config key "privateKey"/
    );
  });
});

test("loadGlobalConfigFile validates value types", async () => {
  await withTempDir("myriad-config-test-", async (homeDir) => {
    await writeGlobalConfig(homeDir, {
      chainId: 56.5
    });

    assert.throws(
      () =>
        loadGlobalConfigFile({
          env: {},
          homeDir
        }),
      /must be an integer/
    );
  });
});

test("loadRuntimeConfig uses global config values when env and flags are absent", () => {
  const runtime = loadRuntimeConfig(
    {},
    {
      env: {},
      globalConfig: {
        apiBaseUrl: "https://global-api.example",
        apiKey: "global-api-key",
        allowance: "UNLIMITED",
        chainId: 97,
        rpcUrl: "https://global-rpc.example",
        predictionMarketAddress: "0x1111111111111111111111111111111111111111",
        predictionMarketQuerierAddress: "0x2222222222222222222222222222222222222222",
        collateralTokenAddress: "0x3333333333333333333333333333333333333333"
      }
    }
  );

  assert.equal(runtime.apiBaseUrl, "https://global-api.example");
  assert.equal(runtime.apiKey, "global-api-key");
  assert.equal(runtime.allowance, "UNLIMITED");
  assert.equal(runtime.chainId, 97);
  assert.equal(runtime.rpcUrl, "https://global-rpc.example");
  assert.equal(runtime.predictionMarketAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(runtime.predictionMarketQuerierAddress, "0x2222222222222222222222222222222222222222");
  assert.equal(runtime.collateralTokenAddress, "0x3333333333333333333333333333333333333333");
});

test("loadRuntimeConfig uses env vars over global config", () => {
  const runtime = loadRuntimeConfig(
    {},
    {
      env: {
        MYRIAD_API_BASE_URL: "https://env-api.example",
        MYRIAD_API_KEY: "env-api-key",
        MYRIAD_ALLOWANCE: "25",
        MYRIAD_CHAIN_ID: "56",
        MYRIAD_RPC_URL: "https://env-rpc.example",
        MYRIAD_PM_CONTRACT: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        MYRIAD_PM_QUERIER_CONTRACT: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        MYRIAD_COLLATERAL_TOKEN: "0xcccccccccccccccccccccccccccccccccccccccc"
      },
      globalConfig: {
        apiBaseUrl: "https://global-api.example",
        apiKey: "global-api-key",
        allowance: "UNLIMITED",
        chainId: 97,
        rpcUrl: "https://global-rpc.example",
        predictionMarketAddress: "0x1111111111111111111111111111111111111111",
        predictionMarketQuerierAddress: "0x2222222222222222222222222222222222222222",
        collateralTokenAddress: "0x3333333333333333333333333333333333333333"
      }
    }
  );

  assert.equal(runtime.apiBaseUrl, "https://env-api.example");
  assert.equal(runtime.apiKey, "env-api-key");
  assert.equal(runtime.allowance, "25");
  assert.equal(runtime.chainId, 56);
  assert.equal(runtime.rpcUrl, "https://env-rpc.example");
  assert.equal(runtime.predictionMarketAddress, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(runtime.predictionMarketQuerierAddress, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(runtime.collateralTokenAddress, "0xcccccccccccccccccccccccccccccccccccccccc");
});

test("loadRuntimeConfig uses CLI overrides over env and global config", () => {
  const runtime = loadRuntimeConfig(
    {
      apiBaseUrl: "https://flag-api.example",
      apiKey: "flag-api-key",
      allowance: "50",
      chainId: 1,
      rpcUrl: "https://flag-rpc.example",
      predictionMarketAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
      predictionMarketQuerierAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      collateralTokenAddress: "0xffffffffffffffffffffffffffffffffffffffff"
    },
    {
      env: {
        MYRIAD_API_BASE_URL: "https://env-api.example",
        MYRIAD_API_KEY: "env-api-key",
        MYRIAD_ALLOWANCE: "UNLIMITED",
        MYRIAD_CHAIN_ID: "56",
        MYRIAD_RPC_URL: "https://env-rpc.example",
        MYRIAD_PM_CONTRACT: DEFAULT_PM,
        MYRIAD_PM_QUERIER_CONTRACT: DEFAULT_QUERIER,
        MYRIAD_COLLATERAL_TOKEN: DEFAULT_COLLATERAL
      },
      globalConfig: {
        apiBaseUrl: "https://global-api.example",
        apiKey: "global-api-key",
        allowance: "10",
        chainId: 97,
        rpcUrl: "https://global-rpc.example",
        predictionMarketAddress: "0x1111111111111111111111111111111111111111",
        predictionMarketQuerierAddress: "0x2222222222222222222222222222222222222222",
        collateralTokenAddress: "0x3333333333333333333333333333333333333333"
      }
    }
  );

  assert.equal(runtime.apiBaseUrl, "https://flag-api.example");
  assert.equal(runtime.apiKey, "flag-api-key");
  assert.equal(runtime.allowance, "50");
  assert.equal(runtime.chainId, 1);
  assert.equal(runtime.rpcUrl, "https://flag-rpc.example");
  assert.equal(runtime.predictionMarketAddress, "0xdddddddddddddddddddddddddddddddddddddddd");
  assert.equal(runtime.predictionMarketQuerierAddress, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  assert.equal(runtime.collateralTokenAddress, "0xffffffffffffffffffffffffffffffffffffffff");
});

test("loadRuntimeConfig provides built-in orderbook defaults for chain 56", () => {
  const runtime = loadRuntimeConfig(
    {
      chainId: 56
    },
    {
      env: {}
    }
  );

  assert.equal(runtime.chainId, 56);
  assert.equal(runtime.apiBaseUrl, "https://api-v2.myriadprotocol.com/");
  assert.equal(runtime.rpcUrl, "https://bsc-dataseed.binance.org/");
  assert.equal(runtime.collateralTokenAddress, "0x55d398326f99059fF775485246999027B3197955");
  assert.equal(runtime.usd1TokenAddress, "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d");
  assert.equal(runtime.obExchangeAddress, "0xa0b6f8ef8EdB64f395018D1933f2273Ce9f0f16A");
  assert.equal(runtime.obConditionalTokens, "0x6413734f92248D4B29ae35883290BD93212654Dc");
  assert.equal(runtime.obManager, "0xaB5591E280fF9Bf368DB60c3b775b5C7Ba5ea3dB");
  assert.equal(runtime.obNegRiskAdapter, "0xd96F26703Ddbf7d1Cb6858640eca34cF1893d53A");
  assert.equal(runtime.wrappedCollateral, "0x9F124ce59D8De0274574949400640a2677067ACC");
});

test("loadRuntimeConfig requires explicit OB environment config for chain 97", () => {
  assert.throws(
    () =>
      loadRuntimeConfig(
        {
          chainId: 97
        },
        {
          env: {}
        }
      ),
    /Missing RPC config for chain 97/
  );
});
