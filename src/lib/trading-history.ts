import type { StrategyTrade } from "@/lib/over-under-strategy";

export const TRADING_HISTORY_KEY = "overunder.trading-history.v1";
export const MAX_SAVED_TRADES = 10_000;
export const MAX_SAVED_SESSIONS = 10_000;

export type TradingSessionStatus =
  "running" | "paused" | "stopped" | "completed" | "interrupted" | "failed";

export interface TradingSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: TradingSessionStatus;
  currency: string;
  tradeCount: number;
  settledCount: number;
  wins: number;
  losses: number;
  pnl: number;
}

export interface SavedTradingHistory {
  trades: StrategyTrade[];
  sessions: TradingSession[];
  currentSessionId: string | null;
  sessionPnl: number;
  lossStreak: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function emptyHistory(): SavedTradingHistory {
  return { trades: [], sessions: [], currentSessionId: null, sessionPnl: 0, lossStreak: 0 };
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
    (value["currency"] === undefined || typeof value["currency"] === "string") &&
    (value["sessionId"] === undefined || typeof value["sessionId"] === "string")
  );
}

function isSession(value: unknown): value is TradingSession {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["startedAt"] === "string" &&
    (value["endedAt"] === null || typeof value["endedAt"] === "string") &&
    ["running", "paused", "stopped", "completed", "interrupted", "failed"].includes(
      String(value["status"]),
    ) &&
    typeof value["currency"] === "string" &&
    Number.isInteger(value["tradeCount"]) &&
    Number.isInteger(value["settledCount"]) &&
    Number.isInteger(value["wins"]) &&
    Number.isInteger(value["losses"]) &&
    Number.isFinite(value["pnl"])
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

function validAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function validLossStreak(value: unknown): number {
  const streak = Number(value);
  return Number.isInteger(streak) && streak > 0 ? streak : 0;
}

function migrateVersionOne(parsed: Record<string, unknown>): SavedTradingHistory {
  const trades = Array.isArray(parsed["trades"]) ? parsed["trades"].filter(isTrade) : [];
  const sessionPnl = validAmount(parsed["sessionPnl"]);
  const lossStreak = validLossStreak(parsed["lossStreak"]);
  if (!trades.length && sessionPnl === 0) return { ...emptyHistory(), lossStreak };

  const savedAt =
    typeof parsed["savedAt"] === "string" ? parsed["savedAt"] : new Date().toISOString();
  const sessionId = `previous-${savedAt}`;
  const settled = trades.filter((trade) => trade.status !== "Open");
  const sessions: TradingSession[] = [
    {
      id: sessionId,
      startedAt: savedAt,
      endedAt: savedAt,
      status: trades.some((trade) => trade.status === "Open") ? "interrupted" : "completed",
      currency: trades.find((trade) => trade.currency)?.currency ?? "USD",
      tradeCount: trades.length,
      settledCount: settled.length,
      wins: settled.filter((trade) => trade.status === "Won").length,
      losses: settled.filter((trade) => trade.status === "Lost").length,
      pnl: sessionPnl,
    },
  ];

  return {
    trades: trades.slice(0, MAX_SAVED_TRADES).map((trade) => ({ ...trade, sessionId })),
    sessions,
    currentSessionId: sessionId,
    sessionPnl,
    lossStreak,
  };
}

export function loadTradingHistory(storage = browserStorage()): SavedTradingHistory {
  if (!storage) return emptyHistory();
  try {
    const raw = storage.getItem(TRADING_HISTORY_KEY);
    if (!raw) return emptyHistory();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyHistory();
    if (parsed["version"] === 1) return migrateVersionOne(parsed);
    if (parsed["version"] !== 2 || !Array.isArray(parsed["trades"])) return emptyHistory();

    const sessions = (Array.isArray(parsed["sessions"]) ? parsed["sessions"] : [])
      .filter(isSession)
      .slice(0, MAX_SAVED_SESSIONS)
      .map((session) =>
        session.status === "running"
          ? { ...session, status: "interrupted" as const, endedAt: new Date().toISOString() }
          : session,
      );
    const trades = parsed["trades"].filter(isTrade).slice(0, MAX_SAVED_TRADES);
    const requestedCurrentId = parsed["currentSessionId"];
    const currentSessionId =
      typeof requestedCurrentId === "string" &&
      sessions.some((session) => session.id === requestedCurrentId)
        ? requestedCurrentId
        : (sessions[0]?.id ?? trades[0]?.sessionId ?? null);

    return {
      trades: trades.map((trade) => {
        const sessionId = trade.sessionId ?? currentSessionId;
        return sessionId ? { ...trade, sessionId } : trade;
      }),
      sessions,
      currentSessionId,
      sessionPnl: validAmount(parsed["sessionPnl"]),
      lossStreak: validLossStreak(parsed["lossStreak"]),
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
        version: 2,
        savedAt: new Date().toISOString(),
        trades: history.trades.slice(0, MAX_SAVED_TRADES),
        sessions: history.sessions.slice(0, MAX_SAVED_SESSIONS),
        currentSessionId: history.currentSessionId,
        sessionPnl: history.sessionPnl,
        lossStreak: history.lossStreak,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function createTradingSession(
  id: string,
  currency: string,
  startedAt = new Date().toISOString(),
): TradingSession {
  return {
    id,
    startedAt,
    endedAt: null,
    status: "running",
    currency,
    tradeCount: 0,
    settledCount: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
  };
}

export function updateTradingSessionTrade(
  sessions: TradingSession[],
  sessionId: string,
  trade: StrategyTrade,
  previousTrade?: StrategyTrade,
): TradingSession[] {
  const wasSettled = previousTrade && previousTrade.status !== "Open";
  const isSettled = trade.status !== "Open";
  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          tradeCount: session.tradeCount + (previousTrade ? 0 : 1),
          settledCount: session.settledCount + Number(isSettled) - Number(wasSettled === true),
          wins:
            session.wins + Number(trade.status === "Won") - Number(previousTrade?.status === "Won"),
          losses:
            session.losses +
            Number(trade.status === "Lost") -
            Number(previousTrade?.status === "Lost"),
          pnl: session.pnl + (trade.profit ?? 0) - (previousTrade?.profit ?? 0),
        }
      : session,
  );
}

export function finishTradingSession(
  sessions: TradingSession[],
  sessionId: string,
  status: Exclude<TradingSessionStatus, "running">,
  endedAt = new Date().toISOString(),
): TradingSession[] {
  return sessions.map((session) =>
    session.id === sessionId ? { ...session, status, endedAt } : session,
  );
}

export function tradingHistoryCsv(trades: StrategyTrade[]): string {
  const rows = [
    [
      "Trade ID",
      "Session ID",
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
        trade.sessionId ?? "",
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
