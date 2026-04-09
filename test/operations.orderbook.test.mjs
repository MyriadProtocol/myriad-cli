import test from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { MyriadOperations } from "../dist/operations.js";

const providers = { JsonRpcProvider };
const utils = {
  parseUnits,
  defaultAbiCoder: AbiCoder.defaultAbiCoder()
};

const PRIVATE_KEY_A = "0x59c6995e998f97a5a0044966f094538e3f5ed6a45d8f4d35f7f510f0f4f3f0f0";
const CLOB_CANCEL_ALL_TYPES = {
  CancelAll: [
    { name: "trader", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "timestamp", type: "uint256" }
  ]
};

function createObRuntime(overrides = {}) {
  return {
    apiBaseUrl: "https://api-v2.staging.myriadprotocol.com",
    apiKey: "test-api-key",
    chainId: 97,
    rpcUrl: "https://rpc.example.com",
    privateKey: PRIVATE_KEY_A,
    collateralTokenAddress: "0x54eC4711c4a429D7b0466dd169079f276a868462",
    usd1TokenAddress: "0x54eC4711c4a429D7b0466dd169079f276a868462",
    obExchangeAddress: "0x93DcC4b0858fA91D48C53D4FEA6Dca40465E4753",
    obConditionalTokens: "0xf512f0363a7E9aD622f03D69966530b791C68F88",
    obManager: "0x1a36B32262Fd8940F555A7E7f4B4cFc022bFc61E",
    obNegRiskAdapter: "0x16634142cE11B859Acb452a92C32DBb6be1B761f",
    wrappedCollateral: "0x767a701435744062F41227514Aeb8C4362F984f3",
    ...overrides
  };
}

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

async function signCancelAll(runtime, trader, marketId, timestamp) {
  const wallet = new Wallet(PRIVATE_KEY_A);
  return wallet.signTypedData(
    {
      name: "MyriadCTFExchange",
      version: "1",
      chainId: runtime.chainId,
      verifyingContract: runtime.obExchangeAddress
    },
    CLOB_CANCEL_ALL_TYPES,
    {
      trader,
      marketId,
      timestamp
    }
  );
}

function withFetchStub(routes, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const resolved = new URL(String(url));
    const key = `${options.method ?? "GET"} ${resolved.pathname}`;
    let handler = routes[key];
    if (!handler) {
      for (const [pattern, candidate] of Object.entries(routes)) {
        if (pattern.endsWith("*") && key.startsWith(pattern.slice(0, -1))) {
          handler = candidate;
          break;
        }
      }
    }
    if (!handler) {
      throw new Error(`Unexpected fetch: ${key}`);
    }
    return handler(resolved, options);
  };

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

async function withFakeTime(callback) {
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const originalDetectNetwork = providers.JsonRpcProvider.prototype._detectNetwork;
  let now = 1_700_000_000_000;

  Date.now = () => now;
  globalThis.setTimeout = (handler, delay = 0, ...args) => {
    now += Number(delay) || 0;
    if (typeof handler === "function") {
      handler(...args);
    }
    return 0;
  };
  providers.JsonRpcProvider.prototype._detectNetwork = async function () {
    return { chainId: 97n, name: "bnbt" };
  };

  try {
    return await callback({
      now: () => now
    });
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
    providers.JsonRpcProvider.prototype._detectNetwork = originalDetectNetwork;
  }
}

test("obLimitBuy dry-run signs a normalized order payload", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /markets/42": (url) => {
        assert.equal(url.searchParams.get("network_id"), "97");
        return createJsonResponse({
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
        });
      }
    },
    async () => {
      const result = await operations.obLimitBuy({
        marketId: 42,
        outcomeId: 0,
        price: "0.55",
        shares: "2.5",
        dryRun: true
      });

      assert.equal(result.timeInForce, "GTC");
      assert.equal(result.order.side, 0);
      assert.equal(result.order.marketId, "42");
      assert.equal(result.order.amount, utils.parseUnits("2.5", 18).toString());
      assert.equal(result.order.price, utils.parseUnits("0.55", 18).toString());
      assert.match(result.orderHash, /^0x[0-9a-f]{64}$/i);
      assert.match(result.signature, /^0x[0-9a-f]{130}$/i);
      assert.equal(result.approval.type, "erc20_allowance");
    }
  );
});

test("obMarketsShow requests execution_mode=1 for orderbook market details", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /markets/42": (url) => {
        assert.equal(url.searchParams.get("network_id"), "97");
        assert.equal(url.searchParams.get("execution_mode"), "1");
        return createJsonResponse({
          id: 42,
          slug: "test-market",
          title: "Will it rain?",
          state: "open",
          networkId: 97,
          executionMode: 1
        });
      }
    },
    async () => {
      const result = await operations.obMarketsShow("42");
      assert.equal(result.id, 42);
      assert.equal(result.executionMode, 1);
    }
  );
});

test("obMarketBuy dry-run derives shares and price from the orderbook", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "GET /markets/42/orderbook": (url) => {
        assert.equal(url.searchParams.get("network_id"), "97");
        assert.equal(url.searchParams.get("outcome"), "0");
        return createJsonResponse({
          bids: [],
          asks: [
            [utils.parseUnits("0.5", 18).toString(), utils.parseUnits("1", 18).toString()],
            [utils.parseUnits("0.6", 18).toString(), utils.parseUnits("5", 18).toString()]
          ]
        });
      }
    },
    async () => {
      const result = await operations.obMarketBuy({
        marketId: 42,
        outcomeId: 0,
        value: "1.1",
        dryRun: true
      });

      assert.equal(result.timeInForce, "FAK");
      assert.equal(result.order.amount, utils.parseUnits("2", 18).toString());
      assert.equal(result.order.price, utils.parseUnits("0.6", 18).toString());
      assert.equal(result.marketQuote.inputMode, "value");
      assert.equal(result.marketQuote.estimatedSharesRaw, utils.parseUnits("2", 18).toString());
      assert.equal(result.marketQuote.deepestPriceRaw, utils.parseUnits("0.6", 18).toString());
      assert.match(result.marketQuote.note, /Derived from the current book snapshot/);
    }
  );
});

test("obLimitBuy falls back to USD1 for orderbook collateral when generic collateral is not set", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime({
      chainId: 56,
      apiBaseUrl: "https://api-v2.myriadprotocol.com/",
      rpcUrl: "https://bsc-dataseed.binance.org/",
      collateralTokenAddress: undefined,
      usd1TokenAddress: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
      obExchangeAddress: "0xa0b6f8ef8EdB64f395018D1933f2273Ce9f0f16A",
      obConditionalTokens: "0x6413734f92248D4B29ae35883290BD93212654Dc",
      obManager: "0xaB5591E280fF9Bf368DB60c3b775b5C7Ba5ea3dB",
      obNegRiskAdapter: "0xd96F26703Ddbf7d1Cb6858640eca34cF1893d53A",
      wrappedCollateral: "0x9F124ce59D8De0274574949400640a2677067ACC"
    })
  });

  await withFetchStub(
    {
      "GET /markets/42": (url) => {
        assert.equal(url.searchParams.get("network_id"), "56");
        return createJsonResponse({
          id: 42,
          slug: "test-market",
          title: "Will it rain?",
          state: "open",
          networkId: 56,
          executionMode: 1
        });
      }
    },
    async () => {
      const result = await operations.obLimitBuy({
        marketId: 42,
        outcomeId: 0,
        price: "0.55",
        shares: "2.5",
        dryRun: true
      });

      assert.equal(result.approval.type, "erc20_allowance");
      assert.equal(result.approval.tokenAddress, "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d");
      assert.equal(result.approval.spenderAddress, "0xa0b6f8ef8EdB64f395018D1933f2273Ce9f0f16A");
    }
  );
});

test("obMarketBuy polls by default for FAK orders and returns filled completion", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  let getOrderCalls = 0;

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "GET /markets/42/orderbook": () =>
        createJsonResponse({
          bids: [],
          asks: [["550000000000000000", "2000000000000000000"]]
        }),
      "POST /orders": async () =>
        createJsonResponse({
          orderHash: "0xfeed",
          status: "open",
          timeInForce: "FAK"
        }),
      "GET /orders/*": async () => {
        getOrderCalls += 1;
        return createJsonResponse({
          orderHash: "0xfeed",
          status: "filled",
          filledAmount: utils.parseUnits("2", 18).toString(),
          timeInForce: "FAK",
          order: {
            trader: new Wallet(PRIVATE_KEY_A).address,
            marketId: 42,
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.55", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          }
        });
      }
    },
    async () => {
      const result = await operations.obMarketBuy({
        marketId: 42,
        outcomeId: 0,
        shares: "2",
        skipApproval: true
      });

      assert.equal(result.waitMs, 20000);
      assert.equal(result.polled, true);
      assert.equal(result.timedOut, false);
      assert.equal(result.finalized, true);
      assert.equal(result.completion, "filled");
      assert.equal(result.observedStatus, "filled");
      assert.equal(result.followUpCommand, `myriad ob orders show ${result.orderHash} --json`);
      assert.equal(getOrderCalls, 1);
    }
  );
});

test("obLimitBuy does not poll by default for GTC orders", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "POST /orders": async () =>
        createJsonResponse({
          orderHash: "0xgtc",
          status: "open",
          timeInForce: "GTC"
        })
    },
    async () => {
      const result = await operations.obLimitBuy({
        marketId: 42,
        outcomeId: 0,
        price: "0.55",
        shares: "2",
        skipApproval: true
      });

      assert.equal(result.waitMs, 0);
      assert.equal(result.polled, false);
      assert.equal(result.timedOut, false);
      assert.equal(result.finalized, false);
      assert.equal(result.completion, "open");
    }
  );
});

test("obLimitBuy uses short polling by default for FOK orders", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  let getOrderCalls = 0;

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "POST /orders": async () =>
        createJsonResponse({
          orderHash: "0xfok",
          status: "open",
          timeInForce: "FOK"
        }),
      "GET /orders/*": async () => {
        getOrderCalls += 1;
        return createJsonResponse({
          orderHash: "0xfok",
          status: "cancelled",
          filledAmount: "0",
          timeInForce: "FOK",
          order: {
            trader: new Wallet(PRIVATE_KEY_A).address,
            marketId: 42,
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.55", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          }
        });
      }
    },
    async () => {
      const result = await operations.obLimitBuy({
        marketId: 42,
        outcomeId: 0,
        price: "0.55",
        shares: "2",
        timeInForce: "FOK",
        skipApproval: true
      });

      assert.equal(result.waitMs, 20000);
      assert.equal(result.polled, true);
      assert.equal(result.completion, "cancelled");
      assert.equal(getOrderCalls, 1);
    }
  );
});

test("order wait progress reporter emits default countdown thresholds", async () => {
  const progressEvents = [];
  await withFakeTime(async () => {
    const operations = new MyriadOperations({
      runtime: createObRuntime(),
      orderWaitProgressReporter: (event) => {
        progressEvents.push(event);
      }
    });

    await withFetchStub(
      {
        "GET /markets/42": () =>
          createJsonResponse({
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
          }),
        "GET /markets/42/orderbook": () =>
          createJsonResponse({
            bids: [],
            asks: [["550000000000000000", "2000000000000000000"]]
          }),
        "POST /orders": async () =>
          createJsonResponse({
            orderHash: "0xprogress",
            status: "open",
            timeInForce: "FAK"
          }),
        "GET /orders/*": async () =>
          createJsonResponse({
            orderHash: "0xprogress",
            status: "open",
            filledAmount: "0",
            timeInForce: "FAK",
            order: {
              trader: new Wallet(PRIVATE_KEY_A).address,
              marketId: 42,
              outcomeId: 0,
              side: 0,
              amount: utils.parseUnits("2", 18).toString(),
              price: utils.parseUnits("0.55", 18).toString(),
              minFillAmount: "0",
              nonce: "1",
              expiration: "0"
            }
          })
      },
      async () => {
        const result = await operations.obMarketBuy({
          marketId: 42,
          outcomeId: 0,
          shares: "2",
          skipApproval: true
        });

        assert.equal(result.waitMs, 20000);
        assert.equal(result.timedOut, true);
        assert.equal(result.completion, "pending_sync");
      }
    );
  });

  assert.deepEqual(progressEvents, [
    { type: "posted", timeInForce: "FAK" },
    { type: "countdown", remainingSeconds: 20 },
    { type: "countdown", remainingSeconds: 15 },
    { type: "countdown", remainingSeconds: 10 },
    { type: "countdown", remainingSeconds: 5 }
  ]);
});

test("order wait progress reporter uses custom countdown thresholds", async () => {
  const progressEvents = [];
  await withFakeTime(async () => {
    const operations = new MyriadOperations({
      runtime: createObRuntime(),
      orderWaitProgressReporter: (event) => {
        progressEvents.push(event);
      }
    });

    await withFetchStub(
      {
        "GET /markets/42": () =>
          createJsonResponse({
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
          }),
        "GET /markets/42/orderbook": () =>
          createJsonResponse({
            bids: [],
            asks: [["550000000000000000", "2000000000000000000"]]
          }),
        "POST /orders": async () =>
          createJsonResponse({
            orderHash: "0xprogress-custom",
            status: "open",
            timeInForce: "FAK"
          }),
        "GET /orders/*": async () =>
          createJsonResponse({
            orderHash: "0xprogress-custom",
            status: "open",
            filledAmount: "0",
            timeInForce: "FAK",
            order: {
              trader: new Wallet(PRIVATE_KEY_A).address,
              marketId: 42,
              outcomeId: 0,
              side: 0,
              amount: utils.parseUnits("2", 18).toString(),
              price: utils.parseUnits("0.55", 18).toString(),
              minFillAmount: "0",
              nonce: "1",
              expiration: "0"
            }
          })
      },
      async () => {
        const result = await operations.obMarketBuy({
          marketId: 42,
          outcomeId: 0,
          shares: "2",
          waitMs: 12000,
          skipApproval: true
        });

        assert.equal(result.waitMs, 12000);
        assert.equal(result.timedOut, true);
      }
    );
  });

  assert.deepEqual(progressEvents, [
    { type: "posted", timeInForce: "FAK" },
    { type: "countdown", remainingSeconds: 12 },
    { type: "countdown", remainingSeconds: 10 },
    { type: "countdown", remainingSeconds: 5 }
  ]);
});

test("order wait progress reporter stops after terminal status is observed", async () => {
  const progressEvents = [];

  await withFakeTime(async ({ now }) => {
    const startedAt = now();
    const operations = new MyriadOperations({
      runtime: createObRuntime(),
      orderWaitProgressReporter: (event) => {
        progressEvents.push(event);
      }
    });

    await withFetchStub(
      {
        "GET /markets/42": () =>
          createJsonResponse({
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
          }),
        "GET /markets/42/orderbook": () =>
          createJsonResponse({
            bids: [],
            asks: [["550000000000000000", "2000000000000000000"]]
          }),
        "POST /orders": async () =>
          createJsonResponse({
            orderHash: "0xprogress-stop",
            status: "open",
            timeInForce: "FAK"
          }),
        "GET /orders/*": async () => {
          const settled = now() >= startedAt + 5000;
          return createJsonResponse({
            orderHash: "0xprogress-stop",
            status: settled ? "filled" : "open",
            filledAmount: settled ? utils.parseUnits("2", 18).toString() : "0",
            timeInForce: "FAK",
            order: {
              trader: new Wallet(PRIVATE_KEY_A).address,
              marketId: 42,
              outcomeId: 0,
              side: 0,
              amount: utils.parseUnits("2", 18).toString(),
              price: utils.parseUnits("0.55", 18).toString(),
              minFillAmount: "0",
              nonce: "1",
              expiration: "0"
            }
          });
        }
      },
      async () => {
        const result = await operations.obMarketBuy({
          marketId: 42,
          outcomeId: 0,
          shares: "2",
          skipApproval: true
        });

        assert.equal(result.finalized, true);
        assert.equal(result.completion, "filled");
      }
    );
  });

  assert.deepEqual(progressEvents, [
    { type: "posted", timeInForce: "FAK" },
    { type: "countdown", remainingSeconds: 20 },
    { type: "countdown", remainingSeconds: 15 }
  ]);
});

test("obMarketBuy honors waitMs=0 and returns pending_sync without polling", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "GET /markets/42/orderbook": () =>
        createJsonResponse({
          bids: [],
          asks: [["550000000000000000", "2000000000000000000"]]
        }),
      "POST /orders": async () =>
        createJsonResponse({
          orderHash: "0xnowait",
          status: "open",
          timeInForce: "FAK"
        })
    },
    async () => {
      const result = await operations.obMarketBuy({
        marketId: 42,
        outcomeId: 0,
        shares: "2",
        waitMs: 0,
        skipApproval: true
      });

      assert.equal(result.waitMs, 0);
      assert.equal(result.polled, false);
      assert.equal(result.completion, "pending_sync");
    }
  );
});

test("obMarketBuy retries transient 404s while polling", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  let getOrderCalls = 0;

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "GET /markets/42/orderbook": () =>
        createJsonResponse({
          bids: [],
          asks: [["550000000000000000", "2000000000000000000"]]
        }),
      "POST /orders": async () =>
        createJsonResponse({
          orderHash: "0xretry",
          status: "open",
          timeInForce: "FAK"
        }),
      "GET /orders/*": async () => {
        getOrderCalls += 1;
        if (getOrderCalls === 1) {
          return createJsonResponse({ error: "not found yet" }, 404);
        }
        return createJsonResponse({
          orderHash: "0xretry",
          status: "filled",
          filledAmount: utils.parseUnits("2", 18).toString(),
          timeInForce: "FAK",
          order: {
            trader: new Wallet(PRIVATE_KEY_A).address,
            marketId: 42,
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.55", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          }
        });
      }
    },
    async () => {
      const result = await operations.obMarketBuy({
        marketId: 42,
        outcomeId: 0,
        shares: "2",
        waitMs: 20,
        skipApproval: true
      });

      assert.equal(result.completion, "filled");
      assert.equal(getOrderCalls, 2);
    }
  );
});

test("obMarketBuy returns pending_sync when polling times out", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "GET /markets/42/orderbook": () =>
        createJsonResponse({
          bids: [],
          asks: [["550000000000000000", "2000000000000000000"]]
        }),
      "POST /orders": async () =>
        createJsonResponse({
          orderHash: "0xtimeout",
          status: "open",
          timeInForce: "FAK"
        }),
      "GET /orders/*": async () =>
        createJsonResponse({
          orderHash: "0xtimeout",
          status: "open",
          filledAmount: "0",
          timeInForce: "FAK",
          order: {
            trader: new Wallet(PRIVATE_KEY_A).address,
            marketId: 42,
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.55", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          }
        })
    },
    async () => {
      const result = await operations.obMarketBuy({
        marketId: 42,
        outcomeId: 0,
        shares: "2",
        waitMs: 1,
        skipApproval: true
      });

      assert.equal(result.polled, true);
      assert.equal(result.timedOut, true);
      assert.equal(result.completion, "pending_sync");
      assert.equal(result.observedStatus, "open");
    }
  );
});

test("obMarketBuy marks cancelled orders with partial fill as partially_filled", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /markets/42": () =>
        createJsonResponse({
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
        }),
      "GET /markets/42/orderbook": () =>
        createJsonResponse({
          bids: [],
          asks: [["550000000000000000", "2000000000000000000"]]
        }),
      "POST /orders": async () =>
        createJsonResponse({
          orderHash: "0xpartial",
          status: "open",
          timeInForce: "FAK"
        }),
      "GET /orders/*": async () =>
        createJsonResponse({
          orderHash: "0xpartial",
          status: "cancelled",
          filledAmount: utils.parseUnits("0.5", 18).toString(),
          timeInForce: "FAK",
          order: {
            trader: new Wallet(PRIVATE_KEY_A).address,
            marketId: 42,
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.55", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          }
        })
    },
    async () => {
      const result = await operations.obMarketBuy({
        marketId: 42,
        outcomeId: 0,
        shares: "2",
        skipApproval: true
      });

      assert.equal(result.finalized, true);
      assert.equal(result.observedStatus, "cancelled");
      assert.equal(result.completion, "partially_filled");
    }
  );
});

test("obPositionsRedeem dry-run selects redeem-voided when manager reports a voided market", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  const originalGetNetwork = providers.JsonRpcProvider.prototype.getNetwork;
  const originalCall = providers.JsonRpcProvider.prototype.call;

  providers.JsonRpcProvider.prototype.getNetwork = async function getNetwork() {
    return { chainId: 97, name: "bsc-testnet" };
  };
  providers.JsonRpcProvider.prototype.call = async function call() {
    return utils.defaultAbiCoder.encode(["int8"], [-1]);
  };

  try {
    await withFetchStub(
      {
        "GET /markets/42": () =>
          createJsonResponse({
            id: 42,
            slug: "test-market",
            title: "Will it rain?",
            state: "resolved",
            networkId: 97,
            executionMode: 1,
            token: {
              address: "0x54eC4711c4a429D7b0466dd169079f276a868462",
              decimals: 18
            }
          }),
        "POST /positions/redeem-voided": async (_url, options) => {
          const body = JSON.parse(String(options.body));
          assert.equal(body.market_id, 42);
          assert.equal(body.network_id, 97);
          return createJsonResponse({
            to: "0xf512f0363a7E9aD622f03D69966530b791C68F88",
            calldata: "0xdeadbeef",
            value: "0"
          });
        }
      },
      async () => {
        const result = await operations.obPositionsRedeem({
          marketId: 42,
          dryRun: true
        });

        assert.equal(result.redeemPath, "redeem-voided");
        assert.equal(result.resolvedOutcome, -1);
        assert.equal(result.call.calldata, "0xdeadbeef");
      }
    );
  } finally {
    providers.JsonRpcProvider.prototype.getNetwork = originalGetNetwork;
    providers.JsonRpcProvider.prototype.call = originalCall;
  }
});

test("obOrdersCancelAll cancels all open orders on a market selected by slug via cancel-all endpoint", async () => {
  const runtime = createObRuntime();
  const operations = new MyriadOperations({ runtime });
  const walletAddress = new Wallet(PRIVATE_KEY_A).address;

  await withFakeTime(async ({ now }) => {
    const timestamp = String(Math.floor(now() / 1000));
    const expectedSignature = await signCancelAll(runtime, walletAddress, 42, timestamp);

    await withFetchStub(
      {
        "GET /markets/test-market": () =>
          createJsonResponse({
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
          }),
        "POST /orders/cancel-all": async (_url, options) => {
          const body = JSON.parse(String(options.body));
          assert.equal(body.trader, walletAddress);
          assert.equal(body.market_id, 42);
          assert.equal(body.network_id, 97);
          assert.equal(body.timestamp, timestamp);
          assert.equal(body.signature, expectedSignature);
          return createJsonResponse({
            cancelled_count: 2,
            market_ids_affected: ["42"]
          });
        }
      },
      async () => {
        const result = await operations.obOrdersCancelAll({
          marketSlug: "test-market"
        });

        assert.equal(result.wallet, walletAddress);
        assert.equal(result.marketId, 42);
        assert.equal(result.marketTitle, "Will it rain?");
        assert.equal(result.cancelled, 2);
        assert.deepEqual(result.marketIdsAffected, ["42"]);
        assert.equal(result.response.cancelled_count, 2);
      }
    );
  });
});

test("obOrdersCancelAll dry-run returns a signed market-scoped cancel-all payload", async () => {
  const runtime = createObRuntime();
  const operations = new MyriadOperations({ runtime });
  const walletAddress = new Wallet(PRIVATE_KEY_A).address;

  await withFakeTime(async ({ now }) => {
    const timestamp = String(Math.floor(now() / 1000));
    const expectedSignature = await signCancelAll(runtime, walletAddress, 42, timestamp);

    await withFetchStub(
      {
        "GET /markets/42": (url) => {
          assert.equal(url.searchParams.get("network_id"), "97");
          assert.equal(url.searchParams.get("execution_mode"), "1");
          return createJsonResponse({
            id: 42,
            slug: "test-market",
            title: "Will it rain?",
            state: "open",
            networkId: 97,
            executionMode: 1
          });
        }
      },
      async () => {
        const result = await operations.obOrdersCancelAll({
          marketId: 42,
          dryRun: true
        });

        assert.equal(result.wallet, walletAddress);
        assert.equal(result.marketId, 42);
        assert.equal(result.marketTitle, "Will it rain?");
        assert.equal(result.cancelAllRequest.trader, walletAddress);
        assert.equal(result.cancelAllRequest.market_id, 42);
        assert.equal(result.cancelAllRequest.network_id, 97);
        assert.equal(result.cancelAllRequest.timestamp, timestamp);
        assert.equal(result.cancelAllRequest.signature, expectedSignature);
      }
    );
  });
});

test("obOrdersCancelAll cancels across all markets with marketId zero in the signed payload", async () => {
  const runtime = createObRuntime();
  const operations = new MyriadOperations({ runtime });
  const walletAddress = new Wallet(PRIVATE_KEY_A).address;

  await withFakeTime(async ({ now }) => {
    const timestamp = String(Math.floor(now() / 1000));
    const expectedSignature = await signCancelAll(runtime, walletAddress, 0, timestamp);

    await withFetchStub(
      {
        "POST /orders/cancel-all": async (_url, options) => {
          const body = JSON.parse(String(options.body));
          assert.equal(body.trader, walletAddress);
          assert.equal(body.network_id, 97);
          assert.equal(body.timestamp, timestamp);
          assert.equal(body.signature, expectedSignature);
          assert.equal("market_id" in body, false);
          return createJsonResponse({
            cancelled_count: 4,
            market_ids_affected: ["42", "43"]
          });
        }
      },
      async () => {
        const result = await operations.obOrdersCancelAll({});

        assert.equal(result.wallet, walletAddress);
        assert.equal("marketId" in result, false);
        assert.equal(result.cancelled, 4);
        assert.deepEqual(result.marketIdsAffected, ["42", "43"]);
      }
    );
  });
});

test("obOrdersCancelAll dry-run omits market_id for all-markets cancellation", async () => {
  const runtime = createObRuntime();
  const operations = new MyriadOperations({ runtime });
  const walletAddress = new Wallet(PRIVATE_KEY_A).address;

  await withFakeTime(async ({ now }) => {
    const timestamp = String(Math.floor(now() / 1000));
    const expectedSignature = await signCancelAll(runtime, walletAddress, 0, timestamp);

    const result = await operations.obOrdersCancelAll({
      dryRun: true
    });

    assert.equal(result.wallet, walletAddress);
    assert.equal("marketId" in result, false);
    assert.equal(result.cancelAllRequest.trader, walletAddress);
    assert.equal(result.cancelAllRequest.network_id, 97);
    assert.equal(result.cancelAllRequest.timestamp, timestamp);
    assert.equal(result.cancelAllRequest.signature, expectedSignature);
    assert.equal("market_id" in result.cancelAllRequest, false);
  });
});

test("obOrdersCancelBatch dry-run builds a deduplicated cancel-batch payload", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });
  const walletAddress = new Wallet(PRIVATE_KEY_A).address;

  await withFetchStub(
    {
      "GET /orders/0xaaa": () =>
        createJsonResponse({
          orderHash: "0xaaa",
          order: {
            trader: walletAddress,
            marketId: "42",
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("1", 18).toString(),
            price: utils.parseUnits("0.5", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          },
          signature: "0xsignature-a",
          status: "open",
          networkId: 97
        }),
      "GET /orders/0xbbb": () =>
        createJsonResponse({
          orderHash: "0xbbb",
          order: {
            trader: walletAddress,
            marketId: "42",
            outcomeId: 1,
            side: 1,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.6", 18).toString(),
            minFillAmount: "0",
            nonce: "2",
            expiration: "0"
          },
          signature: "0xsignature-b",
          status: "open",
          networkId: 97
        })
    },
    async () => {
      const result = await operations.obOrdersCancelBatch({
        orderHashes: ["0xaaa", " 0xbbb ", "0xaaa"],
        dryRun: true
      });

      assert.equal(result.wallet, walletAddress);
      assert.deepEqual(result.orderHashes, ["0xaaa", "0xbbb"]);
      assert.equal(result.totalOrders, 2);
      assert.equal(result.cancelBatchRequest.network_id, 97);
      assert.deepEqual(result.cancelBatchRequest.orders, [
        {
          order: {
            trader: walletAddress,
            marketId: "42",
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("1", 18).toString(),
            price: utils.parseUnits("0.5", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          },
          signature: "0xsignature-a"
        },
        {
          order: {
            trader: walletAddress,
            marketId: "42",
            outcomeId: 1,
            side: 1,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.6", 18).toString(),
            minFillAmount: "0",
            nonce: "2",
            expiration: "0"
          },
          signature: "0xsignature-b"
        }
      ]);
    }
  );
});

test("obOrdersCancelBatch submits cancel-batch and summarizes partial failures", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });
  const walletAddress = new Wallet(PRIVATE_KEY_A).address;

  await withFetchStub(
    {
      "GET /orders/0xaaa": () =>
        createJsonResponse({
          orderHash: "0xaaa",
          order: {
            trader: walletAddress,
            marketId: "42",
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("1", 18).toString(),
            price: utils.parseUnits("0.5", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          },
          signature: "0xsignature-a",
          status: "open",
          networkId: 97
        }),
      "GET /orders/0xbbb": () =>
        createJsonResponse({
          orderHash: "0xbbb",
          order: {
            trader: walletAddress,
            marketId: "42",
            outcomeId: 1,
            side: 1,
            amount: utils.parseUnits("2", 18).toString(),
            price: utils.parseUnits("0.6", 18).toString(),
            minFillAmount: "0",
            nonce: "2",
            expiration: "0"
          },
          signature: "0xsignature-b",
          status: "open",
          networkId: 97
        }),
      "POST /orders/cancel-batch": async (_url, options) => {
        const body = JSON.parse(String(options.body));
        assert.equal(body.network_id, 97);
        assert.equal(body.orders.length, 2);
        assert.equal(body.orders[0].signature, "0xsignature-a");
        assert.equal(body.orders[1].signature, "0xsignature-b");
        return createJsonResponse({
          cancelled: ["0xaaa"],
          errors: [{ orderHash: "0xbbb", reason: "Order not found" }]
        });
      }
    },
    async () => {
      const result = await operations.obOrdersCancelBatch({
        orderHashes: ["0xaaa", "0xbbb"]
      });

      assert.equal(result.wallet, walletAddress);
      assert.deepEqual(result.orderHashes, ["0xaaa", "0xbbb"]);
      assert.equal(result.cancelled, 1);
      assert.equal(result.failed, 1);
      assert.deepEqual(result.cancelledOrderHashes, ["0xaaa"]);
      assert.deepEqual(result.errors, [{ orderHash: "0xbbb", reason: "Order not found" }]);
    }
  );
});

test("obOrdersCancelBatch fails before submission when the configured wallet does not own an order", async () => {
  const operations = new MyriadOperations({
    runtime: createObRuntime()
  });

  await withFetchStub(
    {
      "GET /orders/0xaaa": () =>
        createJsonResponse({
          orderHash: "0xaaa",
          order: {
            trader: "0x1111111111111111111111111111111111111111",
            marketId: "42",
            outcomeId: 0,
            side: 0,
            amount: utils.parseUnits("1", 18).toString(),
            price: utils.parseUnits("0.5", 18).toString(),
            minFillAmount: "0",
            nonce: "1",
            expiration: "0"
          },
          signature: "0xsignature-a",
          status: "open",
          networkId: 97
        })
    },
    async () => {
      await assert.rejects(
        () =>
          operations.obOrdersCancelBatch({
            orderHashes: ["0xaaa"]
          }),
        /does not own order 0xaaa/
      );
    }
  );
});
