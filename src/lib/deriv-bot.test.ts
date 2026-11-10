import { describe, expect, it, vi } from "vitest";

import { DerivBot, type BotCallbacks, type BotOptions } from "@/lib/deriv-bot";
import type { DerivMessage, DerivSocketClient, DerivTick } from "@/lib/deriv-socket";

class FakeDerivSocket {
  requests: Array<Record<string, unknown>> = [];
  tickHandler: ((tick: DerivTick) => void) | null = null;
  contractHandler: ((contract: Record<string, unknown>) => void) | null = null;
  proposalGate: Promise<DerivMessage> | null = null;
  private contractNumber = 0;

  onClose() {
    return () => {};
  }

  onTick(handler: (tick: DerivTick) => void) {
    this.tickHandler = handler;
    return () => {
      this.tickHandler = null;
    };
  }

  async subscribeTicks() {
    return () => {};
  }

  async request(payload: Record<string, unknown>): Promise<DerivMessage> {
    this.requests.push(payload);
    if ("proposal" in payload) {
      if (this.proposalGate) return this.proposalGate;
      return {
        proposal: {
          id: `proposal-${this.requests.length}`,
          ask_price: payload["amount"] as number,
        },
      };
    }
    if ("buy" in payload) {
      this.contractNumber += 1;
      return { buy: { contract_id: this.contractNumber } };
    }
    return {};
  }

  watchContract(_contractId: string, handler: (contract: Record<string, unknown>) => void) {
    this.contractHandler = handler;
    return () => {
      this.contractHandler = null;
    };
  }

  emitTick(epoch: number, quote: string) {
    this.tickHandler?.({ epoch, quote, pip_size: 3 });
  }

  settle(profit: number) {
    this.contractHandler?.({ is_sold: 1, profit, exit_tick_display_value: "4.852" });
  }
}

const options: BotOptions = {
  symbol: "1HZ100V",
  currency: "USD",
  duration: 1,
  baseStake: 1,
  recoveryMultiplier: 1.5,
  takeProfit: 25,
  stopLoss: 10,
};

async function until(condition: () => boolean) {
  for (let count = 0; count < 20 && !condition(); count += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("Deriv bot", () => {
  it("places Over 1 on a zero/one tick, recovers with Under 8, and resumes analysis after a win", async () => {
    const socket = new FakeDerivSocket();
    const updates: Array<{ contract?: string; status?: string; profit?: number | null }> = [];
    let latestPnl = 0;
    let latestLossStreak = 0;
    const callbacks: BotCallbacks = {
      onTrade: (trade) =>
        updates.push({ contract: trade.contract, status: trade.status, profit: trade.profit }),
      onPnl: (pnl, streak) => {
        latestPnl = pnl;
        latestLossStreak = streak;
      },
      onStop: vi.fn(),
      onError: vi.fn(),
    };
    const bot = new DerivBot(socket as unknown as DerivSocketClient, options, callbacks);
    await bot.start();

    socket.emitTick(1, "4.551");
    await until(
      () => socket.requests.some((request) => "buy" in request) && socket.contractHandler !== null,
    );
    const firstProposal = socket.requests.find((request) => "proposal" in request);
    expect(firstProposal).toMatchObject({ contract_type: "DIGITOVER", barrier: "1", amount: 1 });
    socket.settle(-1);
    await until(() => !bot.isBusy);
    expect(latestLossStreak).toBe(1);
    expect(latestPnl).toBe(-1);

    socket.emitTick(2, "4.854");
    await until(
      () =>
        socket.requests.filter((request) => "proposal" in request).length === 2 &&
        socket.contractHandler !== null,
    );
    const recoveryProposal = socket.requests.filter((request) => "proposal" in request)[1];
    expect(recoveryProposal).toMatchObject({
      contract_type: "DIGITUNDER",
      barrier: "8",
      amount: 1.5,
    });
    socket.settle(0.8);
    await until(() => !bot.isBusy);
    expect(latestLossStreak).toBe(0);
    expect(latestPnl).toBe(-0.2);

    socket.emitTick(3, "4.850");
    await until(
      () =>
        socket.requests.filter((request) => "proposal" in request).length === 3 &&
        socket.contractHandler !== null,
    );
    const nextProposal = socket.requests.filter((request) => "proposal" in request)[2];
    expect(nextProposal).toMatchObject({ contract_type: "DIGITOVER", barrier: "1", amount: 1 });
    expect(updates.map((trade) => trade.status)).toEqual(["Open", "Lost", "Open", "Won", "Open"]);
    bot.pause();
  });

  it("stops before a stake that would exceed the session stop loss", async () => {
    const socket = new FakeDerivSocket();
    const onStop = vi.fn();
    const bot = new DerivBot(
      socket as unknown as DerivSocketClient,
      { ...options, stopLoss: 0.5 },
      {
        onTrade: vi.fn(),
        onPnl: vi.fn(),
        onStop,
        onError: vi.fn(),
      },
    );
    await bot.start();
    socket.emitTick(1, "4.551");
    expect(onStop).toHaveBeenCalledOnce();
    expect(socket.requests).toHaveLength(0);
  });

  it("does not buy a proposed contract after the user pauses during price lookup", async () => {
    const socket = new FakeDerivSocket();
    let resolveProposal!: (message: DerivMessage) => void;
    socket.proposalGate = new Promise((resolve) => {
      resolveProposal = resolve;
    });
    const onStop = vi.fn();
    const bot = new DerivBot(socket as unknown as DerivSocketClient, options, {
      onTrade: vi.fn(),
      onPnl: vi.fn(),
      onStop,
      onError: vi.fn(),
    });
    await bot.start();
    socket.emitTick(1, "4.551");
    await until(() => socket.requests.some((request) => "proposal" in request));

    bot.pause();
    resolveProposal({ proposal: { id: "proposal-paused", ask_price: 1 } });
    await until(() => onStop.mock.calls.length > 0);

    expect(socket.requests.some((request) => "buy" in request)).toBe(false);
    expect(onStop).toHaveBeenCalledWith("Bot paused before the contract was placed.");
    expect(bot.isBusy).toBe(false);
  });
});
