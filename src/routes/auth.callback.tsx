import { createFileRoute } from "@tanstack/react-router";

import { DerivCallback } from "@/components/deriv-callback";

export const Route = createFileRoute("/auth/callback")({ component: DerivCallback });
