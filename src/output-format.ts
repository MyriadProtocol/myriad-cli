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

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function formatCurrency(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === undefined) {
    return "N/A";
  }

  return usdFormatter.format(numeric);
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
