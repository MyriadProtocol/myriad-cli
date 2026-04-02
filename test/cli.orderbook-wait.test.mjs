import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRIVATE_KEY_A = "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0";
const ORDERBOOK_TEST_ENV = {
  MYRIAD_USD1_TOKEN: "0x54eC4711c4a429D7b0466dd169079f276a868462",
  MYRIAD_OB_EXCHANGE_ADDRESS: "0x93DcC4b0858fA91D48C53D4FEA6Dca40465E4753",
  MYRIAD_OB_CONDITIONAL_TOKENS: "0xf512f0363a7E9aD622f03D69966530b791C68F88",
  MYRIAD_OB_MANAGER: "0x1a36B32262Fd8940F555A7E7f4B4cFc022bFc61E",
  MYRIAD_OB_NEG_RISK_ADAPTER: "0x16634142cE11B859Acb452a92C32DBb6be1B761f",
  MYRIAD_WRAPPED_COLLATERAL: "0x767a701435744062F41227514Aeb8C4362F984f3"
};
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distEntry = path.join(repoRoot, "dist/index.js");

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
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;

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

async function writeMockOrderWaitModule(dir) {
  const modulePath = path.join(dir, "mock-order-wait.mjs");
  const source = `
import { createRequire } from "node:module";

const require = createRequire(${JSON.stringify(path.join(repoRoot, "package.json"))});
const { providers } = require("ethers");

providers.JsonRpcProvider.prototype.detectNetwork = async function () {
  return { chainId: 97, name: "bnbt" };
};

if (process.env.MYRIAD_TEST_TTY === "1") {
  try {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  } catch {
    process.stdout.isTTY = true;
  }
}

if (process.env.MYRIAD_TEST_FAKE_TIME === "1") {
  let now = 1700000000000;
  Date.now = () => now;
  globalThis.setTimeout = (handler, delay = 0, ...args) => {
    now += Number(delay) || 0;
    if (typeof handler === "function") {
      handler(...args);
    }
    return 0;
  };
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";

  if (method === "GET" && url.pathname === "/markets/42") {
    return new Response(JSON.stringify({
      id: 42,
      slug: "test-market",
      title: "Will it rain?",
      state: "open",
      networkId: 97,
      executionMode: 1,
      token: {
        address: "0x54eC4711c4a429D7b0466dd169079f276a868462",
        decimals: 18
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "GET" && url.pathname === "/markets/42/orderbook") {
    return new Response(JSON.stringify({
      bids: [],
      asks: [["550000000000000000", "2000000000000000000"]]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "POST" && url.pathname === "/orders") {
    return new Response(JSON.stringify({
      orderHash: "0xcliwait",
      status: "open",
      timeInForce: "FAK"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "GET" && url.pathname === "/orders/0xcliwait") {
    const behavior = process.env.MYRIAD_TEST_ORDER_BEHAVIOR ?? "timeout";
    const settled = behavior === "filled";
    return new Response(JSON.stringify({
      orderHash: "0xcliwait",
      status: settled ? "filled" : "open",
      filledAmount: settled ? "2000000000000000000" : "0",
      timeInForce: "FAK",
      order: {
        trader: "0x6a8fbe3c8f5c0f40e6f00d3c38f14590c3a74e62",
        marketId: 42,
        outcomeId: 0,
        side: 0,
        amount: "2000000000000000000",
        price: "550000000000000000",
        minFillAmount: "0",
        nonce: "1",
        expiration: "0"
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: "Unhandled route", method, pathname: url.pathname, search: url.search }), {
    status: 404,
    headers: { "content-type": "application/json" }
  });
};
`;
  await writeFile(modulePath, source, "utf8");
  return modulePath;
}

function orderbookCommandArgs({ globalArgs = [], commandArgs = [] } = {}) {
  return [
    ...globalArgs,
    "--api-base-url",
    "https://mock.myriad.local",
    "--chain-id",
    "97",
    "--rpc-url",
    "https://rpc.example.com",
    "--private-key",
    PRIVATE_KEY_A,
    "ob",
    "market",
    "buy",
    "--market-id",
    "42",
    "--outcome-id",
    "0",
    "--shares",
    "2",
    "--skip-approval",
    ...commandArgs
  ];
}

test("plain non-TTY order waits stay silent until the final summary", async () => {
  await withTempDir("myriad-cli-ob-wait-plain-", async (cwd) => {
    const mockModule = await writeMockOrderWaitModule(cwd);
    const result = await runCli(orderbookCommandArgs(), {
      ...ORDERBOOK_TEST_ENV,
      NODE_OPTIONS: `--import=${mockModule}`,
      MYRIAD_TEST_FAKE_TIME: "1",
      MYRIAD_TEST_ORDER_BEHAVIOR: "timeout"
    }, cwd);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /Order posted with/);
    assert.doesNotMatch(result.stdout, /Waiting for matching response/);
    assert.match(result.stdout, /Section: summary/);
    assert.match(result.stdout, /\|\s*completion\s*\|\s*Pending sync\s*\|/);
  });
});

test("json order waits do not emit progress messages even in TTY mode", async () => {
  await withTempDir("myriad-cli-ob-wait-json-", async (cwd) => {
    const mockModule = await writeMockOrderWaitModule(cwd);
    const result = await runCli(orderbookCommandArgs({ globalArgs: ["--json"] }), {
      ...ORDERBOOK_TEST_ENV,
      NODE_OPTIONS: `--import=${mockModule}`,
      MYRIAD_TEST_TTY: "1",
      MYRIAD_TEST_FAKE_TIME: "1",
      MYRIAD_TEST_ORDER_BEHAVIOR: "timeout"
    }, cwd);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /Order posted with/);
    assert.doesNotMatch(result.stdout, /Waiting for matching response/);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.waitMs, 20000);
    assert.equal(payload.completion, "pending_sync");
    assert.equal(payload.timedOut, true);
  });
});

test("plain TTY order waits print the posted message and countdown updates", async () => {
  await withTempDir("myriad-cli-ob-wait-tty-", async (cwd) => {
    const mockModule = await writeMockOrderWaitModule(cwd);
    const result = await runCli(orderbookCommandArgs(), {
      ...ORDERBOOK_TEST_ENV,
      NODE_OPTIONS: `--import=${mockModule}`,
      MYRIAD_TEST_TTY: "1",
      MYRIAD_TEST_FAKE_TIME: "1",
      MYRIAD_TEST_ORDER_BEHAVIOR: "timeout"
    }, cwd);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Order posted with FAK/);
    assert.match(result.stdout, /Waiting for matching response \(20 more seconds\)/);
    assert.match(result.stdout, /Waiting for matching response \(15 more seconds\)/);
    assert.match(result.stdout, /Waiting for matching response \(10 more seconds\)/);
    assert.match(result.stdout, /Waiting for matching response \(5 more seconds\)/);
    assert.match(result.stdout, /Section: summary/);
    assert.match(result.stdout, /\|\s*completion\s*\|\s*Pending sync\s*\|/);
  });
});
