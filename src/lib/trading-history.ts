import type { StrategyTrade } from "@/lib/over-under-strategy";

export const TRADING_HISTORY_KEY = "overunder.trading-history.v1";
export const MAX_SAVED_TRADES = 10_000;

export interface SavedTradingHistory {
  trades: StrategyTrade[];
  sessionPnl: number;
  lossStreak: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function emptyHistory(): SavedTradingHistory {
  return { trades: [], sessionPnl: 0, lossStreak: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTrade(value: unknown): value is StrategyTrade {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["time"] === "string" &&
    Number.isInteger(value["entryDigit"]) &&
    typeof value["exitDigit"] === "string" &&
    typeof value["contract"] === "string" &&
    Number.isFinite(value["stake"]) &&
    ["Open", "Won", "Lost", "Even"].includes(String(value["status"])) &&
    (value["profit"] === null || Number.isFinite(value["profit"])) &&
    (value["currency"] === undefined || typeof value["currency"] === "string")
  );
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTradingHistory(storage = browserStorage()): SavedTradingHistory {
  if (!storage) return emptyHistory();
  try {
    const raw = storage.getItem(TRADING_HISTORY_KEY);
    if (!raw) return emptyHistory();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed["version"] !== 1 || !Array.isArray(parsed["trades"])) {
      return emptyHistory();
    }
    const trades = parsed["trades"].filter(isTrade).slice(0, MAX_SAVED_TRADES);
    const sessionPnl = Number(parsed["sessionPnl"]);
    const lossStreak = Number(parsed["lossStreak"]);
    return {
      trades,
      sessionPnl: Number.isFinite(sessionPnl) ? sessionPnl : 0,
      lossStreak: Number.isInteger(lossStreak) && lossStreak > 0 ? lossStreak : 0,
    };
  } catch {
    return emptyHistory();
  }
}

export function saveTradingHistory(
  history: SavedTradingHistory,
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      TRADING_HISTORY_KEY,
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        trades: history.trades.slice(0, MAX_SAVED_TRADES),
        sessionPnl: history.sessionPnl,
        lossStreak: history.lossStreak,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function tradingHistoryCsv(trades: StrategyTrade[]): string {
  const rows = [
    [
      "Trade ID",
      "Time",
      "Entry digit",
      "Contract",
      "Exit digit",
      "Stake",
      "Currency",
      "Status",
      "Profit",
    ],
    ...[...trades]
      .reverse()
      .map((trade) => [
        trade.id,
        trade.time,
        trade.entryDigit,
        trade.contract,
        trade.exitDigit,
        trade.stake,
        trade.currency ?? "USD",
        trade.status,
        trade.profit ?? "",
      ]),
  ];
  return `\uFEFF${rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\r\n")}`;
}
