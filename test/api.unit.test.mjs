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
