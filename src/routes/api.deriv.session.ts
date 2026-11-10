import { createFileRoute } from "@tanstack/react-router";

import {
  apiErrorResponse,
  fetchDerivAccounts,
  noStoreHeaders,
  requestIsSameOrigin,
  sessionCookie,
  sessionRouteResponse,
  sessionTokenFromRequest,
} from "@/lib/deriv-server";

export const Route = createFileRoute("/api/deriv/session")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = sessionTokenFromRequest(request);
        if (!token) return sessionRouteResponse([]);
        try {
          return sessionRouteResponse(await fetchDerivAccounts(token));
        } catch (error) {
          const response = apiErrorResponse(error);
          if (response.status === 401) response.headers.append("set-cookie", sessionCookie("", 0));
          return response;
        }
      },
      POST: async ({ request }) => {
        if (!requestIsSameOrigin(request)) {
          return Response.json(
            { error: "This sign-out request could not be verified." },
            { status: 403, headers: noStoreHeaders() },
          );
        }
        return Response.json(
          { ok: true },
          { headers: { ...noStoreHeaders(), "set-cookie": sessionCookie("", 0) } },
        );
      },
    },
  },
});
