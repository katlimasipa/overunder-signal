import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { exchangeDerivCode, takeDerivOAuthContext } from "@/lib/deriv-oauth";

export function DerivCallback() {
  const [message, setMessage] = useState("Completing secure Deriv sign-in…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const providerError = params.get("error_description") || params.get("error");
    window.history.replaceState(null, "", "/");

    const { state, verifier } = takeDerivOAuthContext();
    if (providerError) {
      setMessage(providerError.slice(0, 180));
      setFailed(true);
      return;
    }
    if (!code || !returnedState || !state || returnedState !== state || !verifier) {
      setMessage("Deriv sign-in could not be verified. Please start again.");
      setFailed(true);
      return;
    }

    void exchangeDerivCode(code, verifier)
      .then(() => window.location.replace("/"))
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : "Deriv sign-in could not be completed.",
        );
        setFailed(true);
      });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <section className="w-full max-w-md rounded-lg border border-border bg-card p-7 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">OverUnderAuto</p>
        <h1 className="mt-3 text-xl font-bold">
          {failed ? "Deriv connection stopped" : "Connecting your account"}
        </h1>
        <p role="status" className="mt-2 text-sm leading-6 text-muted-foreground">
          {message}
        </p>
        {failed && (
          <Button className="mt-5" onClick={() => window.location.replace("/")}>
            Return to workspace
          </Button>
        )}
      </section>
    </main>
  );
}
