import { describe, expect, it } from "vitest";

import {
  createAccountOtp,
  exchangeAuthorizationCode,
  expectedRedirectUri,
  isValidCodeExchangeBody,
  normalizeAccounts,
  requestIsSameOrigin,
  sessionCookie,
  sessionTokenFromRequest,
} from "@/lib/deriv-server";

describe("Deriv server helpers", () => {
  it("normalizes Deriv demo and real accounts without exposing other fields", () => {
    expect(
      normalizeAccounts({
        data: [
          {
            account_id: "VRTC1234",
            account_type: "demo",
            currency: "USD",
            balance: 10000,
            extra: "hidden",
          },
          { account_id: "CR123456", account_type: "real", currency: "EUR", balance: 8.5 },
          { account_id: "invalid", account_type: "wallet" },
        ],
      }),
    ).toEqual([
      { accountId: "VRTC1234", accountType: "demo", currency: "USD", balance: 10000 },
      { accountId: "CR123456", accountType: "real", currency: "EUR", balance: 8.5 },
    ]);
  });

  it("sets a host-only secure HTTP-only session cookie and reads it from requests", () => {
    const cookie = sessionCookie("access.token", 1200);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    const request = new Request("https://overunderauto.vercel.app/api/deriv/session", {
      headers: { cookie: `${cookie.split(";")[0]}` },
    });
    expect(sessionTokenFromRequest(request)).toBe("access.token");
  });

  it("validates same-origin requests and the exact OAuth callback", () => {
    const validRequest = new Request("https://overunderauto.vercel.app/api/deriv/auth/exchange", {
      method: "POST",
      headers: { origin: "https://overunderauto.vercel.app" },
    });
    const invalidRequest = new Request("https://overunderauto.vercel.app/api/deriv/auth/exchange", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(requestIsSameOrigin(validRequest)).toBe(true);
    expect(requestIsSameOrigin(invalidRequest)).toBe(false);
    expect(expectedRedirectUri(validRequest)).toBe("https://overunderauto.vercel.app");
    expect(
      isValidCodeExchangeBody({
        code: "abc",
        verifier: "v".repeat(43),
        redirectUri: "https://example.com",
      }),
    ).toBe(true);
    expect(
      isValidCodeExchangeBody({
        code: "abc",
        verifier: "short",
        redirectUri: "https://example.com",
      }),
    ).toBe(false);
  });

  it("exchanges the code on the server and returns normalized accounts", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(init ? { url, init } : { url });
      if (url.includes("oauth2/token")) {
        return Response.json({ access_token: "private-token", expires_in: 900 });
      }
      return Response.json({
        data: [{ account_id: "VRTC1234", account_type: "demo", currency: "USD", balance: 10000 }],
      });
    };

    const result = await exchangeAuthorizationCode(
      {
        code: "one-time-code",
        verifier: "v".repeat(43),
        redirectUri: "https://overunderauto.vercel.app",
      },
      fetcher,
    );

    expect(result.token).toBe("private-token");
    expect(result.expiresIn).toBe(900);
    expect(result.accounts[0]?.accountId).toBe("VRTC1234");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://auth.deriv.com/oauth2/token");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(calls[1]?.init?.headers).toEqual({ authorization: "Bearer private-token" });
  });

  it("accepts only a Deriv demo or real WebSocket OTP URL", async () => {
    const validFetcher: typeof fetch = async () =>
      Response.json({
        data: { url: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=one-time" },
      });
    const invalidFetcher: typeof fetch = async () =>
      Response.json({ data: { url: "wss://attacker.example/socket" } });
    await expect(createAccountOtp("token", "VRTC1234", validFetcher)).resolves.toContain(
      "otp=one-time",
    );
    await expect(createAccountOtp("token", "VRTC1234", invalidFetcher)).rejects.toThrow(
      "invalid trading connection URL",
    );
  });
});
