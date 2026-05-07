import test from "node:test";
import assert from "node:assert/strict";
import { MyriadApiClient } from "../dist/api.js";

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERROR",
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function withFetchStub(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => handler(new URL(String(url)), options);

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("cancelOrdersBatch posts the batch cancellation payload", async () => {
  const client = new MyriadApiClient({
    baseUrl: "https://api-v2.staging.myriadprotocol.com",
    apiKey: "test-api-key"
  });

  await withFetchStub(async (url, options) => {
    assert.equal(url.pathname, "/orders/cancel-batch");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("x-api-key"), "test-api-key");

    const body = JSON.parse(String(options.body));
    assert.equal(body.network_id, 97);
    assert.deepEqual(body.orders, [
      {
        order: {
          trader: "0xabc",
          marketId: "42",
          outcomeId: 0,
          side: 0,
          amount: "1",
          price: "2",
          minFillAmount: "0",
          nonce: "3",
          expiration: "0"
        },
        signature: "0xsig"
      }
    ]);

    return createJsonResponse({ cancelled: ["0xorder"] });
  }, async () => {
    const response = await client.cancelOrdersBatch({
      orders: [
        {
          order: {
            trader: "0xabc",
            marketId: "42",
            outcomeId: 0,
            side: 0,
            amount: "1",
            price: "2",
            minFillAmount: "0",
            nonce: "3",
            expiration: "0"
          },
          signature: "0xsig"
        }
      ],
      network_id: 97
    });

    assert.deepEqual(response, { cancelled: ["0xorder"] });
  });
});

test("cancelAllOrders posts the cancel-all payload", async () => {
  const client = new MyriadApiClient({
    baseUrl: "https://api-v2.staging.myriadprotocol.com"
  });

  await withFetchStub(async (url, options) => {
    assert.equal(url.pathname, "/orders/cancel-all");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("x-api-key"), null);

    const body = JSON.parse(String(options.body));
    assert.deepEqual(body, {
      trader: "0xabc",
      timestamp: "1700000000",
      signature: "0xsig",
      network_id: 97
    });

    return createJsonResponse({ cancelled_count: 4 });
  }, async () => {
    const response = await client.cancelAllOrders({
      trader: "0xabc",
      timestamp: "1700000000",
      signature: "0xsig",
      network_id: 97
    });

    assert.deepEqual(response, { cancelled_count: 4 });
  });
});

test("event endpoints map queries and unwrap direct event payloads", async () => {
  const client = new MyriadApiClient({
    baseUrl: "https://api-v2.staging.myriadprotocol.com"
  });

  await withFetchStub(async (url, options) => {
    assert.equal(options.method ?? "GET", "GET");

    if (url.pathname === "/events") {
      assert.equal(url.searchParams.get("network_id"), "56");
      assert.equal(url.searchParams.get("state"), "open");
      return createJsonResponse({
        data: [
          {
            id: "event-1",
            networkId: 56,
            slug: "election",
            title: "Election",
            state: "open",
            negRisk: true,
            negRiskId: "0x" + "1".repeat(64),
            markets: []
          }
        ]
      });
    }

    if (url.pathname === "/events/election") {
      return createJsonResponse({
        id: "event-1",
        networkId: 56,
        slug: "election",
        title: "Election",
        state: "open",
        negRisk: true,
        negRiskId: "0x" + "1".repeat(64),
        markets: []
      });
    }

    throw new Error(`Unexpected path ${url.pathname}`);
  }, async () => {
    const list = await client.listEvents({ network_id: 56, state: "open" });
    assert.equal(list.data[0].id, "event-1");

    const event = await client.getEvent("election");
    assert.equal(event.slug, "election");
  });
});

test("event actions and orderbook endpoints map response shapes", async () => {
  const client = new MyriadApiClient({
    baseUrl: "https://api-v2.staging.myriadprotocol.com"
  });

  await withFetchStub(async (url, options) => {
    assert.equal(options.method ?? "GET", "GET");

    if (url.pathname === "/events/election/orderbook") {
      return createJsonResponse({
        outcomes: [
          {
            marketId: "market-1",
            ethMarketId: 42,
            outcomeIndex: 0,
            title: "Candidate A",
            orderbook: { bids: [], asks: [] }
          }
        ]
      });
    }

    if (url.pathname === "/events/election/actions") {
      assert.equal(url.searchParams.get("trading_model"), "ob");
      assert.equal(url.searchParams.get("since"), "1700000000");
      assert.equal(url.searchParams.get("only_relevant"), "true");
      return createJsonResponse({
        data: [{ action: "buy", marketId: 42, outcomeId: 0 }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false }
      });
    }

    throw new Error(`Unexpected path ${url.pathname}`);
  }, async () => {
    const orderbook = await client.getEventOrderbook("election");
    assert.equal(orderbook.outcomes[0].ethMarketId, 42);

    const actions = await client.getEventActions("election", {
      trading_model: "ob",
      since: 1700000000,
      only_relevant: true
    });
    assert.equal(actions.data[0].action, "buy");
    assert.equal(actions.pagination?.total, 1);
  });
});

test("NegRisk position endpoints post calldata requests", async () => {
  const client = new MyriadApiClient({
    baseUrl: "https://api-v2.staging.myriadprotocol.com",
    apiKey: "test-api-key"
  });

  const eventId = "0x" + "2".repeat(64);
  const seenPaths = [];

  await withFetchStub(async (url, options) => {
    seenPaths.push(url.pathname);
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("x-api-key"), "test-api-key");

    const body = JSON.parse(String(options.body));
    assert.deepEqual(body, {
      event_id: eventId,
      outcome_index: 0,
      amount: "1000000000000000000",
      network_id: 56
    });

    return createJsonResponse({ to: "0xabc", calldata: "0x123", value: "0" });
  }, async () => {
    await client.splitNegRiskPosition({
      event_id: eventId,
      outcome_index: 0,
      amount: "1000000000000000000",
      network_id: 56
    });
    await client.mergeNegRiskPosition({
      event_id: eventId,
      outcome_index: 0,
      amount: "1000000000000000000",
      network_id: 56
    });
  });

  assert.deepEqual(seenPaths, ["/positions/neg-risk/split", "/positions/neg-risk/merge"]);
});
