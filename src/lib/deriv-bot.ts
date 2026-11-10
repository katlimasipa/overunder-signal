import type { DerivMessage, DerivSocketClient, DerivTick } from "@/lib/deriv-socket";
import {
  isContractSettled,
  lastDigit,
  signalForDigit,
  stakeForLossStreak,
  tradeResult,
  type StrategyTrade,
} from "@/lib/over-under-strategy";

export interface BotOptions {
  symbol: string;
  currency: string;
  duration: number;
  baseStake: number;
  recoveryMultiplier: number;
  takeProfit: number | null;
  stopLoss: number | null;
  initialPnl?: number;
  initialLossStreak?: number;
}

export interface BotCallbacks {
  onTrade: (trade: StrategyTrade) => void;
  onPnl: (profit: number, lossStreak: number) => void;
  onStop: (reason: string) => void;
  onError: (error: Error) => void;
}

type BotSocket = Pick<
  DerivSocketClient,
  "forget" | "request" | "onClose" | "onTick" | "subscribeTicks" | "watchContract"
>;

export class DerivBot {
  private active = false;
  private busy = false;
  private sequence = 0;
  private pnl: number;
  private lossStreak: number;
  private lastEpoch: number | null = null;
  private removeTickListener: (() => void) | null = null;
  private removeCloseListener: (() => void) | null = null;
  private forgetTicks: (() => void) | null = null;
  private unwatchContract: (() => void) | null = null;
  private openContractId: string | null = null;

  constructor(
    private readonly socket: BotSocket,
    private readonly options: BotOptions,
    private readonly callbacks: BotCallbacks,
  ) {
    this.pnl = options.initialPnl ?? 0;
    this.lossStreak = options.initialLossStreak ?? 0;
  }

  get isActive(): boolean {
    return this.active;
  }

  get isBusy(): boolean {
    return this.busy || this.openContractId !== null;
  }

  get hasOpenContract(): boolean {
    return this.openContractId !== null;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.removeTickListener = this.socket.onTick((tick) => this.handleTick(tick));
    this.removeCloseListener = this.socket.onClose((reason) => {
      if (!this.active) return;
      this.pause();
      this.callbacks.onError(new Error(reason || "Deriv connection closed."));
    });
    try {
      const forget = await this.socket.subscribeTicks(this.options.symbol);
      if (this.active) this.forgetTicks = forget;
      else forget();
    } catch (error) {
      this.pause();
      throw error;
    }
  }

  pause(): void {
    this.active = false;
    this.removeTickListener?.();
    this.removeTickListener = null;
    this.removeCloseListener?.();
    this.removeCloseListener = null;
    this.forgetTicks?.();
    this.forgetTicks = null;
  }

  private handleTick(tick: DerivTick): void {
    if (!this.active || this.busy || tick.epoch === this.lastEpoch) return;
    this.lastEpoch = tick.epoch;
    const digit = lastDigit(tick.quote, tick.pip_size ?? 2);
    if (digit === null) return;
    const signal = signalForDigit(digit, this.lossStreak);
    if (!signal) return;

    const stake = stakeForLossStreak(
      this.options.baseStake,
      this.options.recoveryMultiplier,
      this.lossStreak,
    );
    if (this.options.stopLoss !== null && this.pnl - stake < -this.options.stopLoss) {
      this.pause();
      this.callbacks.onStop("The next recovery stake would exceed your stop loss.");
      return;
    }
    if (this.options.takeProfit !== null && this.pnl >= this.options.takeProfit) {
      this.pause();
      this.callbacks.onStop("Your take profit limit has been reached.");
      return;
    }

    this.busy = true;
    void this.placeTrade(
      tick,
      digit,
      signal.contractType,
      signal.barrier,
      signal.label,
      stake,
    ).catch((error: unknown) => {
      this.busy = false;
      this.pause();
      this.callbacks.onError(
        error instanceof Error ? error : new Error("The Deriv trade could not be completed."),
      );
    });
  }

  private async placeTrade(
    tick: DerivTick,
    digit: number,
    contractType: "DIGITOVER" | "DIGITUNDER",
    barrier: "1" | "8",
    label: string,
    stake: number,
  ): Promise<void> {
    const proposalResponse = await this.socket.request({
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type: contractType,
      currency: this.options.currency,
      duration: this.options.duration,
      duration_unit: "t",
      underlying_symbol: this.options.symbol,
      barrier,
      subscribe: 1,
    });
    const proposalId = proposalResponse.proposal?.id;
    const askPrice = Number(proposalResponse.proposal?.ask_price);
    if (
      typeof proposalId !== "string" ||
      !Number.isFinite(askPrice) ||
      askPrice <= 0 ||
      !proposalResponse.subscription?.id
    ) {
      this.socket.forget(proposalResponse.subscription?.id);
      throw new Error("Deriv did not return a valid contract price.");
    }

    if (!this.active) {
      this.socket.forget(proposalResponse.subscription.id);
      this.busy = false;
      this.callbacks.onStop("Bot paused before the contract was placed.");
      return;
    }

    let buyResponse: DerivMessage;
    try {
      buyResponse = await this.socket.request({ buy: proposalId, price: askPrice });
    } finally {
      this.socket.forget(proposalResponse.subscription.id);
    }
    const contractId = buyResponse.buy?.contract_id;
    if (contractId === undefined || contractId === null)
      throw new Error("Deriv did not confirm the contract purchase.");
    const numericContractId = Number(contractId);
    if (!Number.isSafeInteger(numericContractId) || numericContractId <= 0)
      throw new Error("Deriv returned an invalid contract number.");
    this.openContractId = String(numericContractId);

    const id = `trade-${Date.now()}-${++this.sequence}`;
    const trade: StrategyTrade = {
      id,
      time: new Date(tick.epoch * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      entryDigit: digit,
      exitDigit: "—",
      contract: label,
      stake,
      status: "Open",
      profit: null,
    };
    this.callbacks.onTrade(trade);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (contract: Record<string, unknown>) => {
        if (settled || !isContractSettled(contract)) return;
        settled = true;
        this.unwatchContract?.();
        this.unwatchContract = null;
        this.openContractId = null;
        const profit = Number(contract["profit"]);
        const resolvedProfit = Number.isFinite(profit) ? profit : 0;
        const status = tradeResult(resolvedProfit);
        this.pnl = Math.round((this.pnl + resolvedProfit) * 100) / 100;
        this.lossStreak = status === "Lost" ? this.lossStreak + 1 : 0;
        const exitTick =
          contract["exit_spot"] ?? contract["exit_tick_display_value"] ?? contract["exit_tick"];
        const exitDigit =
          exitTick === undefined || exitTick === null
            ? "—"
            : (String(exitTick).replace(/\D/g, "").at(-1) ?? "—");
        this.callbacks.onTrade({
          ...trade,
          exitDigit,
          status,
          profit: resolvedProfit,
        });
        this.busy = false;
        this.callbacks.onPnl(this.pnl, this.lossStreak);
        if (this.options.takeProfit !== null && this.pnl >= this.options.takeProfit) {
          this.pause();
          this.callbacks.onStop("Your take profit limit has been reached.");
        } else if (this.options.stopLoss !== null && this.pnl <= -this.options.stopLoss) {
          this.pause();
          this.callbacks.onStop("Your stop loss limit has been reached.");
        }
        resolve();
      };

      this.unwatchContract = this.socket.watchContract(numericContractId, finish, (error) => {
        if (settled) return;
        settled = true;
        this.unwatchContract?.();
        this.unwatchContract = null;
        reject(error);
      });
    });
  }
}
