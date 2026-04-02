import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distEntry = path.join(repoRoot, "dist/index.js");
const PRIVATE_KEY_A = "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0";

function processEnvAsRecord() {
  return Object.fromEntries(Object.entries(process.env).filter((entry) => typeof entry[1] === "string"));
}

function baseCliEnv(overrides = {}) {
  const env = processEnvAsRecord();

  for (const key of Object.keys(env)) {
    if (key.startsWith("MYRIAD_")) {
      delete env[key];
    }
  }

  delete env.PRIVATE_KEY;
  delete env.XDG_CONFIG_HOME;

  return {
    ...env,
    ...overrides
  };
}

function runCli(args, envOverrides = {}, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [distEntry, ...args], {
      cwd,
      env: baseCliEnv(envOverrides)
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });
  });
}

async function withTempDir(prefix, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeGlobalConfig(xdgRoot, payload) {
  const configDir = path.join(xdgRoot, "myriad");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "config.json"), JSON.stringify(payload, null, 2));
}

test("CLI uses global config defaults when flags and env are absent", async () => {
  await withTempDir("myriad-cli-config-test-", async (xdgRoot) => {
    await writeGlobalConfig(xdgRoot, {
      chainId: 97,
      rpcUrl: "https://rpc.global.example",
      predictionMarketAddress: "0x1111111111111111111111111111111111111111",
      predictionMarketQuerierAddress: "0x2222222222222222222222222222222222222222",
      collateralTokenAddress: "0x3333333333333333333333333333333333333333"
    });

    const result = await runCli(
      ["--private-key", PRIVATE_KEY_A, "wallet", "deposit", "--json"],
      {
        XDG_CONFIG_HOME: xdgRoot
      },
      xdgRoot
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.chainId, 97);
    assert.equal(payload.network, "BSC Testnet");
    assert.equal(payload.assets.collateral.address.toLowerCase(), "0x3333333333333333333333333333333333333333");
  });
});

test("CLI env vars override global config", async () => {
  await withTempDir("myriad-cli-config-test-", async (xdgRoot) => {
    await writeGlobalConfig(xdgRoot, {
      chainId: 97,
      rpcUrl: "https://rpc.global.example",
      predictionMarketAddress: "0x1111111111111111111111111111111111111111",
      predictionMarketQuerierAddress: "0x2222222222222222222222222222222222222222",
      collateralTokenAddress: "0x3333333333333333333333333333333333333333"
    });

    const result = await runCli(
      ["--private-key", PRIVATE_KEY_A, "wallet", "deposit", "--json"],
      {
        XDG_CONFIG_HOME: xdgRoot,
        MYRIAD_CHAIN_ID: "56",
        MYRIAD_COLLATERAL_TOKEN: "0x4444444444444444444444444444444444444444"
      },
      xdgRoot
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.chainId, 56);
    assert.equal(payload.assets.collateral.address.toLowerCase(), "0x4444444444444444444444444444444444444444");
  });
});

test("CLI flags override env vars and global config", async () => {
  await withTempDir("myriad-cli-config-test-", async (xdgRoot) => {
    await writeGlobalConfig(xdgRoot, {
      chainId: 97,
      rpcUrl: "https://rpc.global.example",
      predictionMarketAddress: "0x1111111111111111111111111111111111111111",
      predictionMarketQuerierAddress: "0x2222222222222222222222222222222222222222",
      collateralTokenAddress: "0x3333333333333333333333333333333333333333"
    });

    const result = await runCli(
      [
        "--private-key",
        PRIVATE_KEY_A,
        "--chain-id",
        "56",
        "--collateral-token-address",
        "0x5555555555555555555555555555555555555555",
        "wallet",
        "deposit",
        "--json"
      ],
      {
        XDG_CONFIG_HOME: xdgRoot,
        MYRIAD_CHAIN_ID: "97",
        MYRIAD_COLLATERAL_TOKEN: "0x4444444444444444444444444444444444444444"
      },
      xdgRoot
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.chainId, 56);
    assert.equal(payload.assets.collateral.address.toLowerCase(), "0x5555555555555555555555555555555555555555");
  });
});
