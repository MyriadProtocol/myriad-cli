import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function writeMockFetchModule(dir) {
  const modulePath = path.join(dir, "mock-fetch.mjs");
  const source = `
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";
  const expectedNetworkId = process.env.MYRIAD_EXPECT_NETWORK_ID;
  const marketNetworkId = expectedNetworkId ? Number(expectedNetworkId) : 97;

  if (expectedNetworkId && method === "GET" && url.pathname === "/markets/42") {
    const actualNetworkId = url.searchParams.get("network_id");
    if (actualNetworkId !== expectedNetworkId) {
      return new Response(JSON.stringify({ error: "unexpected network", expectedNetworkId, actualNetworkId }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
  }

  if (method === "GET" && url.pathname === "/markets/42") {
    return new Response(JSON.stringify({
      id: 42,
      slug: "test-market",
      title: "Will it rain?",
      state: "open",
      networkId: marketNetworkId,
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
      asks: [
        ["550000000000000000", "1000000000000000000"],
        ["600000000000000000", "2500000000000000000"]
      ],
      bids: [
        ["500000000000000000", "3000000000000000000"],
        ["450000000000000000", "2000000000000000000"]
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "GET" && url.pathname === "/markets/42/trades") {
    return new Response(JSON.stringify([
      {
        price: "0.5100",
        amount: "1000000000000000000",
        side: "buy",
        outcome: 0,
        timestamp: 1719835200
      }
    ]), {
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

test("myriad ob markets orderbook --help includes render options", async () => {
  await withTempDir("myriad-cli-ob-render-help-", async (cwd) => {
    const result = await runCli(["ob", "markets", "orderbook", "--help"], {}, cwd);

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /--render/);
    assert.match(result.stdout, /--levels <n>/);
  });
});

test("myriad ob markets orderbook --render prints an ASCII ladder", async () => {
  await withTempDir("myriad-cli-ob-render-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      [
        "--api-base-url",
        "https://mock.myriad.local",
        "--chain-id",
        "97",
        "--rpc-url",
        "https://rpc.example.com",
        "ob",
        "markets",
        "orderbook",
        "--market-id",
        "42",
        "--render"
      ],
      {
        NODE_OPTIONS: `--import=${mockFetchModule}`,
        FORCE_COLOR: "1"
      },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Orderbook: Will it rain\?/);
    assert.match(result.stdout, /Asks/);
    assert.match(result.stdout, /Price\s+Shares\s+Sum/);
    assert.match(result.stdout, /Last: 0\.5100 \| Mid: 0\.5250 \| Spread: 0\.0500/);
    assert.match(result.stdout, /Bids/);
    assert.match(result.stdout, /Asks[\s\S]*\x1b\[31m█+/);
    assert.match(result.stdout, /Bids[\s\S]*\x1b\[32m█+/);
    assert.doesNotMatch(result.stdout, /Section: summary/);
    assert.doesNotMatch(result.stdout, /\+-[-+]+\+/);
    assert.throws(() => JSON.parse(result.stdout));
  });
});

test("myriad ob markets orderbook --render takes precedence over --json", async () => {
  await withTempDir("myriad-cli-ob-render-json-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      [
        "--api-base-url",
        "https://mock.myriad.local",
        "--chain-id",
        "97",
        "--rpc-url",
        "https://rpc.example.com",
        "--json",
        "ob",
        "markets",
        "orderbook",
        "--market-id",
        "42",
        "--render"
      ],
      {
        NODE_OPTIONS: `--import=${mockFetchModule}`
      },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Orderbook: Will it rain\?/);
    assert.match(result.stdout, /Last: 0\.5100 \| Mid: 0\.5250 \| Spread: 0\.0500/);
    assert.throws(() => JSON.parse(result.stdout));
  });
});

test("myriad ob markets orderbook without --render keeps raw JSON output", async () => {
  await withTempDir("myriad-cli-ob-raw-json-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      [
        "--api-base-url",
        "https://mock.myriad.local",
        "--chain-id",
        "97",
        "--rpc-url",
        "https://rpc.example.com",
        "--json",
        "ob",
        "markets",
        "orderbook",
        "--market-id",
        "42"
      ],
      {
        NODE_OPTIONS: `--import=${mockFetchModule}`
      },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.marketId, 42);
    assert.equal(payload.marketTitle, "Will it rain?");
    assert.equal(payload.outcomeId, 0);
    assert.deepEqual(payload.asks, [
      ["550000000000000000", "1000000000000000000"],
      ["600000000000000000", "2500000000000000000"]
    ]);
    assert.deepEqual(payload.bids, [
      ["500000000000000000", "3000000000000000000"],
      ["450000000000000000", "2000000000000000000"]
    ]);
  });
});

test("myriad ob markets orderbook defaults to chain 56 when no chain override is provided", async () => {
  await withTempDir("myriad-cli-ob-default-chain-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      [
        "--api-base-url",
        "https://mock.myriad.local",
        "ob",
        "markets",
        "orderbook",
        "--market-id",
        "42",
        "--json"
      ],
      {
        NODE_OPTIONS: `--import=${mockFetchModule}`,
        MYRIAD_EXPECT_NETWORK_ID: "56"
      },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.marketId, 42);
  });
});
