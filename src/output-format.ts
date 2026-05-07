import process from "node:process";
import { formatUnits } from "ethers";

type OrderbookRenderPayload = {
  marketId?: string | number;
  marketTitle?: string;
  outcomeId?: string | number;
  lastPrice?: string | number;
  asks?: Array<[string, string]>;
  bids?: Array<[string, string]>;
};

type OrderbookRenderOptions = {
  levels?: number;
  color?: boolean;
  marketIdLabel?: string;
  outcomeLabel?: string;
};

type NormalizedOrderbookLevel = {
  priceRaw: bigint;
  sizeRaw: bigint;
  price: number;
  size: number;
  cumulative: number;
};

const ORDERBOOK_DECIMALS = 18;
const ORDERBOOK_BAR_WIDTH = 20;
const ORDERBOOK_BAR_GLYPH = "█";
const ANSI_RESET = "\x1b[0m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\r?\n/g, "\\n").replace(/\|/g, "\\|");
}

function normalizeScalarValue(value: unknown): string {
  return String(value);
}

function normalizeCellValue(value: unknown): string {
  if (isScalar(value)) {
    return normalizeScalarValue(value);
  }

  return JSON.stringify(value);
}

function padCell(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - value.length)}`;
}

function renderAsciiTable(headers: string[], rows: string[][]): string {
  const normalizedHeaders = headers.map(normalizeText);
  const normalizedRows = rows.map((row) => row.map(normalizeText));
  const widths = normalizedHeaders.map((header, column) =>
    Math.max(
      header.length,
      ...normalizedRows.map((row) => (row[column] ?? "").length)
    )
  );

  const border = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const headerLine = `| ${normalizedHeaders
    .map((header, column) => padCell(header, widths[column]))
    .join(" | ")} |`;
  const rowLines = normalizedRows.map((row) =>
    `| ${widths
      .map((width, column) => padCell(row[column] ?? "", width))
      .join(" | ")} |`
  );

  return [border, headerLine, border, ...rowLines, border].join("\n");
}

function renderKeyValueTable(entries: Array<[string, unknown]>): string {
  if (entries.length === 0) {
    return renderAsciiTable(["key", "value"], [["status", "empty"]]);
  }

  const rows = entries.map(([key, value]) => [String(key), normalizeCellValue(value)]);
  return renderAsciiTable(["key", "value"], rows);
}

function renderArrayTable(items: unknown[]): string {
  if (items.length === 0) {
    return renderAsciiTable(["status"], [["empty"]]);
  }

  const allObjects = items.every((item) => isObject(item));
  if (allObjects) {
    const columns: string[] = [];
    for (const item of items) {
      for (const key of Object.keys(item)) {
        if (!columns.includes(key)) {
          columns.push(key);
        }
      }
    }

    if (columns.length === 0) {
      return renderAsciiTable(["status"], [["empty"]]);
    }

    const rows = items.map((item) =>
      columns.map((column) => {
        const value = (item as Record<string, unknown>)[column];
        if (value === undefined) {
          return "";
        }
        return normalizeCellValue(value);
      })
    );
    return renderAsciiTable(columns, rows);
  }

  const rows = items.map((item, index) => [String(index), normalizeCellValue(item)]);
  return renderAsciiTable(["index", "value"], rows);
}

function parseOrderbookRawUnits(value: unknown): bigint | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return undefined;
  }

  try {
    const parsed = BigInt(String(value));
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function formatOrderbookUnits(raw: bigint): number {
  return Number(formatUnits(raw, ORDERBOOK_DECIMALS));
}

function formatOrderbookDecimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "N/A";
}

function shouldUseAnsiColor(explicitColor: boolean | undefined): boolean {
  if (explicitColor !== undefined) {
    return explicitColor;
  }

  const forceColor = process.env.FORCE_COLOR?.trim();
  if (forceColor && forceColor !== "0") {
    return true;
  }

  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  return Boolean(process.stdout?.isTTY);
}

function colorize(text: string, colorCode: string, enabled: boolean): string {
  if (!enabled || text.length === 0) {
    return text;
  }
  return `${colorCode}${text}${ANSI_RESET}`;
}

function renderDepthBar(depthValue: number, maxDepthValue: number, colorCode: string, colorEnabled: boolean): string {
  if (!Number.isFinite(depthValue) || depthValue <= 0 || !Number.isFinite(maxDepthValue) || maxDepthValue <= 0) {
    return "";
  }

  const filledWidth = Math.max(1, Math.round((depthValue / maxDepthValue) * ORDERBOOK_BAR_WIDTH));
  const bar = ORDERBOOK_BAR_GLYPH.repeat(Math.min(ORDERBOOK_BAR_WIDTH, filledWidth));
  return colorize(bar, colorCode, colorEnabled);
}

function normalizeOrderbookLevels(
  levels: unknown,
  direction: "asc" | "desc",
  limit: number
): NormalizedOrderbookLevel[] {
  if (!Array.isArray(levels)) {
    return [];
  }

  const parsedLevels: Array<{ priceRaw: bigint; sizeRaw: bigint }> = [];

  for (const level of levels) {
    if (!Array.isArray(level) || level.length < 2) {
      continue;
    }

    const priceRaw = parseOrderbookRawUnits(level[0]);
    const sizeRaw = parseOrderbookRawUnits(level[1]);
    if (priceRaw === undefined || sizeRaw === undefined || sizeRaw <= 0n) {
      continue;
    }

    parsedLevels.push({ priceRaw, sizeRaw });
  }

  parsedLevels.sort((left, right) => {
    if (left.priceRaw === right.priceRaw) {
      return 0;
    }
    if (direction === "asc") {
      return left.priceRaw < right.priceRaw ? -1 : 1;
    }
    return left.priceRaw > right.priceRaw ? -1 : 1;
  });

  const visibleLevels = parsedLevels.slice(0, limit);
  let cumulativeRaw = 0n;

  return visibleLevels.map((level) => {
    cumulativeRaw += level.sizeRaw;
    return {
      priceRaw: level.priceRaw,
      sizeRaw: level.sizeRaw,
      price: formatOrderbookUnits(level.priceRaw),
      size: formatOrderbookUnits(level.sizeRaw),
      cumulative: formatOrderbookUnits(cumulativeRaw)
    };
  });
}

function buildOrderbookColumnHeader(widths: { price: number; shares: number; sum: number }): string {
  return [
    padCell("Price", widths.price),
    padCell("Shares", widths.shares),
    padCell("Sum", widths.sum)
  ].join("  ");
}

function buildOrderbookColumnWidths(
  asks: NormalizedOrderbookLevel[],
  bids: NormalizedOrderbookLevel[]
): { price: number; shares: number; sum: number } {
  const levels = [...asks, ...bids];
  return {
    price: Math.max("Price".length, ...levels.map((level) => formatOrderbookDecimal(level.price).length)),
    shares: Math.max("Shares".length, ...levels.map((level) => formatOrderbookDecimal(level.size).length)),
    sum: Math.max("Sum".length, ...levels.map((level) => formatOrderbookDecimal(level.cumulative).length))
  };
}

function renderOrderbookRow(
  level: NormalizedOrderbookLevel,
  widths: { price: number; shares: number; sum: number },
  maxDisplayedCumulative: number,
  colorCode: string,
  colorEnabled: boolean
): string {
  const columns = [
    padCell(formatOrderbookDecimal(level.price), widths.price),
    padCell(formatOrderbookDecimal(level.size), widths.shares),
    padCell(formatOrderbookDecimal(level.cumulative), widths.sum)
  ].join("  ");

  const bar = renderDepthBar(level.cumulative, maxDisplayedCumulative, colorCode, colorEnabled);
  return bar.length > 0 ? `${columns}  ${bar}` : columns;
}

function renderOrderbookSection(
  title: string,
  levels: NormalizedOrderbookLevel[],
  widths: { price: number; shares: number; sum: number },
  maxDisplayedCumulative: number,
  colorCode: string,
  colorEnabled: boolean
): string {
  const header = buildOrderbookColumnHeader(widths);
  if (levels.length === 0) {
    return `${title}\n${header}\nempty`;
  }

  const rows = levels.map((level) => renderOrderbookRow(level, widths, maxDisplayedCumulative, colorCode, colorEnabled));
  return `${title}\n${header}\n${rows.join("\n")}`;
}

function renderTopLevelObject(payload: Record<string, unknown>): string {
  const sections: string[] = [];
  const summaryEntries: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(payload)) {
    if (isScalar(value)) {
      summaryEntries.push([key, value]);
    }
  }

  sections.push(`Section: summary\n${renderKeyValueTable(summaryEntries)}`);

  for (const [key, value] of Object.entries(payload)) {
    if (isScalar(value)) {
      continue;
    }

    if (Array.isArray(value)) {
      sections.push(`Section: ${key}\n${renderArrayTable(value)}`);
      continue;
    }

    if (isObject(value)) {
      sections.push(`Section: ${key}\n${renderKeyValueTable(Object.entries(value))}`);
    }
  }

  return sections.join("\n\n");
}

export function renderPlainTables(payload: unknown): string {
  if (isScalar(payload)) {
    return renderAsciiTable(["value"], [[normalizeScalarValue(payload)]]);
  }

  if (Array.isArray(payload)) {
    return renderArrayTable(payload);
  }

  if (isObject(payload)) {
    return renderTopLevelObject(payload);
  }

  return renderAsciiTable(["value"], [[normalizeCellValue(payload)]]);
}

export function renderOrderbookLadder(payload: unknown, options: OrderbookRenderOptions = {}): string {
  const orderbook = isObject(payload) ? (payload as OrderbookRenderPayload) : {};
  const levelLimit = options.levels ?? 10;
  if (!Number.isInteger(levelLimit) || levelLimit <= 0) {
    throw new Error("levels must be a positive integer.");
  }

  const colorEnabled = shouldUseAnsiColor(options.color);
  const asks = normalizeOrderbookLevels(orderbook.asks, "asc", levelLimit);
  const bids = normalizeOrderbookLevels(orderbook.bids, "desc", levelLimit);
  const visibleAsks = [...asks].reverse();
  const visibleBids = bids;
  const displayedCumulativeDepth = [...asks, ...bids].map((level) => level.cumulative);
  const maxDisplayedCumulative = displayedCumulativeDepth.length === 0 ? 0 : Math.max(...displayedCumulativeDepth);
  const widths = buildOrderbookColumnWidths(asks, bids);
  const lastPrice = asNumber(orderbook.lastPrice);
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;
  const midpoint = bestAsk !== undefined && bestBid !== undefined ? (bestAsk + bestBid) / 2 : undefined;
  const spread = bestAsk !== undefined && bestBid !== undefined ? bestAsk - bestBid : undefined;
  const headerLines = [
    `Orderbook: ${readStringOrFallback(orderbook.marketTitle, "Unknown market")}`,
    `${options.marketIdLabel ?? "Market ID"}: ${orderbook.marketId ?? "N/A"} | ${options.outcomeLabel ?? "Outcome ID"}: ${
      orderbook.outcomeId ?? "N/A"
    }`
  ];
  const statsLine = [
    `Last: ${lastPrice !== undefined ? formatOrderbookDecimal(lastPrice) : "N/A"}`,
    `Mid: ${midpoint !== undefined ? formatOrderbookDecimal(midpoint) : "N/A"}`,
    `Spread: ${spread !== undefined ? formatOrderbookDecimal(spread) : "N/A"}`
  ].join(" | ");

  if (asks.length === 0 && bids.length === 0) {
    return [...headerLines, statsLine, "", "Orderbook is empty."].join("\n");
  }

  return [
    ...headerLines,
    "",
    renderOrderbookSection("Asks", visibleAsks, widths, maxDisplayedCumulative, ANSI_RED, colorEnabled),
    "",
    statsLine,
    "",
    renderOrderbookSection("Bids", visibleBids, widths, maxDisplayedCumulative, ANSI_GREEN, colorEnabled)
  ].join("\n");
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const usdTinyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4
});

const compactDecimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4
});

function formatCurrency(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return "N/A";
  }

  return usdFormatter.format(numeric);
}

function formatHumanCurrency(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return "N/A";
  }

  if (numeric !== 0 && Math.abs(numeric) < 0.01) {
    return usdTinyFormatter.format(numeric);
  }

  return usdFormatter.format(numeric);
}

function formatHumanDecimal(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return "N/A";
  }

  return compactDecimalFormatter.format(numeric);
}

function formatUnitsDisplay(raw: unknown, decimals: number): string {
  const parsed = parseOrderbookRawUnits(raw);
  if (!parsed) {
    return "N/A";
  }

  return formatHumanDecimal(formatUnits(parsed, decimals));
}

function formatProbabilityRaw(raw: unknown): string {
  const parsed = parseOrderbookRawUnits(raw);
  if (!parsed) {
    return "N/A";
  }

  return formatOrderbookDecimal(formatOrderbookUnits(parsed));
}

function formatUsdFromRaw(raw: unknown, decimals = ORDERBOOK_DECIMALS): string {
  const parsed = parseOrderbookRawUnits(raw);
  if (!parsed) {
    return "N/A";
  }

  return formatHumanCurrency(formatUnits(parsed, decimals));
}

function formatClobShares(raw: unknown): string {
  return formatUnitsDisplay(raw, ORDERBOOK_DECIMALS);
}

function formatOrderValue(rawAmount: unknown, rawPrice: unknown): string {
  const amount = parseOrderbookRawUnits(rawAmount);
  const price = parseOrderbookRawUnits(rawPrice);
  if (!amount || !price) {
    return "N/A";
  }

  return formatUsdFromRaw(((amount * price) / 1000000000000000000n).toString());
}

function formatCompletionLabel(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "N/A";
  }

  const normalized = value.split("_").join(" ").toLowerCase();
  return normalized.length > 0 ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : normalized;
}

function formatObservedStatus(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "N/A";
  }
  return value;
}

function formatOrderSide(value: unknown): string {
  if (value === 0 || value === "0") {
    return "buy";
  }
  if (value === 1 || value === "1") {
    return "sell";
  }
  return "N/A";
}

function readOrderRecordOrder(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return isObject(payload.order) ? payload.order : undefined;
}

function deriveCompletion(payload: Record<string, unknown>): string {
  if (typeof payload.completion === "string" && payload.completion.length > 0) {
    return payload.completion;
  }

  const order = readOrderRecordOrder(payload);
  const filledAmount = parseOrderbookRawUnits(payload.filledAmount);
  const orderAmount = parseOrderbookRawUnits(order?.amount);
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";

  if (status === "filled" || (filledAmount !== undefined && orderAmount !== undefined && filledAmount >= orderAmount)) {
    return "filled";
  }
  if (filledAmount !== undefined && filledAmount > 0n) {
    return "partially_filled";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status === "expired") {
    return "expired";
  }
  if (status === "open") {
    return "open";
  }
  return "pending_sync";
}

function formatApprovalLabel(value: unknown): string {
  if (!isObject(value)) {
    return "N/A";
  }

  if (value.skipped === true) {
    return "Skipped";
  }
  if (value.approved === true && value.type === "erc1155_approval_for_all") {
    return "Approved for all";
  }
  if (value.approved === true && value.type === "erc20_allowance") {
    return "Allowance ready";
  }
  if (value.type === "erc1155_approval_for_all") {
    return "Approval for all required";
  }
  if (value.type === "erc20_allowance") {
    return "Allowance required";
  }
  return "N/A";
}

export function renderObOrderSubmission(payload: unknown): string {
  if (!isObject(payload)) {
    return renderKeyValueTable([["status", "empty"]]);
  }

  const order = readOrderRecordOrder(payload) ?? (isObject(payload.order) ? payload.order : undefined) ?? {};
  const observedOrder = isObject(payload.observedOrder) ? payload.observedOrder : undefined;
  const marketQuote = isObject(payload.marketQuote) ? payload.marketQuote : undefined;
  const isDryRun = observedOrder === undefined && payload.response === undefined && payload.completion === undefined;

  const summaryEntries: Array<[string, unknown]> = [
    ["wallet", payload.wallet],
    ["market", `${readStringOrFallback(payload.marketTitle)} (${formatIdentifier(payload.marketId)})`],
    ["outcomeId", formatIdentifier(payload.outcomeId)],
    ["side", readStringOrFallback(payload.side)],
    ["timeInForce", readStringOrFallback(payload.timeInForce)]
  ];

  if (payload.orderHash !== undefined) {
    summaryEntries.push(["orderHash", payload.orderHash]);
  }

  if (!isDryRun) {
    summaryEntries.push(["completion", formatCompletionLabel(payload.completion)]);
    summaryEntries.push(["observedStatus", formatObservedStatus(payload.observedStatus)]);
    summaryEntries.push(["waitMs", payload.waitMs ?? 0]);
    summaryEntries.push(["timedOut", payload.timedOut === true ? "yes" : "no"]);
  }

  const economicsEntries: Array<[string, unknown]> = [
    ["price", formatProbabilityRaw(order.price)],
    ["shares", formatClobShares(order.amount)],
    ["orderValue", formatOrderValue(order.amount, order.price)]
  ];

  if ((parseOrderbookRawUnits(order.minFillAmount) ?? 0n) > 0n) {
    economicsEntries.push(["minFillShares", formatClobShares(order.minFillAmount)]);
  }

  if (marketQuote) {
    economicsEntries.push(["inputMode", readStringOrFallback(marketQuote.inputMode)]);
    if (marketQuote.requestedSharesRaw !== undefined) {
      economicsEntries.push(["requestedShares", formatClobShares(marketQuote.requestedSharesRaw)]);
    }
    if (marketQuote.requestedValueRaw !== undefined) {
      economicsEntries.push(["requestedValue", formatUsdFromRaw(marketQuote.requestedValueRaw)]);
    }
    economicsEntries.push(["estimatedShares", formatClobShares(marketQuote.estimatedSharesRaw)]);
    economicsEntries.push(["estimatedValue", formatUsdFromRaw(marketQuote.estimatedValueRaw)]);
    economicsEntries.push(["derivedPrice", formatProbabilityRaw(marketQuote.deepestPriceRaw)]);
  }

  if (observedOrder) {
    economicsEntries.push(["filledShares", formatClobShares(observedOrder.filledAmount)]);
    economicsEntries.push(["filledValue", formatOrderValue(observedOrder.filledAmount, order.price)]);
  }

  const flowEntries: Array<[string, unknown]> = [["approval", formatApprovalLabel(payload.approval)]];
  if (isObject(payload.approval) && payload.approval.requiredAmount !== undefined) {
    flowEntries.push(["requiredApproval", formatHumanDecimal(payload.approval.requiredAmount)]);
  }
  if (!isDryRun) {
    flowEntries.push(["followUpCommand", payload.followUpCommand]);
  }
  if (marketQuote?.note) {
    flowEntries.push(["note", marketQuote.note]);
  }

  return [
    "Section: summary",
    renderKeyValueTable(summaryEntries),
    "",
    "Section: economics",
    renderKeyValueTable(economicsEntries),
    "",
    "Section: flow",
    renderKeyValueTable(flowEntries)
  ].join("\n");
}

export function renderObOrdersListTable(payload: unknown): string {
  const headers = ["Order Hash", "Side", "Status", "Completion", "Shares", "Filled", "Price", "Value", "TIF", "Market ID", "Outcome ID"];

  if (!isObject(payload) || !Array.isArray(payload.data)) {
    return renderAsciiTable(headers, [["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]]);
  }

  const rows = payload.data
    .filter((entry) => isObject(entry))
    .map((entry) => {
      const order = readOrderRecordOrder(entry) ?? {};
      return [
        readStringOrFallback(entry.orderHash),
        formatOrderSide(order.side),
        readStringOrFallback(entry.status),
        formatCompletionLabel(deriveCompletion(entry)),
        formatClobShares(order.amount),
        formatClobShares(entry.filledAmount),
        formatProbabilityRaw(order.price),
        formatOrderValue(order.amount, order.price),
        readStringOrFallback(entry.timeInForce),
        formatIdentifier(order.marketId),
        formatIdentifier(order.outcomeId)
      ];
    });

  if (rows.length === 0) {
    rows.push(["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]);
  }

  return renderAsciiTable(headers, rows);
}

export function renderObOrderShowTable(payload: unknown): string {
  if (!isObject(payload)) {
    return renderKeyValueTable([["status", "empty"]]);
  }

  const order = readOrderRecordOrder(payload) ?? {};
  const summaryEntries: Array<[string, unknown]> = [
    ["orderHash", payload.orderHash],
    ["side", formatOrderSide(order.side)],
    ["status", readStringOrFallback(payload.status)],
    ["completion", formatCompletionLabel(deriveCompletion(payload))],
    ["timeInForce", readStringOrFallback(payload.timeInForce)],
    ["marketId", formatIdentifier(order.marketId)],
    ["outcomeId", formatIdentifier(order.outcomeId)]
  ];

  const economicsEntries: Array<[string, unknown]> = [
    ["shares", formatClobShares(order.amount)],
    ["filledShares", formatClobShares(payload.filledAmount)],
    ["price", formatProbabilityRaw(order.price)],
    ["orderValue", formatOrderValue(order.amount, order.price)],
    ["filledValue", formatOrderValue(payload.filledAmount, order.price)]
  ];

  const lifecycleEntries: Array<[string, unknown]> = [
    ["createdAt", readStringOrFallback(payload.createdAt)],
    ["updatedAt", readStringOrFallback(payload.updatedAt)],
    ["filledAt", readStringOrFallback(payload.filledAt)],
    ["cancelledAt", readStringOrFallback(payload.cancelledAt)]
  ];

  return [
    "Section: summary",
    renderKeyValueTable(summaryEntries),
    "",
    "Section: economics",
    renderKeyValueTable(economicsEntries),
    "",
    "Section: lifecycle",
    renderKeyValueTable(lifecycleEntries)
  ].join("\n");
}

function pickMostLikelyOutcome(value: unknown): string {
  if (!Array.isArray(value)) {
    return "N/A";
  }

  let chosen: { title: string; price?: number } | undefined;

  for (const entry of value) {
    if (!isObject(entry)) {
      continue;
    }

    const title = typeof entry.title === "string" && entry.title.length > 0 ? entry.title : "Outcome";
    const price = asNumber(entry.price);

    if (!chosen) {
      chosen = { title, price };
      continue;
    }

    if (price !== undefined && (chosen.price === undefined || price > chosen.price)) {
      chosen = { title, price };
    }
  }

  if (!chosen) {
    return "N/A";
  }

  if (chosen.price === undefined) {
    return `${chosen.title} (N/A)`;
  }

  return `${chosen.title} (${formatCurrency(chosen.price)})`;
}

function readStringOrFallback(value: unknown, fallback = "N/A"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function extractDatePart(raw: string): string | undefined {
  const directMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1];
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return undefined;
}

function formatExpiresAt(entry: Record<string, unknown>): string {
  const perpetualFlag =
    asBoolean(entry.is_perpetual) ??
    asBoolean(entry.isPerpetual) ??
    asBoolean(entry.perpetual) ??
    false;

  if (perpetualFlag) {
    return "Perpetual";
  }

  const rawExpires = entry.expiresAt ?? entry.expires_at;
  if (typeof rawExpires !== "string" || rawExpires.length === 0) {
    return "N/A";
  }

  const datePart = extractDatePart(rawExpires);
  if (!datePart) {
    return "N/A";
  }

  if (datePart >= "2100-01-01") {
    return "HIT";
  }

  return datePart;
}

export function renderMarketsListTable(payload: unknown): string {
  const headers = ["Title", "Most likely outcome (with price)", "Volume", "Expires At", "State", "Market ID"];

  if (!isObject(payload) || !Array.isArray(payload.data)) {
    return renderAsciiTable(headers, [["N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]]);
  }

  const rows = payload.data
    .map((entry) => {
      if (!isObject(entry)) {
        return ["N/A", "N/A", "N/A", "N/A", "N/A", "N/A"];
      }

      const title = readStringOrFallback(entry.title);
      const likelyOutcome = pickMostLikelyOutcome(entry.outcomes);
      const volume = formatCurrency(entry.volume);
      const expiresAt = formatExpiresAt(entry);
      const state = readStringOrFallback(entry.state);
      const marketId = formatIdentifier(entry.id ?? entry.marketId ?? entry.market_id);
      return [title, likelyOutcome, volume, expiresAt, state, marketId];
    })
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    rows.push(["N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]);
  }

  return renderAsciiTable(headers, rows);
}

function formatOutcomeWithPrice(value: unknown): string {
  if (!isObject(value)) {
    return "N/A";
  }

  const title = readStringOrFallback(value.title, "Outcome");
  const price = asNumber(value.price);
  if (price === undefined) {
    return `${title} (N/A)`;
  }

  return `${title} (${formatCurrency(price)})`;
}

export function renderMarketShowTable(payload: unknown): string {
  const headers = ["Title", "Outcome (Price)", "Outcome (Price)", "Volume", "Expires At", "Market ID"];

  if (!isObject(payload)) {
    return renderAsciiTable(headers, [["N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]]);
  }

  const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];
  const firstOutcome = formatOutcomeWithPrice(outcomes[0]);
  const secondOutcome = formatOutcomeWithPrice(outcomes[1]);

  const row = [
    readStringOrFallback(payload.title),
    firstOutcome,
    secondOutcome,
    formatCurrency(payload.volume),
    formatExpiresAt(payload),
    formatIdentifier(payload.id ?? payload.marketId ?? payload.market_id)
  ];

  return renderAsciiTable(headers, [row]);
}

function formatBooleanLabel(value: unknown): string {
  const parsed = asBoolean(value);
  if (parsed === undefined) {
    return "N/A";
  }
  return parsed ? "yes" : "no";
}

function countEventOutcomes(entry: Record<string, unknown>): string {
  if (Array.isArray(entry.markets)) {
    return String(entry.markets.length);
  }
  if (Array.isArray(entry.outcomes)) {
    return String(entry.outcomes.length);
  }
  return "N/A";
}

function formatTimestamp(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return "N/A";
  }

  const date = new Date(numeric * 1000);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }
  return date.toISOString();
}

export function renderObEventsListTable(payload: unknown): string {
  const headers = ["Title", "Outcomes", "Volume", "Liquidity", "Expires At", "State", "NegRisk", "Event ID"];

  if (!isObject(payload) || !Array.isArray(payload.data)) {
    return renderAsciiTable(headers, [["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]]);
  }

  const rows = payload.data
    .filter((entry) => isObject(entry))
    .map((entry) => [
      readStringOrFallback(entry.title),
      countEventOutcomes(entry),
      formatCurrency(entry.volume),
      formatCurrency(entry.liquidity),
      formatExpiresAt(entry),
      readStringOrFallback(entry.state),
      formatBooleanLabel(entry.negRisk),
      formatIdentifier(entry.id)
    ]);

  if (rows.length === 0) {
    rows.push(["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]);
  }

  return renderAsciiTable(headers, rows);
}

export function renderObEventShowTable(payload: unknown): string {
  if (!isObject(payload)) {
    return renderKeyValueTable([["status", "empty"]]);
  }

  const summaryEntries: Array<[string, unknown]> = [
    ["title", readStringOrFallback(payload.title)],
    ["eventId", formatIdentifier(payload.id)],
    ["slug", readStringOrFallback(payload.slug)],
    ["networkId", formatIdentifier(payload.networkId)],
    ["state", readStringOrFallback(payload.state)],
    ["negRisk", formatBooleanLabel(payload.negRisk)],
    ["negRiskId", readStringOrFallback(payload.negRiskId)],
    ["outcomes", countEventOutcomes(payload)],
    ["volume", formatCurrency(payload.volume)],
    ["liquidity", formatCurrency(payload.liquidity)],
    ["expiresAt", formatExpiresAt(payload)]
  ];

  const marketHeaders = ["Outcome Index", "Market", "Most likely outcome (with price)", "State", "Market ID"];
  const marketRows = Array.isArray(payload.markets)
    ? payload.markets
        .filter((market) => isObject(market))
        .map((market) => [
          formatIdentifier(market.outcomeIndex),
          readStringOrFallback(market.title),
          pickMostLikelyOutcome(market.outcomes),
          readStringOrFallback(market.state),
          formatIdentifier(market.id ?? market.marketId ?? market.market_id)
        ])
    : [];

  if (marketRows.length === 0) {
    marketRows.push(["N/A", "N/A", "N/A", "N/A", "N/A"]);
  }

  return [
    "Section: summary",
    renderKeyValueTable(summaryEntries),
    "",
    "Section: markets",
    renderAsciiTable(marketHeaders, marketRows)
  ].join("\n");
}

export function renderObEventActionsTable(payload: unknown): string {
  const headers = ["Time", "Action", "Market", "Outcome", "Shares", "Value", "User", "Tx"];

  if (!isObject(payload) || !Array.isArray(payload.data)) {
    return renderAsciiTable(headers, [["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]]);
  }

  const rows = payload.data
    .filter((entry) => isObject(entry))
    .map((entry) => [
      formatTimestamp(entry.timestamp),
      readStringOrFallback(entry.action),
      readStringOrFallback(entry.marketTitle),
      readStringOrFallback(entry.outcomeTitle),
      formatDecimal(entry.shares),
      formatCurrency(entry.value),
      readStringOrFallback(entry.user),
      readStringOrFallback(entry.txId)
    ]);

  if (rows.length === 0) {
    rows.push(["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]);
  }

  return renderAsciiTable(headers, rows);
}

export function renderObEventOrderbookLadder(payload: unknown, options: OrderbookRenderOptions = {}): string {
  if (!isObject(payload) || !Array.isArray(payload.outcomes)) {
    return "Event orderbook is empty.";
  }

  const sections = payload.outcomes
    .filter((entry) => isObject(entry))
    .map((entry) =>
      renderOrderbookLadder(
        {
          marketId: entry.ethMarketId ?? entry.marketId,
          marketTitle: entry.title,
          outcomeId: entry.outcomeIndex,
          ...(isObject(entry.orderbook) ? entry.orderbook : {})
        },
        {
          ...options,
          outcomeLabel: "Outcome Index"
        }
      )
    );

  if (sections.length === 0) {
    return "Event orderbook is empty.";
  }

  const header = `Event orderbook: ${readStringOrFallback(payload.eventTitle, "Unknown event")}`;
  return [header, ...sections].join("\n\n");
}

const decimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatDecimal(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return "N/A";
  }

  return decimalFormatter.format(numeric);
}

function formatPercent(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return "N/A";
  }

  return `${decimalFormatter.format(numeric)}%`;
}

function formatIdentifier(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : decimalFormatter.format(value);
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return "N/A";
}

function normalizePortfolioStatus(entry: Record<string, unknown>): string {
  const rawStatus = readStringOrFallback(entry.status ?? entry.marketState ?? entry.state, "").toLowerCase();
  if (rawStatus === "ongoing") {
    return "open";
  }
  return rawStatus;
}

function isPortfolioPositionClaimed(entry: Record<string, unknown>): boolean {
  const explicitClaimed = asBoolean(entry.claimed) ?? asBoolean(entry.isClaimed);
  if (explicitClaimed !== undefined) {
    return explicitClaimed;
  }

  const winningsClaimed = asBoolean(entry.winningsClaimed);
  const voidedWinningsClaimed = asBoolean(entry.voidedWinningsClaimed);
  if (winningsClaimed !== undefined || voidedWinningsClaimed !== undefined) {
    return Boolean(winningsClaimed) || Boolean(voidedWinningsClaimed);
  }

  return false;
}

function readPortfolioMarketTitle(entry: Record<string, unknown>): string {
  const fromDirect = readStringOrFallback(entry.marketTitle ?? entry.market_title, "");
  if (fromDirect) {
    return fromDirect;
  }

  if (isObject(entry.market)) {
    return readStringOrFallback(entry.market.title);
  }

  return "N/A";
}

function readPortfolioOutcomeTitle(entry: Record<string, unknown>): string {
  const fromDirect = readStringOrFallback(entry.outcomeTitle ?? entry.outcome_title, "");
  if (fromDirect) {
    return fromDirect;
  }

  if (isObject(entry.outcome)) {
    return readStringOrFallback(entry.outcome.title);
  }

  return "N/A";
}

export function renderPortfolioTable(payload: unknown): string {
  const headers = ["Market", "Outcome", "Shares", "Price", "Current Value", "Current ROI", "Status", "Market ID", "Outcome ID"];

  if (!isObject(payload) || !Array.isArray(payload.data)) {
    return renderAsciiTable(headers, [["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]]);
  }

  const includedStatuses = new Set(["open", "voided", "won"]);

  const rows = payload.data
    .filter((entry) => isObject(entry))
    .filter((entry) => includedStatuses.has(normalizePortfolioStatus(entry)))
    .filter((entry) => isPortfolioPositionClaimed(entry) === false)
    .map((entry) => {
      const status = normalizePortfolioStatus(entry);
      const marketId = formatIdentifier(entry.marketId ?? entry.market_id ?? (isObject(entry.market) ? entry.market.id : undefined));
      const outcomeId = formatIdentifier(
        entry.outcomeId ?? entry.outcome_id ?? (isObject(entry.outcome) ? entry.outcome.id : undefined)
      );

      return [
        readPortfolioMarketTitle(entry),
        readPortfolioOutcomeTitle(entry),
        formatDecimal(entry.shares),
        formatCurrency(entry.price),
        formatCurrency(entry.value),
        formatPercent(entry.totalRoi),
        status || "N/A",
        marketId,
        outcomeId
      ];
    });

  if (rows.length === 0) {
    rows.push(["N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A", "N/A"]);
  }

  return renderAsciiTable(headers, rows);
}
