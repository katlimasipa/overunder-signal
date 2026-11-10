# OverUnderAuto

OverUnderAuto is a Deriv digit strategy workspace. It streams live market quotes, connects through Deriv OAuth 2.0, and can run the configured Over/Under strategy on a selected Deriv account.

## Deriv OAuth setup

The public Deriv app ID is configured in `src/lib/deriv-shared.ts`. The OAuth application must be registered as an OAuth 2.0 application with the `trade` scope enabled.

Add this exact redirect URL to the allowed redirect URLs in the Deriv developer dashboard:

```text
https://overunderauto.vercel.app
```

Deriv's OAuth application has the site root registered, so the redirect must match exactly and must not include a trailing slash or an extra path. For local development, add the exact local origin shown by the development server as a second allowed redirect URL.

Deriv hosts the sign-in and registration screens. The app uses Authorization Code with PKCE, exchanges the code on the server, and keeps the short-lived access token in a Secure, HTTP-only cookie. The browser never receives the access token. Deriv does not issue refresh tokens, so users reconnect after a session expires.

## Strategy behavior

- The bot waits for a live tick whose last decimal digit is `0` or `1`, then requests an `Over 1` contract.
- After a losing contract, it requests `Under 8` contracts until one wins, then returns to signal analysis.
- The selected recovery multiplier is applied to the stake after each consecutive loss.
- One contract is monitored at a time. Pausing stops new entries and lets an open contract settle.
- Take-profit and stop-loss limits use the session's realized profit/loss. A proposed recovery stake that would exceed the stop-loss limit is skipped.
- Demo accounts are the default selection when available. Starting a real account requires a second confirmation.

The live public market feed works without connecting an account. Trading requires Deriv OAuth and a selected Deriv account.

## Local development

Requirements: Bun and Node.js 22 or newer.

```sh
bun install --frozen-lockfile
bun run dev
```

Run the checks before deploying:

```sh
bun run lint
bun run test
bun run build
```

## Deploy on Vercel

The repository is configured for the Vercel TanStack Start preset and Nitro's Vercel runtime. Import the repository into Vercel with the repository root as the project root and the **TanStack Start** framework preset. Vercel detects the build and output settings from the project configuration. Pushes to the connected production branch trigger deployments.

After the first deployment:

1. Confirm the app loads at `https://overunderauto.vercel.app/`.
2. Confirm the Deriv OAuth application's allowed redirect URL is `https://overunderauto.vercel.app`.
3. Sign in with Deriv, select a demo account, and confirm live quotes before starting the bot.

Trading involves risk. Review the stake, recovery multiplier, take-profit, and stop-loss settings before starting a session.
