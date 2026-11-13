import { DERIV_PUBLIC_WS_URL } from "@/lib/deriv-shared";

export interface DerivTick {
  quote: number | string;
  epoch: number;
  pip_size?: number;
  symbol?: string;
}

export interface DerivBalance {
  balance?: number | string;
  currency?: string;
}

export interface DerivMessage {
  msg_type?: string;
  req_id?: number;
  error?: { code?: string; message?: string };
  tick?: DerivTick;
  balance?: DerivBalance;
  history?: { prices?: Array<number | string>; times?: number[] };
  proposal?: { id?: string; ask_price?: number | string; payout?: number | string };
  buy?: { contract_id?: number | string; buy_price?: number | string };
  proposal_open_contract?: Record<string, unknown>;
  subscription?: { id?: string };
  [key: string]: unknown;
}

type PendingRequest = {
  resolve: (message: DerivMessage) => void;
  reject: (error: Error) => void;
  timeout: number;
};

type ContractUpdateHandler = (contract: Record<string, unknown>) => void;

export class DerivSocketClient {
  private socket: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private requestId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly tickHandlers = new Set<(tick: DerivTick) => void>();
  private readonly balanceHandlers = new Set<(balance: DerivBalance) => void>();
  private readonly closeHandlers = new Set<(reason: string) => void>();
  private readonly contractHandlers = new Map<string, Set<ContractUpdateHandler>>();
  private readonly defaultUrl: string;

  constructor(url = DERIV_PUBLIC_WS_URL) {
    this.defaultUrl = url;
  }

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.opening) return this.opening;

    this.opening = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.defaultUrl);
      this.socket = socket;
      const timer = window.setTimeout(() => {
        socket.close();
        reject(
          new Error("Deriv connection timed out. Check your internet connection and try again."),
        );
      }, 12_000);

      socket.addEventListener(
        "open",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          reject(new Error("Could not connect to Deriv. Please try again."));
        },
        { once: true },
      );
      socket.addEventListener("message", (event) => this.handleMessage(event.data));
      socket.addEventListener("close", (event) => {
        window.clearTimeout(timer);
        this.opening = null;
        this.socket = null;
        const reason = event.reason || "The Deriv connection closed.";
        this.rejectPending(new Error(reason));
        for (const handler of this.closeHandlers) handler(reason);
      });
    }).finally(() => {
      this.opening = null;
    });

    return this.opening;
  }

  onTick(handler: (tick: DerivTick) => void): () => void {
    this.tickHandlers.add(handler);
    return () => this.tickHandlers.delete(handler);
  }

  onBalance(handler: (balance: DerivBalance) => void): () => void {
    this.balanceHandlers.add(handler);
    return () => this.balanceHandlers.delete(handler);
  }

  onClose(handler: (reason: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  async request(payload: Record<string, unknown>, timeoutMs = 12_000): Promise<DerivMessage> {
    await this.connect();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new Error("Deriv connection is not open.");

    const reqId = ++this.requestId;
    return new Promise<DerivMessage>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("Deriv did not answer in time. Please try again."));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timeout });
      try {
        socket.send(JSON.stringify({ ...payload, req_id: reqId }));
      } catch (error) {
        window.clearTimeout(timeout);
        this.pending.delete(reqId);
        reject(error instanceof Error ? error : new Error("Could not send the Deriv request."));
      }
    });
  }

  async subscribeTicks(symbol: string): Promise<() => void> {
    const response = await this.request({ ticks: symbol, subscribe: 1 });
    const subscriptionId = response.subscription?.id;
    return () => {
      if (subscriptionId) this.sendForget(subscriptionId);
    };
  }

  watchContract(
    contractId: string | number,
    onUpdate: ContractUpdateHandler,
    onError: (error: Error) => void,
  ): () => void {
    const numericContractId = Number(contractId);
    if (!Number.isSafeInteger(numericContractId) || numericContractId <= 0) {
      onError(new Error("Deriv returned an invalid contract number."));
      return () => {};
    }
    const contractKey = String(numericContractId);
    let handlers = this.contractHandlers.get(contractKey);
    if (!handlers) {
      handlers = new Set();
      this.contractHandlers.set(contractKey, handlers);
    }
    handlers.add(onUpdate);
    let subscriptionId: string | undefined;
    let removed = false;
    void this.request({
      proposal_open_contract: 1,
      contract_id: numericContractId,
      subscribe: 1,
    })
      .then((response) => {
        subscriptionId = response.subscription?.id;
        if (removed && subscriptionId) this.sendForget(subscriptionId);
      })
      .catch((error: unknown) =>
        onError(
          error instanceof Error ? error : new Error("Could not monitor the Deriv contract."),
        ),
      );

    return () => {
      removed = true;
      handlers?.delete(onUpdate);
      if (handlers?.size === 0) this.contractHandlers.delete(contractKey);
      if (subscriptionId) this.sendForget(subscriptionId);
    };
  }

  forget(subscriptionId: string | undefined): void {
    if (subscriptionId) this.sendForget(subscriptionId);
  }

  close(): void {
    this.socket?.close(1000, "Session ended");
    this.socket = null;
    this.opening = null;
    this.rejectPending(new Error("Deriv connection closed."));
  }

  private sendForget(subscriptionId: string): void {
    const socket = this.socket;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ forget: subscriptionId, req_id: ++this.requestId }));
    }
  }

  private handleMessage(raw: unknown): void {
    let message: DerivMessage;
    try {
      message = JSON.parse(String(raw)) as DerivMessage;
    } catch {
      return;
    }

    if (message.msg_type === "tick" && message.tick) {
      for (const handler of this.tickHandlers) handler(message.tick);
    }

    if (message.msg_type === "balance" && message.balance) {
      for (const handler of this.balanceHandlers) handler(message.balance);
    }

    if (message.msg_type === "proposal_open_contract" && message.proposal_open_contract) {
      const id = String(message.proposal_open_contract["contract_id"] ?? "");
      for (const handler of this.contractHandlers.get(id) ?? [])
        handler(message.proposal_open_contract);
    }

    if (typeof message.req_id !== "number") return;
    const pending = this.pending.get(message.req_id);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(message.req_id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "Deriv rejected the request."));
    } else {
      pending.resolve(message);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function createPublicDerivSocket(): DerivSocketClient {
  return new DerivSocketClient();
}
