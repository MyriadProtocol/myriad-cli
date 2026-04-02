import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMyriadMcpServer, MCP_TOOL_NAMES } from "../dist/mcp-server.js";

function createOperationsStub(overrides = {}) {
  return {
    async listMarkets(_input, _apiOverrides) {
      return { ok: true };
    },
    async showMarket() {
      return { ok: true };
    },
    async usersPortfolio() {
      return { ok: true };
    },
    async portfolio() {
      return { ok: true };
    },
    async walletBalances() {
      return { ok: true };
    },
    async swapStable() {
      return { ok: true };
    },
    async tradeBuy() {
      return { ok: true };
    },
    async tradeSell() {
      return { ok: true };
    },
    async claimWinnings() {
      return { ok: true };
    },
    async claimVoided() {
      return { ok: true };
    },
    async claimAll() {
      return { ok: true };
    },
    async obMarketsList() {
      return { ok: true };
    },
    async obMarketsShow() {
      return { ok: true };
    },
    async obMarketOrderbook() {
      return { ok: true };
    },
    async obMarketTrades() {
      return { ok: true };
    },
    async obLimitBuy() {
      return { ok: true };
    },
    async obLimitSell() {
      return { ok: true };
    },
    async obMarketBuy() {
      return { ok: true };
    },
    async obMarketSell() {
      return { ok: true };
    },
    async obOrdersList() {
      return { ok: true };
    },
    async obOrdersShow() {
      return { ok: true };
    },
    async obOrdersCancel() {
      return { ok: true };
    },
    async obOrdersCancelAll() {
      return { ok: true };
    },
    async obPositionsList() {
      return { ok: true };
    },
    async obPositionsSplit() {
      return { ok: true };
    },
    async obPositionsMerge() {
      return { ok: true };
    },
    async obPositionsRedeem() {
      return { ok: true };
    },
    ...overrides
  };
}

async function withInMemoryClient(operations, callback) {
  const server = createMyriadMcpServer(operations, {
    name: "myriad-test",
    version: "1.0.0"
  });

  const client = new Client({
    name: "myriad-test-client",
    version: "1.0.0"
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    await callback(client);
  } finally {
    await client.close();
  }
}

test("MCP server exposes all planned tool names", async () => {
  await withInMemoryClient(createOperationsStub(), async (client) => {
    const toolList = await client.listTools();
    const names = toolList.tools.map((tool) => tool.name).sort();
    const expected = [...MCP_TOOL_NAMES].sort();
    assert.deepEqual(names, expected);
  });
});

test("markets_list maps tool args and API overrides", async () => {
  let capturedInput;
  let capturedOverrides;

  const operations = createOperationsStub({
    async listMarkets(input, apiOverrides) {
      capturedInput = input;
      capturedOverrides = apiOverrides;
      return { data: [] };
    }
  });

  await withInMemoryClient(operations, async (client) => {
    const result = await client.callTool({
      name: "markets_list",
      arguments: {
        state: "open",
        networkId: 56,
        page: 3,
        limit: 10,
        apiBaseUrl: "https://api-v2.myriadprotocol.com/",
        apiKey: "override-key"
      }
    });

    assert.notEqual(result.isError, true);
  });

  assert.deepEqual(capturedInput, {
    state: "open",
    networkId: 56,
    page: 3,
    limit: 10
  });
  assert.deepEqual(capturedOverrides, {
    apiBaseUrl: "https://api-v2.myriadprotocol.com/",
    apiKey: "override-key"
  });
});

test("ob_positions_list maps tool args and API overrides", async () => {
  let capturedInput;
  let capturedOverrides;

  const operations = createOperationsStub({
    async obPositionsList(input, apiOverrides) {
      capturedInput = input;
      capturedOverrides = apiOverrides;
      return { data: [] };
    }
  });

  await withInMemoryClient(operations, async (client) => {
    const result = await client.callTool({
      name: "ob_positions_list",
      arguments: {
        address: "0xabc",
        marketId: 42,
        page: 2,
        limit: 5,
        apiBaseUrl: "https://api-ob-staging.myriadprotocol.com",
        apiKey: "override-key"
      }
    });

    assert.notEqual(result.isError, true);
  });

  assert.deepEqual(capturedInput, {
    address: "0xabc",
    marketId: 42,
    page: 2,
    limit: 5
  });
  assert.deepEqual(capturedOverrides, {
    apiBaseUrl: "https://api-ob-staging.myriadprotocol.com",
    apiKey: "override-key"
  });
});

test("ob_orders_cancel_all maps tool args and API overrides", async () => {
  let capturedInput;
  let capturedOverrides;

  const operations = createOperationsStub({
    async obOrdersCancelAll(input, apiOverrides) {
      capturedInput = input;
      capturedOverrides = apiOverrides;
      return { ok: true };
    }
  });

  await withInMemoryClient(operations, async (client) => {
    const result = await client.callTool({
      name: "ob_orders_cancel_all",
      arguments: {
        marketSlug: "test-market",
        dryRun: true,
        apiBaseUrl: "https://api-ob-staging.myriadprotocol.com",
        apiKey: "override-key"
      }
    });

    assert.notEqual(result.isError, true);
  });

  assert.deepEqual(capturedInput, {
    marketSlug: "test-market",
    dryRun: true
  });
  assert.deepEqual(capturedOverrides, {
    apiBaseUrl: "https://api-ob-staging.myriadprotocol.com",
    apiKey: "override-key"
  });
});

test("ob_market_buy maps waitMs and API overrides", async () => {
  let capturedInput;
  let capturedOverrides;

  const operations = createOperationsStub({
    async obMarketBuy(input, apiOverrides) {
      capturedInput = input;
      capturedOverrides = apiOverrides;
      return { ok: true };
    }
  });

  await withInMemoryClient(operations, async (client) => {
    const result = await client.callTool({
      name: "ob_market_buy",
      arguments: {
        marketId: 42,
        outcomeId: 0,
        shares: "2",
        waitMs: 2500,
        dryRun: true,
        apiBaseUrl: "https://api-ob-staging.myriadprotocol.com",
        apiKey: "override-key"
      }
    });

    assert.notEqual(result.isError, true);
  });

  assert.deepEqual(capturedInput, {
    marketId: 42,
    outcomeId: 0,
    shares: "2",
    waitMs: 2500,
    dryRun: true
  });
  assert.deepEqual(capturedOverrides, {
    apiBaseUrl: "https://api-ob-staging.myriadprotocol.com",
    apiKey: "override-key"
  });
});

test("unknown fields are rejected (privateKey override is blocked)", async () => {
  await withInMemoryClient(createOperationsStub(), async (client) => {
    const result = await client.callTool({
      name: "markets_list",
      arguments: {
        state: "open",
        privateKey: "0xabc"
      }
    });

    assert.equal(result.isError, true);
  });
});

test("operation failures are returned as MCP tool errors", async () => {
  const operations = createOperationsStub({
    async listMarkets() {
      throw new Error("boom");
    }
  });

  await withInMemoryClient(operations, async (client) => {
    const result = await client.callTool({
      name: "markets_list",
      arguments: {
        state: "open"
      }
    });

    assert.equal(result.isError, true);
    const firstContentBlock = result.content[0];
    assert.equal(firstContentBlock.type, "text");
    assert.match(firstContentBlock.text, /boom/);
  });
});
