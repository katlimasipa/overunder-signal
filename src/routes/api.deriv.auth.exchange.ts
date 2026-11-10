import { createFileRoute } from "@tanstack/react-router";

import {
  apiErrorResponse,
  exchangeAuthorizationCode,
  expectedRedirectUri,
  isValidCodeExchangeBody,
  noStoreHeaders,
  requestIsSameOrigin,
  sessionCookie,
} from "@/lib/deriv-server";

export const Route = createFileRoute("/api/deriv/auth/exchange")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!requestIsSameOrigin(request)) {
          return Response.json(
            { error: "This sign-in request could not be verified." },
            { status: 403, headers: noStoreHeaders() },
          );
        }

        const value: unknown = await request.json().catch(() => null);
        if (!isValidCodeExchangeBody(value) || value.redirectUri !== expectedRedirectUri(request)) {
          return Response.json(
            { error: "The Deriv sign-in response was incomplete. Please try again." },
            { status: 400, headers: noStoreHeaders() },
          );
        }

        try {
          const result = await exchangeAuthorizationCode(value);
          return Response.json(
            { accounts: result.accounts },
            {
              headers: {
                ...noStoreHeaders(),
                "set-cookie": sessionCookie(result.token, result.expiresIn),
              },
            },
          );
        } catch (error) {
          const response = apiErrorResponse(error);
          if (response.status === 401) response.headers.append("set-cookie", sessionCookie("", 0));
          return response;
        }
      },
    },
  },
});
