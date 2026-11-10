export const DERIV_APP_ID = "34VjYrOHXYAORMwyfHSoL";
export const DERIV_CALLBACK_PATH = "/auth/callback";
export const DERIV_PUBLIC_WS_URL = "wss://api.derivws.com/trading/v1/options/ws/public";
export const DERIV_API_BASE_URL = "https://api.derivws.com";

export const DERIV_MARKETS = [
  { label: "Volatility 10 (1s)", symbol: "1HZ10V" },
  { label: "Volatility 25 (1s)", symbol: "1HZ25V" },
  { label: "Volatility 50 (1s)", symbol: "1HZ50V" },
  { label: "Volatility 75 (1s)", symbol: "1HZ75V" },
  { label: "Volatility 100 (1s)", symbol: "1HZ100V" },
  { label: "Volatility 10", symbol: "R_10" },
  { label: "Volatility 25", symbol: "R_25" },
  { label: "Volatility 50", symbol: "R_50" },
  { label: "Volatility 75", symbol: "R_75" },
  { label: "Volatility 100", symbol: "R_100" },
] as const;

export type DerivMarket = (typeof DERIV_MARKETS)[number];

export interface DerivAccount {
  accountId: string;
  accountType: "demo" | "real";
  currency: string;
  balance: number | null;
}

export function getRedirectUri(origin: string): string {
  return new URL(DERIV_CALLBACK_PATH, origin).toString();
}
