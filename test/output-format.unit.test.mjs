import test from "node:test";
import assert from "node:assert/strict";
import { renderMarketShowTable, renderMarketsListTable, renderPlainTables, renderPortfolioTable } from "../dist/output-format.js";

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
