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
const privateKey = "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0";

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
const negRiskId = "0x" + "1".repeat(64);
const eventPayload = {
  id: "event-1",
  networkId: 56,
  slug: "election",
  title: "Election 2028",
  state: "open",
  expiresAt: "2028-11-05T00:00:00.000Z",
  negRisk: true,
  negRiskId,
  volume: 1234.56,
  liquidity: 789.01,
  markets: [
    {
      id: 42,
      title: "Candidate A",
      outcomeIndex: 0,
      state: "open",
      executionMode: 1,
      token: {
        address: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
        decimals: 18
      },
      outcomes: [
        { title: "Yes", price: 0.62 },
        { title: "No", price: 0.38 }
      ]
    }
  ]
};

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method ?? "GET";

  if (method === "GET" && url.pathname === "/events") {
    if (url.searchParams.get("network_id") !== "56" || url.searchParams.get("state") !== "open") {
      return new Response(JSON.stringify({ error: "unexpected events query", search: url.search }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ data: [eventPayload] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "GET" && url.pathname === "/events/election") {
    return new Response(JSON.stringify(eventPayload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "GET" && url.pathname === "/events/event-1/orderbook") {
    return new Response(JSON.stringify({
      outcomes: [
        {
          marketId: "market-1",
          ethMarketId: 42,
          outcomeIndex: 0,
          title: "Candidate A",
          orderbook: {
            asks: [["620000000000000000", "2000000000000000000"]],
            bids: [["600000000000000000", "1000000000000000000"]]
          }
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "GET" && url.pathname === "/events/event-1/actions") {
    if (
      url.searchParams.get("trading_model") !== "ob" ||
      url.searchParams.get("since") !== "1700000000" ||
      url.searchParams.get("only_relevant") !== "true" ||
      url.searchParams.get("page") !== "2" ||
      url.searchParams.get("limit") !== "10"
    ) {
      return new Response(JSON.stringify({ error: "unexpected actions query", search: url.search }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      data: [
        {
          user: "0xuser",
          action: "buy",
          marketTitle: "Candidate A",
          marketSlug: "candidate-a",
          marketId: 42,
          networkId: 56,
          outcomeTitle: "Yes",
          outcomeId: 0,
          shares: 1.5,
          value: 0.75,
          timestamp: 1700000000,
          txId: "0xtx"
        }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (method === "POST" && url.pathname === "/positions/neg-risk/split") {
    const body = JSON.parse(String(init.body));
    if (body.event_id !== negRiskId || body.outcome_index !== 0 || body.amount !== "2500000000000000000" || body.network_id !== 56) {
      return new Response(JSON.stringify({ error: "unexpected split body", body }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ to: "0xabc", calldata: "0x123", value: "0" }), {
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

test("myriad ob events list renders a plain event table", async () => {
  await withTempDir("myriad-cli-ob-events-list-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      ["--api-base-url", "https://mock.myriad.local", "ob", "events", "list"],
      { NODE_OPTIONS: `--import=${mockFetchModule}` },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Title\s*\|\s*Outcomes\s*\|\s*Volume\s*\|\s*Liquidity\s*\|\s*Expires At/);
    assert.match(result.stdout, /Election 2028/);
    assert.match(result.stdout, /\$1,234\.56/);
    assert.match(result.stdout, /yes/);
    assert.match(result.stdout, /event-1/);
  });
});

test("myriad ob events show returns JSON event details", async () => {
  await withTempDir("myriad-cli-ob-events-show-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      ["--api-base-url", "https://mock.myriad.local", "--json", "ob", "events", "show", "election"],
      { NODE_OPTIONS: `--import=${mockFetchModule}` },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.slug, "election");
    assert.equal(parsed.markets[0].outcomeIndex, 0);
  });
});

test("myriad ob events orderbook --render prints event ladders", async () => {
  await withTempDir("myriad-cli-ob-events-orderbook-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      ["--api-base-url", "https://mock.myriad.local", "ob", "events", "orderbook", "election", "--render"],
      { NODE_OPTIONS: `--import=${mockFetchModule}` },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Event orderbook: Election 2028/);
    assert.match(result.stdout, /Orderbook: Candidate A/);
    assert.match(result.stdout, /Outcome Index: 0/);
    assert.match(result.stdout, /Mid: 0\.6100/);
    assert.throws(() => JSON.parse(result.stdout));
  });
});

test("myriad ob events actions maps filters and returns JSON", async () => {
  await withTempDir("myriad-cli-ob-events-actions-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      [
        "--api-base-url",
        "https://mock.myriad.local",
        "--json",
        "ob",
        "events",
        "actions",
        "election",
        "--since",
        "1700000000",
        "--only-relevant",
        "--page",
        "2",
        "--limit",
        "10"
      ],
      { NODE_OPTIONS: `--import=${mockFetchModule}` },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.tradingModel, "ob");
    assert.equal(parsed.data[0].action, "buy");
  });
});

test("myriad ob positions neg-risk split dry-run builds calldata payload", async () => {
  await withTempDir("myriad-cli-ob-neg-risk-split-", async (cwd) => {
    const mockFetchModule = await writeMockFetchModule(cwd);
    const result = await runCli(
      [
        "--api-base-url",
        "https://mock.myriad.local",
        "--private-key",
        privateKey,
        "--json",
        "ob",
        "positions",
        "neg-risk",
        "split",
        "--event",
        "election",
        "--outcome-index",
        "0",
        "--amount",
        "2.5",
        "--dry-run"
      ],
      { NODE_OPTIONS: `--import=${mockFetchModule}` },
      cwd
    );

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.eventId, "event-1");
    assert.equal(parsed.outcomeIndex, 0);
    assert.equal(parsed.amountRaw, "2500000000000000000");
    assert.equal(parsed.approval.type, "erc20_allowance");
    assert.equal(parsed.call.calldata, "0x123");
  });
});
