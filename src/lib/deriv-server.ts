import {
  DERIV_API_BASE_URL,
  DERIV_APP_ID,
  getRedirectUri,
  type DerivAccount,
} from "@/lib/deriv-shared";

export const DERIV_SESSION_COOKIE = "__Host-deriv_session";
const NO_STORE = {
  "cache-control": "no-store, private",
  "content-type": "application/json; charset=utf-8",
};

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

export class DerivRequestError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "DerivRequestError";
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

async function responseJson(response: Response): Promise<JsonRecord> {
  const value: unknown = await response.json().catch(() => null);
  return asRecord(value) ?? {};
}

function remoteError(payload: JsonRecord, fallback: string): string {
  const first = Array.isArray(payload["errors"]) ? asRecord(payload["errors"][0]) : null;
  const error =
    typeof payload["error_description"] === "string" ? payload["error_description"] : null;
  const message = typeof first?.["message"] === "string" ? first["message"] : error;
  return (message ?? fallback).slice(0, 220);
}

function accountList(payload: JsonRecord): unknown[] {
  const data = payload["data"];
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  if (Array.isArray(record?.["accounts"])) return record["accounts"];
  return [];
}

export function normalizeAccounts(payload: JsonRecord): DerivAccount[] {
  return accountList(payload).flatMap((value) => {
    const raw = asRecord(value);
    if (!raw) return [];
    const accountId = raw["account_id"] ?? raw["loginid"] ?? raw["id"];
    const type = String(raw["account_type"] ?? raw["type"] ?? "").toLowerCase();
    if (typeof accountId !== "string" || (type !== "demo" && type !== "real")) return [];
    const currency = typeof raw["currency"] === "string" ? raw["currency"] : "USD";
    const balanceValue = raw["balance"];
    const balance =
      typeof balanceValue === "number" && Number.isFinite(balanceValue) ? balanceValue : null;
    return [{ accountId, accountType: type, currency, balance }];
  });
}

export function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function sessionTokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== DERIV_SESSION_COOKIE) continue;
    try {
      const token = decodeURIComponent(valueParts.join("="));
      return token.length > 0 && token.length < 8192 ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAge: number): string {
  const safeAge = Math.max(0, Math.min(Math.floor(maxAge), 86_400 * 30));
  return `${DERIV_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${safeAge}`;
}

export async function fetchDerivAccounts(
  token: string,
  fetcher: FetchLike = fetch,
): Promise<DerivAccount[]> {
  const response = await fetcher(`${DERIV_API_BASE_URL}/trading/v1/options/accounts`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const payload = await responseJson(response);
  if (!response.ok) {
    throw new DerivRequestError(
      remoteError(payload, "Unable to read Deriv accounts."),
      response.status,
    );
  }
  return normalizeAccounts(payload);
}

export async function exchangeAuthorizationCode(
  input: { code: string; verifier: string; redirectUri: string },
  fetcher: FetchLike = fetch,
): Promise<{ token: string; expiresIn: number; accounts: DerivAccount[] }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: DERIV_APP_ID,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
  });
  const response = await fetcher("https://auth.deriv.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await responseJson(response);
  if (!response.ok || typeof payload["access_token"] !== "string") {
    throw new DerivRequestError(
      remoteError(payload, "Deriv did not accept the sign-in code."),
      response.status || 502,
    );
  }

  const expiresIn =
    typeof payload["expires_in"] === "number"
      ? payload["expires_in"]
      : Number(payload["expires_in"]);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new DerivRequestError("Deriv returned an invalid session lifetime.");
  }
  const accessToken = payload["access_token"];
  if (typeof accessToken !== "string")
    throw new DerivRequestError("Deriv did not return an access token.");
  const accounts = await fetchDerivAccounts(accessToken, fetcher);
  return { token: accessToken, expiresIn, accounts };
}

export async function createAccountOtp(
  token: string,
  accountId: string,
  fetcher: FetchLike = fetch,
): Promise<string> {
  const response = await fetcher(
    `${DERIV_API_BASE_URL}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  const payload = await responseJson(response);
  if (!response.ok) {
    throw new DerivRequestError(
      remoteError(payload, "Could not prepare a Deriv trading connection."),
      response.status,
    );
  }
  const data = asRecord(payload["data"]);
  const url = typeof data?.["url"] === "string" ? data["url"] : "";
  if (!/^wss:\/\/api\.derivws\.com\/trading\/v1\/options\/ws\/(demo|real)\?otp=/.test(url)) {
    throw new DerivRequestError("Deriv returned an invalid trading connection URL.");
  }
  return url;
}

export function sessionRouteResponse(accounts: DerivAccount[]): Response {
  return Response.json({ accounts }, { headers: NO_STORE });
}

export function apiErrorResponse(error: unknown): Response {
  const message =
    error instanceof DerivRequestError
      ? error.message
      : "Deriv could not complete this request. Please try again.";
  const status = error instanceof DerivRequestError ? error.status : 502;
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

export function noStoreHeaders(): HeadersInit {
  return NO_STORE;
}

export function expectedRedirectUri(request: Request): string {
  return getRedirectUri(request.url);
}

export function isValidAccountId(accountId: unknown): accountId is string {
  return typeof accountId === "string" && /^[A-Za-z0-9_-]{3,50}$/.test(accountId);
}

export function isValidCodeExchangeBody(
  value: unknown,
): value is { code: string; verifier: string; redirectUri: string } {
  const body = asRecord(value);
  return (
    !!body &&
    typeof body["code"] === "string" &&
    body["code"].length > 0 &&
    body["code"].length < 4096 &&
    typeof body["verifier"] === "string" &&
    body["verifier"].length >= 43 &&
    body["verifier"].length <= 128 &&
    typeof body["redirectUri"] === "string"
  );
}
