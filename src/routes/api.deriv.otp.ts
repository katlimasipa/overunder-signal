import { createFileRoute } from "@tanstack/react-router";

import {
  apiErrorResponse,
  createAccountOtp,
  isValidAccountId,
  noStoreHeaders,
  requestIsSameOrigin,
  sessionCookie,
  sessionTokenFromRequest,
} from "@/lib/deriv-server";

export const Route = createFileRoute("/api/deriv/otp")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!requestIsSameOrigin(request)) {
          return Response.json(
            { error: "This connection request could not be verified." },
            { status: 403, headers: noStoreHeaders() },
          );
        }
        const token = sessionTokenFromRequest(request);
        if (!token)
          return Response.json(
            { error: "Connect your Deriv account first." },
            { status: 401, headers: noStoreHeaders() },
          );

        const value: unknown = await request.json().catch(() => null);
        const accountId =
          value && typeof value === "object" && "accountId" in value ? value.accountId : null;
        if (!isValidAccountId(accountId)) {
          return Response.json(
            { error: "Choose a valid Deriv account." },
            { status: 400, headers: noStoreHeaders() },
          );
        }

        try {
          const url = await createAccountOtp(token, accountId);
          return Response.json({ url }, { headers: noStoreHeaders() });
        } catch (error) {
          const response = apiErrorResponse(error);
          if (response.status === 401) response.headers.append("set-cookie", sessionCookie("", 0));
          return response;
        }
      },
    },
  },
});
