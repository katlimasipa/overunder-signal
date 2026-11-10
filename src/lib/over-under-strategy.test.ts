import { describe, expect, it } from "vitest";

import {
  isContractSettled,
  lastDigit,
  signalForDigit,
  stakeForLossStreak,
  tradeResult,
} from "@/lib/over-under-strategy";

describe("Over / Under strategy", () => {
  it("reads the final displayed decimal digit using the market precision", () => {
    expect(lastDigit(4.551, 3)).toBe(1);
    expect(lastDigit("4.840", 3)).toBe(0);
    expect(lastDigit("invalid", 3)).toBeNull();
  });

  it("enters Over 1 only when the last digit is zero or one", () => {
    expect(signalForDigit(0, 0)).toEqual({
      contractType: "DIGITOVER",
      barrier: "1",
      label: "Over 1",
    });
    expect(signalForDigit(1, 0)?.label).toBe("Over 1");
    expect(signalForDigit(2, 0)).toBeNull();
  });

  it("uses Under 8 after a loss, then returns to regular analysis after a win", () => {
    expect(signalForDigit(4, 1)).toEqual({
      contractType: "DIGITUNDER",
      barrier: "8",
      label: "Under 8",
    });
    expect(signalForDigit(0, 2)?.label).toBe("Under 8");
    expect(signalForDigit(1, 0)?.label).toBe("Over 1");
  });

  it("applies the selected multiplier once per consecutive loss", () => {
    expect(stakeForLossStreak(1, 1.5, 0)).toBe(1);
    expect(stakeForLossStreak(1, 1.5, 1)).toBe(1.5);
    expect(stakeForLossStreak(1, 1.5, 2)).toBe(2.25);
  });

  it("recognizes final contracts and classifies their result", () => {
    expect(isContractSettled({ is_sold: 1 })).toBe(true);
    expect(isContractSettled({ status: "open" })).toBe(false);
    expect(tradeResult(0.82)).toBe("Won");
    expect(tradeResult(-1)).toBe("Lost");
    expect(tradeResult(0)).toBe("Even");
  });
});
