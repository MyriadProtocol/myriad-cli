import test from "node:test";
import assert from "node:assert/strict";
import {
  renderMarketShowTable,
  renderMarketsListTable,
  renderObOrderShowTable,
  renderObOrdersListTable,
  renderObOrderSubmission,
  renderOrderbookLadder,
  renderPlainTables,
  renderPortfolioTable
} from "../dist/output-format.js";

test("renderPlainTables renders primitive payload as value table", () => {
  const output = renderPlainTables("hello");

  assert.equal(
    output,
    ["+-------+", "| value |", "+-------+", "| hello |", "+-------+"].join("\n")
  );
});

test("renderPlainTables renders mixed object payload with sectioned tables", () => {
  const output = renderPlainTables({
    wallet: "0xabc",
    chainId: 56,
    ok: true,
    notes: "line1\nline2",
    assets: {
      native: { symbol: "BNB" },
      collateral: { symbol: "USDT", address: "0x1" }
    },
    data: [
      { id: 1, title: "Alpha", meta: { source: "feed" } },
      { id: 2, extra: true }
    ],
    tags: ["x", "y|z"]
  });

  assert.match(output, /Section: summary/);
  assert.match(output, /^\+[+-]+\+$/m);
  assert.match(output, /\|\s*wallet\s*\|\s*0xabc\s*\|/);
  assert.match(output, /\|\s*notes\s*\|\s*line1\\nline2\s*\|/);

  assert.match(output, /Section: assets/);
  assert.match(output, /\|\s*native\s*\|\s*\{"symbol":"BNB"\}\s*\|/);
  assert.match(output, /\|\s*collateral\s*\|\s*\{"symbol":"USDT","address":"0x1"\}\s*\|/);

  assert.match(output, /Section: data/);
  assert.match(output, /\|\s*id\s*\|\s*title\s*\|\s*meta\s*\|\s*extra\s*\|/);
  assert.match(output, /\|\s*1\s*\|\s*Alpha\s*\|\s*\{"source":"feed"\}\s*\|\s*\|/);
  assert.match(output, /\|\s*2\s*\|\s*\|\s*\|\s*true\s*\|/);

  assert.match(output, /Section: tags/);
  assert.match(output, /\|\s*index\s*\|\s*value\s*\|/);
  assert.match(output, /\|\s*1\s*\|\s*y\\\|z\s*\|/);
});

test("renderPlainTables renders empty array sections with status table", () => {
  const output = renderPlainTables({
    results: []
  });

  assert.match(output, /Section: summary/);
  assert.match(output, /\|\s*key\s*\|\s*value\s*\|/);
  assert.match(output, /\|\s*status\s*\|\s*empty\s*\|/);
  assert.match(output, /Section: results/);
  assert.match(output, /\|\s*status\s*\|/);
  assert.match(output, /\|\s*empty\s*\|/);
});

test("renderOrderbookLadder renders asks above midpoint and bids below midpoint", () => {
  const output = renderOrderbookLadder(
    {
      marketId: 42,
      marketTitle: "Will it rain?",
      outcomeId: 0,
      lastPrice: "0.5100",
      asks: [
        ["550000000000000000", "1000000000000000000"],
        ["600000000000000000", "2500000000000000000"]
      ],
      bids: [
        ["500000000000000000", "3000000000000000000"],
        ["450000000000000000", "2000000000000000000"]
      ]
    },
    { levels: 10, color: false }
  );

  const askFarIndex = output.indexOf("0.6000");
  const askBestIndex = output.indexOf("0.5500");
  const midpointIndex = output.indexOf("Last: 0.5100 | Mid: 0.5250 | Spread: 0.0500");
  const bidBestIndex = output.indexOf("0.5000");
  const bidFarIndex = output.indexOf("0.4500");

  assert.notEqual(askFarIndex, -1);
  assert.notEqual(askBestIndex, -1);
  assert.notEqual(midpointIndex, -1);
  assert.notEqual(bidBestIndex, -1);
  assert.notEqual(bidFarIndex, -1);
  assert.ok(askFarIndex < askBestIndex);
  assert.ok(askBestIndex < midpointIndex);
  assert.ok(midpointIndex < bidBestIndex);
  assert.ok(bidBestIndex < bidFarIndex);
  assert.match(output, /Price\s+Shares\s+Sum/);
  assert.match(output, /█/);
  assert.doesNotMatch(output, /\x1b\[/);
  assert.doesNotMatch(output, /\|\s*Price\s*\|/);
});

test("renderOrderbookLadder respects the levels limit", () => {
  const output = renderOrderbookLadder(
    {
      marketId: 42,
      marketTitle: "Will it rain?",
      outcomeId: 0,
      asks: [
        ["510000000000000000", "1000000000000000000"],
        ["520000000000000000", "1000000000000000000"],
        ["530000000000000000", "1000000000000000000"]
      ],
      bids: [
        ["490000000000000000", "1000000000000000000"],
        ["480000000000000000", "1000000000000000000"],
        ["470000000000000000", "1000000000000000000"]
      ]
    },
    { levels: 2, color: false }
  );

  assert.match(output, /0\.5100/);
  assert.match(output, /0\.5200/);
  assert.doesNotMatch(output, /0\.5300/);
  assert.match(output, /0\.4900/);
  assert.match(output, /0\.4800/);
  assert.doesNotMatch(output, /0\.4700/);
});

test("renderOrderbookLadder scales bars using cumulative sum across both sides", () => {
  const output = renderOrderbookLadder(
    {
      marketId: 42,
      marketTitle: "Will it rain?",
      outcomeId: 0,
      asks: [
        ["510000000000000000", "1000000000000000000"],
        ["520000000000000000", "1000000000000000000"]
      ],
      bids: [["490000000000000000", "4000000000000000000"]]
    },
    { color: false }
  );

  const lines = output.split("\n");
  const askFarLine = lines.find((line) => line.includes("0.5200"));
  const askBestLine = lines.find((line) => line.includes("0.5100"));
  const bidLine = lines.find((line) => line.includes("0.4900"));

  assert.ok(askFarLine);
  assert.ok(askBestLine);
  assert.ok(bidLine);
  assert.match(askBestLine, /1\.0000\s+1\.0000\s+█{5}/);
  assert.match(askFarLine, /1\.0000\s+2\.0000\s+█{10}/);
  assert.match(bidLine, /4\.0000\s+4\.0000\s+█{20}/);
});

test("renderOrderbookLadder shows midpoint N/A when one side is missing", () => {
  const output = renderOrderbookLadder(
    {
      marketId: 42,
      marketTitle: "Will it rain?",
      outcomeId: 0,
      asks: [["550000000000000000", "1000000000000000000"]],
      bids: []
    },
    { color: false }
  );

  assert.match(output, /Last: N\/A \| Mid: N\/A \| Spread: N\/A/);
  assert.match(output, /Bids/);
  assert.match(output, /empty/);
});

test("renderOrderbookLadder shows a clear empty state for an empty book", () => {
  const output = renderOrderbookLadder(
    {
      marketId: 42,
      marketTitle: "Will it rain?",
      outcomeId: 0,
      asks: [],
      bids: []
    },
    { color: false }
  );

  assert.match(output, /Orderbook is empty\./);
  assert.match(output, /Last: N\/A \| Mid: N\/A \| Spread: N\/A/);
});

test("renderOrderbookLadder colorizes asks red and bids green when enabled", () => {
  const output = renderOrderbookLadder(
    {
      marketId: 42,
      marketTitle: "Will it rain?",
      outcomeId: 0,
      lastPrice: "0.5100",
      asks: [["550000000000000000", "1000000000000000000"]],
      bids: [["500000000000000000", "1000000000000000000"]]
    },
    { color: true }
  );

  assert.match(output, /Asks[\s\S]*\x1b\[31m█+\x1b\[0m/);
  assert.match(output, /Bids[\s\S]*\x1b\[32m█+\x1b\[0m/);
});

test("renderObOrderSubmission formats completion, dollars, and shares without raw integers", () => {
  const output = renderObOrderSubmission({
    wallet: "0xabc",
    marketId: 42,
    marketTitle: "Will it rain?",
    outcomeId: 0,
    side: "buy",
    timeInForce: "FAK",
    orderHash: "0xorder",
    order: {
      amount: "2500000000000000000",
      price: "550000000000000000",
      minFillAmount: "0"
    },
    marketQuote: {
      inputMode: "value",
      requestedValueRaw: "1100000000000000000",
      estimatedSharesRaw: "2000000000000000000",
      estimatedValueRaw: "1100000000000000000",
      deepestPriceRaw: "600000000000000000"
    },
    observedOrder: {
      filledAmount: "2000000000000000000"
    },
    completion: "filled",
    observedStatus: "filled",
    waitMs: 5000,
    timedOut: false,
    followUpCommand: "myriad ob orders show 0xorder --json",
    approval: {
      type: "erc20_allowance",
      approved: true,
      requiredAmount: "1.44"
    }
  });

  assert.match(output, /Section: summary/);
  assert.match(output, /\|\s*completion\s*\|\s*Filled\s*\|/);
  assert.match(output, /\|\s*shares\s*\|\s*2\.5\s*\|/);
  assert.match(output, /\|\s*requestedValue\s*\|\s*\$1\.10\s*\|/);
  assert.match(output, /\|\s*estimatedShares\s*\|\s*2\s*\|/);
  assert.match(output, /\|\s*derivedPrice\s*\|\s*0\.6000\s*\|/);
  assert.match(output, /\|\s*filledShares\s*\|\s*2\s*\|/);
  assert.doesNotMatch(output, /2500000000000000000/);
  assert.doesNotMatch(output, /1100000000000000000/);
});

test("renderObOrdersListTable formats list rows in human units", () => {
  const output = renderObOrdersListTable({
    data: [
      {
        orderHash: "0xaaa",
        status: "cancelled",
        filledAmount: "500000000000000000",
        timeInForce: "FAK",
        order: {
          side: 0,
          amount: "1250000000000000000",
          price: "550000000000000000",
          marketId: 42,
          outcomeId: 0
        }
      }
    ]
  });

  assert.match(output, /\|\s*Order Hash\s*\|\s*Side\s*\|\s*Status\s*\|\s*Completion\s*\|/);
  assert.match(output, /\|\s*0xaaa\s*\|\s*buy\s*\|\s*cancelled\s*\|\s*Partially filled\s*\|/);
  assert.match(output, /\|\s*1\.25\s*\|\s*0\.5\s*\|\s*0\.5500\s*\|\s*\$0\.69\s*\|/);
  assert.doesNotMatch(output, /1250000000000000000/);
});

test("renderObOrderShowTable formats order details without raw on-chain amounts", () => {
  const output = renderObOrderShowTable({
    orderHash: "0xbbb",
    status: "open",
    filledAmount: "500000000000000000",
    timeInForce: "GTC",
    createdAt: "2025-07-01T12:00:00.000Z",
    updatedAt: "2025-07-01T12:05:00.000Z",
    order: {
      side: 1,
      amount: "3000000000000000000",
      price: "450000000000000000",
      marketId: 77,
      outcomeId: 1
    }
  });

  assert.match(output, /\|\s*completion\s*\|\s*Partially filled\s*\|/);
  assert.match(output, /\|\s*shares\s*\|\s*3\s*\|/);
  assert.match(output, /\|\s*filledShares\s*\|\s*0\.5\s*\|/);
  assert.match(output, /\|\s*price\s*\|\s*0\.4500\s*\|/);
  assert.match(output, /\|\s*orderValue\s*\|\s*\$1\.35\s*\|/);
  assert.doesNotMatch(output, /3000000000000000000/);
});

test("renderMarketsListTable renders only requested market columns", () => {
  const output = renderMarketsListTable({
    data: [
      {
        id: 164,
        title: "Will ETH be above $5k by year-end?",
        outcomes: [
          { title: "Yes", price: 0.42 },
          { title: "No", price: 0.58 }
        ],
        volume: 12345.678,
        expiresAt: "2026-12-31T23:59:59.000Z",
        state: "open",
        ignoredField: "ignore me"
      },
      {
        marketId: 9001,
        title: "Will this be perpetual?",
        outcomes: [{ title: "Always", price: 1 }],
        volume: "1000000",
        expiresAt: "2100-01-01T00:00:00.000Z",
        is_perpetual: true,
        state: "open"
      },
      {
        market_id: "abc-42",
        title: "Will this hit date threshold?",
        outcomes: [{ title: "Hit", price: "0.9" }],
        volume: 500,
        expiresAt: "2100-01-02T00:00:00.000Z",
        state: "closed"
      }
    ],
    pagination: { page: 1, limit: 20 }
  });

  assert.match(
    output,
    /\|\s*Title\s*\|\s*Most likely outcome \(with price\)\s*\|\s*Volume\s*\|\s*Expires At\s*\|\s*State\s*\|\s*Market ID\s*\|/
  );
  assert.match(output, /No \(\$0\.58\)/);
  assert.match(output, /\|\s*\$12,345\.68\s*\|/);
  assert.match(output, /2026-12-31/);
  assert.match(output, /Perpetual/);
  assert.match(output, /\|\s*\$1,000,000\.00\s*\|/);
  assert.match(output, /HIT/);
  assert.match(output, /Hit \(\$0\.90\)/);
  assert.match(output, /\|\s*164\s*\|/);
  assert.match(output, /\|\s*9001\s*\|/);
  assert.match(output, /\|\s*abc-42\s*\|/);
  assert.doesNotMatch(output, /ignoredField/);
});

test("renderMarketShowTable renders requested columns for plain market detail output", () => {
  const output = renderMarketShowTable({
    id: 999,
    title: "Will ETH close above $4k this month?",
    outcomes: [
      { title: "Yes", price: 0.61 },
      { title: "No", price: 0.39 },
      { title: "Push", price: 0.01 }
    ],
    volume: 45678.9,
    expiresAt: "2026-11-30T23:59:59.000Z"
  });

  assert.match(
    output,
    /\|\s*Title\s*\|\s*Outcome \(Price\)\s*\|\s*Outcome \(Price\)\s*\|\s*Volume\s*\|\s*Expires At\s*\|\s*Market ID\s*\|/
  );
  assert.match(output, /Will ETH close above \$4k this month\?/);
  assert.match(output, /Yes \(\$0\.61\)/);
  assert.match(output, /No \(\$0\.39\)/);
  assert.match(output, /\|\s*\$45,678\.90\s*\|/);
  assert.match(output, /\|\s*2026-11-30\s*\|/);
  assert.match(output, /\|\s*999\s*\|/);
  assert.doesNotMatch(output, /Push/);
});

test("renderPortfolioTable filters and formats portfolio rows for plain output", () => {
  const output = renderPortfolioTable({
    data: [
      {
        marketTitle: "Election 2026",
        outcomeTitle: "Yes",
        marketId: 101,
        outcomeId: 7,
        shares: 120.5,
        price: 0.42,
        value: 1500,
        totalRoi: 12.345,
        status: "open",
        claimed: false
      },
      {
        marketTitle: "Already claimed",
        outcomeTitle: "No",
        shares: 10,
        price: 0.3,
        value: 100,
        totalRoi: 5,
        status: "won",
        claimed: true
      },
      {
        marketTitle: "Wrong status",
        outcomeTitle: "No",
        shares: 2,
        price: 0.1,
        value: 10,
        totalRoi: 1,
        status: "lost",
        claimed: false
      },
      {
        market: { title: "Voided market title fallback" },
        outcome: { id: 3, title: "Outcome fallback" },
        shares: "20",
        price: "0.55",
        value: "2000.5",
        totalRoi: "22.5",
        market_id: "m-55",
        status: "voided",
        winningsClaimed: false
      }
    ]
  });

  assert.match(
    output,
    /\|\s*Market\s*\|\s*Outcome\s*\|\s*Shares\s*\|\s*Price\s*\|\s*Current Value\s*\|\s*Current ROI\s*\|\s*Status\s*\|\s*Market ID\s*\|\s*Outcome ID\s*\|/
  );
  assert.match(output, /Election 2026/);
  assert.match(output, /Yes/);
  assert.match(output, /\|\s*120\.50\s*\|/);
  assert.match(output, /\|\s*\$0\.42\s*\|/);
  assert.match(output, /\|\s*\$1,500\.00\s*\|/);
  assert.match(output, /\|\s*12\.35%\s*\|/);
  assert.match(output, /\|\s*open\s*\|/);
  assert.match(output, /\|\s*101\s*\|/);
  assert.match(output, /\|\s*7\s*\|/);

  assert.match(output, /Voided market title fallback/);
  assert.match(output, /Outcome fallback/);
  assert.match(output, /\|\s*20\.00\s*\|/);
  assert.match(output, /\|\s*\$0\.55\s*\|/);
  assert.match(output, /\|\s*\$2,000\.50\s*\|/);
  assert.match(output, /\|\s*22\.50%\s*\|/);
  assert.match(output, /\|\s*voided\s*\|/);
  assert.match(output, /\|\s*m-55\s*\|/);
  assert.match(output, /\|\s*3\s*\|/);

  assert.doesNotMatch(output, /Already claimed/);
  assert.doesNotMatch(output, /Wrong status/);
});
