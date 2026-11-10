import { DERIV_APP_ID, getRedirectUri } from "@/lib/deriv-shared";

const OAUTH_STATE_KEY = "overunder.deriv.oauth.state";
const PKCE_VERIFIER_KEY = "overunder.deriv.oauth.verifier";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function createDerivAuthorizationUrl(
  intent: "login" | "signup",
  origin: string,
): Promise<string> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = await createPkceChallenge(verifier);
  const redirectUri = getRedirectUri(origin);
  const url = new URL("https://auth.deriv.com/oauth2/auth");

  url.search = new URLSearchParams({
    response_type: "code",
    client_id: DERIV_APP_ID,
    redirect_uri: redirectUri,
    scope: "trade",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(intent === "signup" ? { prompt: "registration" } : {}),
  }).toString();

  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  return url.toString();
}

export function takeDerivOAuthContext(): { state: string | null; verifier: string | null } {
  const state = sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  return { state, verifier };
}

export async function exchangeDerivCode(code: string, verifier: string): Promise<void> {
  const response = await fetch("/api/deriv/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ code, verifier, redirectUri: getRedirectUri(window.location.origin) }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Deriv sign-in could not be completed. Please try again.");
  }
}
