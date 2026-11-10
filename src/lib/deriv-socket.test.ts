import { afterEach, describe, expect, it, vi } from "vitest";

import { DerivSocketClient } from "@/lib/deriv-socket";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static latest: FakeWebSocket | null = null;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: Array<Record<string, unknown>> = [];

  constructor(_url: string) {
    super();
    FakeWebSocket.latest = this;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(raw: string) {
    const message = JSON.parse(raw) as Record<string, unknown>;
    this.sent.push(message);
    if (message["proposal_open_contract"] === 1) {
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              msg_type: "proposal_open_contract",
              req_id: message["req_id"],
              proposal_open_contract: {
                contract_id: message["contract_id"],
                is_sold: 0,
                status: "open",
              },
              subscription: { id: "contract-stream" },
            }),
          }),
        );
      });
    }
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  emit(raw: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(raw) }));
  }
}

describe("Deriv WebSocket contract monitoring", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.latest = null;
  });

  it("sends an integer contract ID and forwards the final contract update", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new DerivSocketClient("wss://deriv.example/test");
    await client.connect();
    const onUpdate = vi.fn();
    const onError = vi.fn();

    client.watchContract("123456789", onUpdate, onError);
    await vi.waitFor(() => expect(FakeWebSocket.latest?.sent).toHaveLength(1));
    expect(FakeWebSocket.latest?.sent[0]).toMatchObject({
      proposal_open_contract: 1,
      contract_id: 123456789,
      subscribe: 1,
    });
    expect(typeof FakeWebSocket.latest?.sent[0]?.["contract_id"]).toBe("number");

    FakeWebSocket.latest?.emit({
      msg_type: "proposal_open_contract",
      proposal_open_contract: {
        contract_id: 123456789,
        is_sold: 1,
        status: "won",
        profit: "0.82",
      },
    });
    expect(onUpdate).toHaveBeenLastCalledWith({
      contract_id: 123456789,
      is_sold: 1,
      status: "won",
      profit: "0.82",
    });
    expect(onError).not.toHaveBeenCalled();
    client.close();
  });

  it("rejects invalid contract IDs before sending an API request", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new DerivSocketClient("wss://deriv.example/test");
    await client.connect();
    const onError = vi.fn();

    client.watchContract("not-a-number", vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("invalid contract") }),
    );
    expect(FakeWebSocket.latest?.sent).toHaveLength(0);
    client.close();
  });
});
