import { describe, expect, it, vi } from "vitest";

import { DerivBot, type BotCallbacks, type BotOptions } from "@/lib/deriv-bot";
import type { DerivMessage, DerivSocketClient, DerivTick } from "@/lib/deriv-socket";

class FakeDerivSocket {
  requests: Array<Record<string, unknown>> = [];
  tickHandler: ((tick: DerivTick) => void) | null = null;
  contractHandler: ((contract: Record<string, unknown>) => void) | null = null;
  proposalGate: Promise<DerivMessage> | null = null;
  forgotten: string[] = [];
  watchedContractId: number | null = null;
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
        subscription: { id: `proposal-stream-${this.requests.length}` },
      };
    }
    if ("buy" in payload) {
      this.contractNumber += 1;
      return { buy: { contract_id: this.contractNumber } };
    }
    return {};
  }

  forget(subscriptionId: string | undefined) {
    if (subscriptionId) this.forgotten.push(subscriptionId);
  }

  watchContract(contractId: number, handler: (contract: Record<string, unknown>) => void) {
    this.watchedContractId = contractId;
    this.contractHandler = handler;
    return () => {
      this.contractHandler = null;
    };
  }

  emitTick(epoch: number, quote: string) {
    this.tickHandler?.({ epoch, quote, pip_size: 3 });
  }

  settle(profit: number) {
    this.contractHandler?.({
      contract_id: this.watchedContractId,
      is_sold: 1,
      status: profit > 0 ? "won" : "lost",
      profit: String(profit),
      exit_spot: "4.852",
    });
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
    expect(firstProposal).toMatchObject({
      contract_type: "DIGITOVER",
      barrier: "1",
      amount: 1,
      subscribe: 1,
    });
    expect(socket.watchedContractId).toBe(1);
    expect(socket.forgotten).toContain("proposal-stream-1");
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

  it("waits for two consecutive zero/one ticks before each Over 1 trade", async () => {
    const socket = new FakeDerivSocket();
    const bot = new DerivBot(
      socket as unknown as DerivSocketClient,
      { ...options, waitForFailedCycle: true },
      { onTrade: vi.fn(), onPnl: vi.fn(), onStop: vi.fn(), onError: vi.fn() },
    );
    await bot.start();

    socket.emitTick(1, "4.551"); // First low digit starts the observed cycle.
    socket.emitTick(2, "4.552"); // A non-low digit means the Over 1 cycle did not fail.
    socket.emitTick(3, "4.550");
    expect(socket.requests.filter((request) => "proposal" in request)).toHaveLength(0);

    socket.emitTick(4, "4.551");
    await until(() => socket.contractHandler !== null);
    expect(socket.requests.find((request) => "proposal" in request)).toMatchObject({
      contract_type: "DIGITOVER",
      barrier: "1",
    });
    socket.settle(0.8);
    await until(() => !bot.isBusy);

    socket.emitTick(5, "4.551");
    socket.emitTick(6, "4.552");
    socket.emitTick(7, "4.550");
    expect(socket.requests.filter((request) => "proposal" in request)).toHaveLength(1);
    socket.emitTick(8, "4.550");
    await until(
      () =>
        socket.requests.filter((request) => "proposal" in request).length === 2 &&
        socket.contractHandler !== null,
    );
    expect(socket.requests.filter((request) => "proposal" in request)[1]).toMatchObject({
      contract_type: "DIGITOVER",
      barrier: "1",
    });
    socket.settle(0.8);
    await until(() => !bot.isBusy);
    bot.pause();
  });

  it("waits for an eight or nine before each Under 8 recovery trade", async () => {
    const socket = new FakeDerivSocket();
    const bot = new DerivBot(
      socket as unknown as DerivSocketClient,
      { ...options, waitForFailedCycle: true, initialLossStreak: 1 },
      { onTrade: vi.fn(), onPnl: vi.fn(), onStop: vi.fn(), onError: vi.fn() },
    );
    await bot.start();

    socket.emitTick(1, "4.857");
    expect(socket.requests.filter((request) => "proposal" in request)).toHaveLength(0);
    socket.emitTick(2, "4.858");
    await until(() => socket.contractHandler !== null);
    expect(socket.requests.filter((request) => "proposal" in request)[0]).toMatchObject({
      contract_type: "DIGITUNDER",
      barrier: "8",
      amount: 1.5,
    });

    socket.settle(-1.5);
    await until(() => !bot.isBusy);
    socket.emitTick(3, "4.857");
    expect(socket.requests.filter((request) => "proposal" in request)).toHaveLength(1);
    socket.emitTick(4, "4.859");
    await until(
      () =>
        socket.requests.filter((request) => "proposal" in request).length === 2 &&
        socket.contractHandler !== null,
    );
    expect(socket.requests.filter((request) => "proposal" in request)[1]).toMatchObject({
      contract_type: "DIGITUNDER",
      barrier: "8",
      amount: 2.25,
    });
    socket.settle(0.8);
    await until(() => !bot.isBusy);
    bot.pause();
  });

  it("keeps take-profit enforcement active with the failed-cycle filter", async () => {
    const socket = new FakeDerivSocket();
    const onStop = vi.fn();
    const bot = new DerivBot(
      socket as unknown as DerivSocketClient,
      { ...options, waitForFailedCycle: true, takeProfit: 0.5 },
      { onTrade: vi.fn(), onPnl: vi.fn(), onStop, onError: vi.fn() },
    );
    await bot.start();

    socket.emitTick(1, "4.550");
    socket.emitTick(2, "4.551");
    await until(() => socket.contractHandler !== null);
    socket.settle(0.8);
    await until(() => !bot.isBusy);

    expect(bot.isActive).toBe(false);
    expect(onStop).toHaveBeenCalledWith("Your take profit limit has been reached.");
  });

  it("keeps stop-loss enforcement active with the failed-cycle filter", async () => {
    const socket = new FakeDerivSocket();
    const onStop = vi.fn();
    const bot = new DerivBot(
      socket as unknown as DerivSocketClient,
      {
        ...options,
        baseStake: 0.5,
        takeProfit: null,
        stopLoss: 0.5,
        waitForFailedCycle: true,
      },
      { onTrade: vi.fn(), onPnl: vi.fn(), onStop, onError: vi.fn() },
    );
    await bot.start();

    socket.emitTick(1, "4.550");
    socket.emitTick(2, "4.551");
    await until(() => socket.contractHandler !== null);
    socket.settle(-0.5);
    await until(() => !bot.isBusy);

    expect(bot.isActive).toBe(false);
    expect(onStop).toHaveBeenCalledWith("Your stop loss limit has been reached.");
  });

  it("stops opening trades when paused and still records an open trade's settlement", async () => {
    const socket = new FakeDerivSocket();
    const statuses: string[] = [];
    const bot = new DerivBot(socket as unknown as DerivSocketClient, options, {
      onTrade: (trade) => statuses.push(trade.status),
      onPnl: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
    });
    await bot.start();
    socket.emitTick(1, "4.551");
    await until(() => socket.contractHandler !== null);

    bot.pause();
    socket.emitTick(2, "4.550");
    socket.settle(0.82);
    await until(() => !bot.isBusy);

    expect(socket.requests.filter((request) => "buy" in request)).toHaveLength(1);
    expect(statuses).toEqual(["Open", "Won"]);
  });

  it("allows a recovery stake above the stop loss and stops after realized losses hit the limit", async () => {
    const socket = new FakeDerivSocket();
    const onStop = vi.fn();
    const bot = new DerivBot(
      socket as unknown as DerivSocketClient,
      {
        ...options,
        baseStake: 1.5,
        stopLoss: 0.5,
        takeProfit: null,
        initialLossStreak: 1,
      },
      {
        onTrade: vi.fn(),
        onPnl: vi.fn(),
        onStop,
        onError: vi.fn(),
      },
    );
    await bot.start();
    socket.emitTick(1, "4.854");
    await until(() => socket.contractHandler !== null);

    const proposal = socket.requests.find((request) => "proposal" in request);
    expect(proposal).toMatchObject({
      contract_type: "DIGITUNDER",
      barrier: "8",
      amount: 2.25,
    });
    expect(bot.isActive).toBe(true);
    expect(onStop).not.toHaveBeenCalled();

    socket.settle(-2.25);
    await until(() => !bot.isBusy);

    expect(bot.isActive).toBe(false);
    expect(onStop).toHaveBeenCalledWith("Your stop loss limit has been reached.");
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
    resolveProposal({
      proposal: { id: "proposal-paused", ask_price: 1 },
      subscription: { id: "proposal-stream-paused" },
    });
    await until(() => onStop.mock.calls.length > 0);

    expect(socket.requests.some((request) => "buy" in request)).toBe(false);
    expect(onStop).toHaveBeenCalledWith("Bot paused before the contract was placed.");
    expect(bot.isBusy).toBe(false);
  });
});
