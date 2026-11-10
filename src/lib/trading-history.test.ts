import { describe, expect, it } from "vitest";

import {
  loadTradingHistory,
  MAX_SAVED_TRADES,
  saveTradingHistory,
  TRADING_HISTORY_KEY,
  tradingHistoryCsv,
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
    expect(saveTradingHistory({ trades: [trade], sessionPnl: 2.5, lossStreak: 0 }, storage)).toBe(
      true,
    );
    expect(loadTradingHistory(storage)).toEqual({
      trades: [trade],
      sessionPnl: 2.5,
      lossStreak: 0,
    });
  });

  it("returns an empty history for corrupt or unsupported saved data", () => {
    expect(loadTradingHistory(memoryStorage("not-json"))).toEqual({
      trades: [],
      sessionPnl: 0,
      lossStreak: 0,
    });
    expect(
      loadTradingHistory(memoryStorage(JSON.stringify({ version: 2, trades: [trade] }))),
    ).toEqual({
      trades: [],
      sessionPnl: 0,
      lossStreak: 0,
    });
  });

  it("caps restored and saved trades to the supported history size", () => {
    const manyTrades = Array.from({ length: MAX_SAVED_TRADES + 1 }, (_, index) => ({
      ...trade,
      id: `contract-${index}`,
    }));
    const storage = memoryStorage();
    expect(saveTradingHistory({ trades: manyTrades, sessionPnl: 0, lossStreak: 0 }, storage)).toBe(
      true,
    );
    expect(loadTradingHistory(storage).trades).toHaveLength(MAX_SAVED_TRADES);
  });

  it("reports storage quota failures instead of claiming the history was saved", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(saveTradingHistory({ trades: [trade], sessionPnl: 0, lossStreak: 0 }, storage)).toBe(
      false,
    );
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
