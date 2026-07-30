# BTC Up/Down

Guess whether BTC/USD will be higher or lower one minute from now. +1 if you are right, -1
if you are wrong, one guess at a time.

**Live:** https://main.d1ladzr322rz9f.amplifyapp.com

## What it does

- You always see your score and the latest BTC/USD price, with how old that price is.
- You guess **up** or **down**. While a guess is open you cannot place another.
- A guess resolves when **both** conditions hold: at least 60 seconds have passed **and**
  the price has changed. A flat market keeps the guess open, and the UI says so rather than
  looking stuck.
- Correct is +1, wrong is -1. New players start at 0. Scores can go negative.
- Your score and any pending guess live in the backend. Close the browser, come back, and
  you continue from where you left off — including mid-guess.

The client sends one thing: a direction. It never sends a price or a timestamp. The server
reads the price from Coinbase, records that price with its observation time, and decides the
outcome later. Nothing a modified client, a paused clock, or a replayed request can do
changes the result of a guess.

The API contract — endpoints, error codes, the resolution rule, the DynamoDB data model, and
the reasoning behind each — is in **[docs/api.md](docs/api.md)**. It was written before the
implementation.

## How it works

| Piece | Choice |
| --- | --- |
| App | Next.js (App Router), TypeScript strict. Client-rendered UI, API routes colocated. |
| Data | One DynamoDB table, on-demand, all access behind [`lib/store.ts`](lib/store.ts). |
| Price | Coinbase spot, server-side only, 2-second in-memory cache. |
| Rule | [`lib/resolve-guess.ts`](lib/resolve-guess.ts) — a pure function, unit tested. |
| Hosting | AWS Amplify (Next.js SSR compute). |

The browser polls one endpoint, `GET /api/players/{id}`, which returns score, guess state
and the price snapshot that guess state was evaluated against — so what the player sees is
what the server decided on. That endpoint is also where a due guess resolves; see
[Key decisions](#key-decisions-and-tradeoffs).

## Run locally

Requires Node 20 or newer.

### Without an AWS account

The store has a second implementation that keeps players in memory, so the app runs with no
AWS setup at all. State is lost when the server restarts.

```bash
npm install
STORE_DRIVER=memory npm run dev
```

### Against DynamoDB

Needs credentials that can reach the table (see [AWS setup](#aws-setup)). The AWS SDK reads
them from the ambient environment — `~/.aws` locally — so there is nothing to put in a
`.env` file.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Useful checks:

```bash
curl -s localhost:3000/api/price                                  # {"symbol":"BTC-USD","price":…,"asOf":…}
curl -s -X POST localhost:3000/api/players                        # {"playerId":"…","score":0,…}
curl -s localhost:3000/api/players/<playerId>                     # score + guess state + price snapshot
curl -s -X POST localhost:3000/api/players/<playerId>/guesses \
  -H 'content-type: application/json' -d '{"direction":"up"}'     # 201, or 409 if one is pending
```

## Testing

```bash
npm run test        # vitest, 25 tests
npm run typecheck
npm run build
```

Depth over breadth, on purpose. The tests are concentrated where a mistake changes someone's
score:

- **[`lib/resolve-guess.test.ts`](lib/resolve-guess.test.ts)** — the resolution rule. Correct
  up, correct down, both ways of being wrong, price unchanged after 60 seconds (still
  pending, however long), price changed before 60 seconds (still pending), the 60-second
  boundary itself, and "changed" meaning changed *in cents* — including a case that would
  fail under naive float comparison.
- **[`lib/store.memory.test.ts`](lib/store.memory.test.ts)** — the two invariants the game
  depends on: no second guess while one is pending, and a guess resolves at most once. That
  second one is tested with eight concurrent resolutions of the same guess.

**What is not unit tested, and why:** the route handlers. They are a thin shell over the rule
and the store, and testing them meaningfully would mean mocking DynamoDB — which tests the
mock, not the invariant. Instead the deployed API was exercised end to end against real
DynamoDB and a real 60-second wait: duplicate guesses rejected (including five submitted
simultaneously — all `409`), score moved by exactly ±1, and eight concurrent polls at the
moment of resolution all returned the same score.

The tests were also checked for the obvious failure mode of tests that pass vacuously.
Disabling the "price has not changed" branch of the rule turns 3 of them red; disabling the
60-second branch as well turns 5 red.

A failing test fails the deploy: `npm run test` runs in [amplify.yml](amplify.yml) before the
build.

## Deploy

Hosting is AWS Amplify, which builds and runs the Next.js app — including its API routes —
straight from this repository.

1. Amplify console: **Create new app** → **GitHub** → this repo, `main` branch.
2. Amplify detects Next.js and offers a build spec. This repo already contains
   [amplify.yml](amplify.yml), which is used as-is: `npm ci`, `npm run test`, `npm run build`
   on Node 20.
3. Complete [AWS setup](#aws-setup) below, then deploy. Every push to `main` redeploys.

Amplify decides **at app-creation time** whether an app is static hosting or SSR compute,
based on the framework it detects in the connected branch. Connect the repo only once the
Next.js app is actually on `main` — otherwise Amplify provisions plain static hosting, the
build still succeeds, and every route answers `404` from S3.

## AWS setup

Two things: a table, and permission for the deployed app to use it. Replace `<account-id>`
and `<app-id>`, and keep the region consistent — a table in a different region from the app
is the quietest way to produce "table not found".

### 1. The table

One table, one item per player, on-demand billing. No sort key and no indexes: every access
is by `playerId`.

```bash
aws dynamodb create-table \
  --table-name btc-up-down-players \
  --attribute-definitions AttributeName=playerId,AttributeType=S \
  --key-schema AttributeName=playerId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region eu-central-1
```

Set `PLAYERS_TABLE_NAME` to use a different name; the code defaults to
`btc-up-down-players`.

### 2. Permission for the deployed app

Amplify's SSR functions run with a *compute role*, which a newly created app does not have.
Without it the app deploys and serves pages but every data call fails. The role Amplify
creates by default (`AmplifySSRLoggingRole…`) only writes CloudWatch logs — it is not this
one.

```bash
cat > /tmp/amplify-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "amplify.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
JSON

aws iam create-role \
  --role-name btc-up-down-amplify-compute \
  --assume-role-policy-document file:///tmp/amplify-trust.json
```

I first wrote this trust policy with `aws:SourceAccount` and `aws:SourceArn` conditions, to
scope it to one app and rule out the confused-deputy case. Amplify rejects such a role on
attach — *"The compute role provided cannot be assumed by Amplify"* — because its validation
call does not carry those context keys. A role that cannot be attached protects nothing, so
the conditions are gone. The narrowing that survives is on the permission side: three
actions, one table, no wildcards.

```bash
cat > /tmp/dynamo-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
    "Resource": "arn:aws:dynamodb:eu-central-1:<account-id>:table/btc-up-down-players"
  }]
}
JSON

aws iam put-role-policy \
  --role-name btc-up-down-amplify-compute \
  --policy-name btc-up-down-players-access \
  --policy-document file:///tmp/dynamo-policy.json
```

Attach it and redeploy, since the role is bound at deploy time. `--compute-role-arn` needs a
recent AWS CLI; the Amplify console can set it too, under **App settings → IAM roles**.

```bash
aws amplify update-app \
  --app-id <app-id> \
  --compute-role-arn arn:aws:iam::<account-id>:role/btc-up-down-amplify-compute \
  --region eu-central-1

aws amplify start-job --app-id <app-id> --branch-name main --job-type RELEASE \
  --region eu-central-1
```

The application never holds an AWS credential: locally the SDK uses your `~/.aws` profile,
in production it uses this role. There is no access key in the repository, in the build
settings, or in an environment variable.

## Key decisions and tradeoffs

**Fairness is a server property, not a UI concern.** The request body is
`{ "direction": "up" }` and nothing else. Price and time are read server-side. Everything
below follows from this.

**Elapsed time is measured between two price observations,** not against `Date.now()`:
`elapsedMs = priceSnapshot.asOf - guess.createdAt`. Both ends are server-side readings of the
price feed, so the 60-second window is measured on the same clock that produced the prices —
and the price used to resolve was necessarily observed at least 60 seconds after the price
used for the guess, never a stale value from inside the window.

**The active guess is embedded in the player item** rather than living in its own table.
"Only one guess at a time" *is* the constraint "this item has at most one `activeGuess`", so
both hard invariants become single-item conditional writes that DynamoDB guarantees
atomically: `attribute_not_exists(activeGuess)` on submit makes the 409 a database
guarantee rather than a race, and `activeGuess.guessId = :guessId` on resolve makes
resolution idempotent. A separate table would need a transaction or a lock for the same
result. *Tradeoff:* no guess history — see [what I left out](#what-i-deliberately-left-out).

**"The price has not changed" is compared in integer cents** (`Math.round(price * 100)`).
The source publishes two decimals, so this is an exact test instead of a floating-point
tolerance that would need defending.

**Recording a guess bypasses the price cache; displaying and resolving may use it.** A
cached price at guess time is exploitable: a player watching the live feed could wait for a
jump and then guess against a price the server read seconds before it, already knowing the
direction. Guesses take a live reading. *Cost:* one upstream request per guess, and a guess
is at most one per player per minute.

**Resolution is lazy — it happens inside the polling `GET`.** This is the biggest trade in
the project, and it has two honest consequences. A `GET` has a side effect, which is a
deliberate deviation from REST purity: the client polls that endpoint anyway, so a separate
`POST /resolve` would add a round trip and change nothing. And a guess resolves the first
time somebody looks at it, so a player who closes the browser mid-guess and returns an hour
later has it resolved then, against that moment's price. Both prices are real third-party
observations, so it is fair — but it is not the same as resolving at the 60-second mark. The
UI says so explicitly instead of hiding it. The production answer is a scheduled worker; see
[what I'd do next](#what-id-do-next).

**One polling endpoint returns a consistent snapshot.** `GET /api/players/{id}` carries
score, guess state *and* the price it was evaluated against. Two separate calls could
disagree, and the player would be looking at the disagreement.

**`canGuess` and `pendingReason` are explicit in the response** even though a client could
derive them — but only if it already knew the rules. `pendingReason` distinguishes
`waiting_for_time` from `waiting_for_price_change`, which is what lets the UI explain why
nothing is happening.

**The countdown counts a duration, not a timestamp.** It first compared the server's
absolute deadline against the browser clock, corrected by treating `price.asOf` as "now on
the server" — and it visibly stepped backwards (31, 30, 31, 30). `asOf` is when the price was
*observed*, and the cache makes it 0–2 seconds old, so every poll re-anchored the clock
somewhere new. It now anchors once per guess to the remaining *duration* and counts local
elapsed time from there, which is monotonic by construction and makes a wrong browser clock
irrelevant.

**Anonymous identity in `localStorage`, no auth.** The server generates a UUID; the browser
keeps it. Stated plainly: anyone who knows a `playerId` can read and modify that score. v4
UUIDs are not enumerable so it is not a practical problem for a demo, but it is not access
control either.

**Client-rendered, no SSR.** There is no SEO value and no first-paint data worth
server-rendering — the price arrives from a poll seconds later. In production `/` is a
prerendered shell cached at CloudFront, and it contains no player data at all.

**All data access sits behind one module,** with a second implementation in memory. That is
what makes the storage choice reversible, lets the tests run offline, and lets a reviewer run
the app with no AWS account.

## What I deliberately left out

- **Authentication.** The brief asks for anonymous players starting at 0; adding accounts
  would add a login flow and a password story without touching the actual problem, which is
  fair resolution.
- **A leaderboard.** It needs cross-player queries and therefore a different key design, and
  nothing in the requirements asks to compare players.
- **Guess history.** Only the most recent resolved guess is kept. History means an item per
  guess, which means a sort key — and DynamoDB key schemas cannot be changed in place, so it
  would be a new table plus a migration. Worth doing the moment history is actually wanted.
- **WebSockets / realtime price streaming.** Polling every 2–5 seconds is well within
  Coinbase's public limits and hides no meaningful latency at a 60-second resolution window;
  a socket layer would add reconnection and fan-out concerns for no gameplay benefit.
- **A scheduled resolution worker.** Lazy resolution is the timebox choice; see below for
  what would replace it.
- **Error reporting (Sentry or similar).** Failures currently go to CloudWatch via
  `console.error`, which is enough to diagnose a demo; wiring a reporting service is
  configuration, not engineering, and would not have improved the submission.
- **Rate limiting on player creation.** `POST /api/players` is unauthenticated and
  unthrottled, so it can be used to create unlimited empty player rows. Noticed and left
  alone deliberately — on-demand billing makes it cheap, and the fix (per-IP throttling at
  the edge) is infrastructure rather than application code.
- **CI beyond the deploy build.** Tests gate the Amplify build, so a red test blocks a
  release; a separate GitHub Actions workflow would only duplicate that for a solo project.

## What I'd do next

1. **Resolve guesses on a schedule.** EventBridge on a one-minute tick invoking a Lambda that
   sweeps due guesses, with the lazy path kept as a fallback. That removes the "resolves when
   you come back" behaviour and the side effect on `GET`.
2. **Move identity to an httpOnly cookie** the server sets, with the path id checked against
   it, so a known `playerId` stops being enough to read or modify a score.
3. **Store guesses as items** so history, streaks and a leaderboard become possible, and so a
   disputed result can be audited.
4. **Record the price feed's own reading, not just the value** — persisting the upstream
   response alongside the snapshot would make every resolution independently verifiable after
   the fact.
5. **Error reporting and an alarm on `price_unavailable` rate**, because the one dependency
   this game genuinely cannot survive is the price feed.
