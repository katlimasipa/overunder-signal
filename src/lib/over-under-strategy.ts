export interface StrategySignal {
  contractType: "DIGITOVER" | "DIGITUNDER";
  barrier: "1" | "8";
  label: "Over 1" | "Under 8";
}

export interface StrategyTrade {
  id: string;
  time: string;
  entryDigit: number;
  exitDigit: string;
  contract: string;
  stake: number;
  currency?: string;
  status: "Open" | "Won" | "Lost" | "Even";
  profit: number | null;
}

export function lastDigit(quote: number | string, pipSize = 2): number | null {
  const numericQuote = Number(quote);
  if (!Number.isFinite(numericQuote) || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 12)
    return null;
  const formatted = numericQuote.toFixed(pipSize);
  const digit = Number(formatted.at(-1));
  return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : null;
}

export function signalForDigit(digit: number, recoveryLosses: number): StrategySignal | null {
  if (recoveryLosses > 0) return { contractType: "DIGITUNDER", barrier: "8", label: "Under 8" };
  if (digit === 0 || digit === 1)
    return { contractType: "DIGITOVER", barrier: "1", label: "Over 1" };
  return null;
}

export function stakeForLossStreak(
  baseStake: number,
  multiplier: number,
  lossStreak: number,
): number {
  return Math.round(baseStake * multiplier ** Math.max(0, lossStreak) * 100) / 100;
}

export function isContractSettled(contract: Record<string, unknown>): boolean {
  const status = String(contract["status"] ?? contract["contract_status"] ?? "").toLowerCase();
  const isSold =
    contract["is_sold"] === true ||
    contract["is_sold"] === 1 ||
    contract["is_sold"] === "1" ||
    contract["is_sold"] === "true";
  const isExpired =
    contract["is_expired"] === true ||
    contract["is_expired"] === 1 ||
    contract["is_expired"] === "1";
  return (
    isSold ||
    isExpired ||
    status === "sold" ||
    status === "won" ||
    status === "lost" ||
    status === "expired" ||
    status === "cancelled"
  );
}

export function tradeResult(profitValue: unknown): StrategyTrade["status"] {
  const profit = Number(profitValue);
  if (!Number.isFinite(profit) || profit === 0) return "Even";
  return profit > 0 ? "Won" : "Lost";
}
