# BTC Up/Down

Guess whether BTC/USD will be higher or lower one minute from now. +1 if you are right,
-1 if you are wrong, one guess at a time.

**Live:** https://main.d1ladzr322rz9f.amplifyapp.com

**Status:** work in progress. The design is settled before the implementation:
[docs/api.md](docs/api.md) is the API contract — endpoints, error codes, the resolution
rule, and the DynamoDB data model, with the reasoning behind each. Setup, deployment and
tradeoffs land here as the app is built.

## Run locally

Requires Node 20 or newer. No API keys and no AWS account are needed for the price
display; the Coinbase endpoint the app uses is public.

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Useful checks:

```bash
curl -s localhost:3000/api/price   # {"symbol":"BTC-USD","price":…,"asOf":…}
npm run typecheck
npm run build
```

## Deploy

Hosting is AWS Amplify, which builds and runs the Next.js app (including its API routes)
straight from this repository.

1. In the Amplify console: **Create new app** → **GitHub** → pick this repo and the `main`
   branch.
2. Amplify detects Next.js and offers a build spec. This repo already contains
   [amplify.yml](amplify.yml), which is used as-is; the build runs `npm ci` and
   `npm run build` on Node 20.
3. Save and deploy. Every push to `main` redeploys.

Amplify decides at app-creation time whether an app is static hosting or SSR compute,
based on the framework it detects in the connected branch. Connect the repo only when the
Next.js app is actually on `main` — otherwise Amplify provisions plain static hosting, the
build still succeeds, and every route answers `404` from S3.

## The rules

- A guess resolves only when **both** conditions hold: at least 60 seconds have passed
  since the guess, **and** the price has changed. A flat market keeps the guess open.
- The client sends a direction and nothing else. The server records the price and the time
  from its own third-party price observation, and the server decides the outcome.
- Score and any pending guess live in the backend, so closing the browser and coming back
  resumes exactly where you left off.
