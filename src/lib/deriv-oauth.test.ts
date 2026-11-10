import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDerivAuthorizationUrl,
  createPkceChallenge,
  takeDerivOAuthContext,
} from "@/lib/deriv-oauth";
import { DERIV_APP_ID } from "@/lib/deriv-shared";

describe("Deriv OAuth 2.0 PKCE", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    sessionStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates a login URL with PKCE, the app ID, scope, and exact callback", async () => {
    const url = new URL(
      await createDerivAuthorizationUrl("login", "https://overunderauto.vercel.app"),
    );
    const { state, verifier } = takeDerivOAuthContext();

    expect(url.origin).toBe("https://auth.deriv.com");
    expect(url.pathname).toBe("/oauth2/auth");
    expect(url.searchParams.get("client_id")).toBe(DERIV_APP_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://overunderauto.vercel.app/auth/callback",
    );
    expect(url.searchParams.get("scope")).toBe("trade");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await createPkceChallenge(verifier ?? ""));
    expect(url.searchParams.get("state")).toBe(state);
    expect(state).toHaveLength(32);
    expect(verifier).toHaveLength(43);
  });

  it("asks Deriv to show its registration screen for sign-up", async () => {
    const url = new URL(
      await createDerivAuthorizationUrl("signup", "https://overunderauto.vercel.app"),
    );
    expect(url.searchParams.get("prompt")).toBe("registration");
  });
});
