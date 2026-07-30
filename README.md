# BTC Up/Down

Guess whether BTC/USD will be higher or lower one minute from now. +1 if you are right,
-1 if you are wrong, one guess at a time.

**Status:** work in progress. The design is settled before the implementation:
[docs/api.md](docs/api.md) is the API contract — endpoints, error codes, the resolution
rule, and the DynamoDB data model, with the reasoning behind each. Setup, deployment and
tradeoffs land here as the app is built.

## The rules

- A guess resolves only when **both** conditions hold: at least 60 seconds have passed
  since the guess, **and** the price has changed. A flat market keeps the guess open.
- The client sends a direction and nothing else. The server records the price and the time
  from its own third-party price observation, and the server decides the outcome.
- Score and any pending guess live in the backend, so closing the browser and coming back
  resumes exactly where you left off.
