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
