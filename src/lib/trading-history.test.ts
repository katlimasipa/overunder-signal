import { describe, expect, it } from "vitest";

import {
  createTradingSession,
  finishTradingSession,
  loadTradingHistory,
  MAX_SAVED_TRADES,
  saveTradingHistory,
  TRADING_HISTORY_KEY,
  tradingHistoryCsv,
  updateTradingSessionTrade,
} from "@/lib/trading-history";
import type { StrategyTrade } from "@/lib/over-under-strategy";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(TRADING_HISTORY_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const trade: StrategyTrade = {
  id: "contract-1",
  time: "12:08:19",
  entryDigit: 1,
  exitDigit: "4",
  contract: "Over 1",
  stake: 1,
  currency: "USD",
  status: "Won",
  profit: 0.95,
};

describe("trading history storage", () => {
  it("saves and restores trades and session risk state", () => {
    const storage = memoryStorage();
    const session = { ...createTradingSession("session-1", "USD"), status: "completed" as const };
    session.endedAt = "2026-01-01T00:01:00.000Z";
    session.tradeCount = 1;
    session.settledCount = 1;
    session.wins = 1;
    session.pnl = 2.5;
    expect(
      saveTradingHistory(
        {
          trades: [{ ...trade, sessionId: session.id }],
          sessions: [session],
          currentSessionId: session.id,
          sessionPnl: 2.5,
          lossStreak: 0,
        },
        storage,
      ),
    ).toBe(true);
    expect(loadTradingHistory(storage)).toEqual({
      trades: [{ ...trade, sessionId: session.id }],
      sessions: [session],
      currentSessionId: session.id,
      sessionPnl: 2.5,
      lossStreak: 0,
    });
  });

  it("returns an empty history for corrupt or unsupported saved data", () => {
    expect(loadTradingHistory(memoryStorage("not-json"))).toEqual({
      trades: [],
      sessions: [],
      currentSessionId: null,
      sessionPnl: 0,
      lossStreak: 0,
    });
    expect(
      loadTradingHistory(memoryStorage(JSON.stringify({ version: 3, trades: [trade] }))),
    ).toEqual({
      trades: [],
      sessions: [],
      currentSessionId: null,
      sessionPnl: 0,
      lossStreak: 0,
    });
  });

  it("migrates previously saved trades into a preserved previous session", () => {
    const savedAt = "2026-01-01T00:00:00.000Z";
    const loaded = loadTradingHistory(
      memoryStorage(
        JSON.stringify({ version: 1, savedAt, trades: [trade], sessionPnl: 0.95, lossStreak: 0 }),
      ),
    );
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0]).toMatchObject({
      id: `previous-${savedAt}`,
      status: "completed",
      tradeCount: 1,
      settledCount: 1,
      wins: 1,
      pnl: 0.95,
    });
    expect(loaded.trades[0]?.sessionId).toBe(loaded.currentSessionId);
  });

  it("marks a session interrupted if the app closed while it was running", () => {
    const running = createTradingSession("session-1", "USD", "2026-01-01T00:00:00.000Z");
    const storage = memoryStorage(
      JSON.stringify({
        version: 2,
        trades: [],
        sessions: [running],
        currentSessionId: running.id,
        sessionPnl: 0,
        lossStreak: 0,
      }),
    );
    expect(loadTradingHistory(storage).sessions[0]).toMatchObject({
      status: "interrupted",
      endedAt: expect.any(String),
    });
  });

  it("keeps per-session totals in sync as a trade settles", () => {
    const session = createTradingSession("session-1", "USD");
    const openTrade = { ...trade, status: "Open" as const, profit: null };
    const withOpenTrade = updateTradingSessionTrade([session], session.id, openTrade);
    expect(withOpenTrade[0]).toMatchObject({ tradeCount: 1, settledCount: 0, pnl: 0 });
    const settledTrade = { ...trade, sessionId: session.id };
    const withSettledTrade = updateTradingSessionTrade(
      withOpenTrade,
      session.id,
      settledTrade,
      openTrade,
    );
    expect(withSettledTrade[0]).toMatchObject({
      tradeCount: 1,
      settledCount: 1,
      wins: 1,
      losses: 0,
      pnl: 0.95,
    });
    expect(finishTradingSession(withSettledTrade, session.id, "completed")[0]?.status).toBe(
      "completed",
    );
  });

  it("caps restored and saved trades to the supported history size", () => {
    const manyTrades = Array.from({ length: MAX_SAVED_TRADES + 1 }, (_, index) => ({
      ...trade,
      id: `contract-${index}`,
    }));
    const storage = memoryStorage();
    expect(
      saveTradingHistory(
        { trades: manyTrades, sessions: [], currentSessionId: null, sessionPnl: 0, lossStreak: 0 },
        storage,
      ),
    ).toBe(true);
    expect(loadTradingHistory(storage).trades).toHaveLength(MAX_SAVED_TRADES);
  });

  it("reports storage quota failures instead of claiming the history was saved", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(
      saveTradingHistory(
        { trades: [trade], sessions: [], currentSessionId: null, sessionPnl: 0, lossStreak: 0 },
        storage,
      ),
    ).toBe(false);
  });
});

describe("trade history CSV", () => {
  it("includes a spreadsheet BOM and quotes and escapes every value", () => {
    const result = tradingHistoryCsv([{ ...trade, contract: 'Over "1", custom' }]);
    expect(result.startsWith("\uFEFF")).toBe(true);
    expect(result).toContain('"Over ""1"", custom"');
    expect(result).toContain('"USD"');
    expect(result).toContain('"0.95"');
  });

  it("exports open trades with an empty result value", () => {
    const result = tradingHistoryCsv([{ ...trade, status: "Open", profit: null }]);
    expect(result).toContain('"Open",""');
  });
});
