# API contract

BTC Up/Down — guess whether BTC/USD will be higher or lower one minute from now.

This document is the contract. Implementation follows it; if the two disagree, this
document is wrong and should be fixed first.

## Design rules the contract has to satisfy

1. **Fairness lives on the server.** The client sends a direction and nothing else.
   Never a price, never a timestamp. The server reads the price from a third party at
   guess time and again at resolution time, and decides the outcome.
2. **Responses are self-describing.** A reader who does not know the game rules should
   be able to tell what is happening from the JSON alone: explicit `status`, explicit
   `outcome`, explicit reason for why a guess has not resolved yet.
3. **The server is the source of truth.** A refresh, a new tab, or a reopened browser
   shows the same pending guess and the same score.
4. **Resolution is lazy.** A guess resolves when someone reads the player's state
   (see [Lazy resolution](#lazy-resolution)).

## Conventions

- All requests and responses are `application/json; charset=utf-8`.
- All timestamps are ISO 8601 UTC strings, e.g. `2026-07-30T09:12:04.512Z`.
- All prices are USD numbers with two decimal places, as published by the upstream
  source, e.g. `118234.56`.
- `playerId` is a server-generated UUID v4. There is no authentication (see
  [Identity](#identity)).
- Every error response uses the same shape:

  ```json
  { "error": "snake_case_code", "message": "Human readable, safe to display." }
  ```

## Identity

There is no auth. On first visit the client calls `POST /api/players`, receives a
`playerId`, and stores it in `localStorage`. Every later request carries that id in the
URL path.

Consequence, stated openly: anybody who knows a `playerId` can read and modify that
player's score. UUID v4 ids are not enumerable, so this is not a practical problem for a
demo, but it is not access control either. See the README's "What I deliberately left
out" for the hardening path.

## Endpoints

| Method | Path                      | Purpose                                        |
| ------ | ------------------------- | ---------------------------------------------- |
| `POST` | `/api/players`            | Create a new player, score 0                   |
| `GET`  | `/api/players/{playerId}` | Player state + current price; resolves a due guess |
| `POST` | `/api/players/{playerId}/guesses` | Submit a guess                         |
| `GET`  | `/api/price`              | Current BTC/USD price                          |

---

### `POST /api/players`

Creates a player. No request body.

**`201 Created`**

```json
{
  "playerId": "9c1f3a7e-3d2b-4f61-8a2e-7b9d0c4e51aa",
  "score": 0,
  "activeGuess": null,
  "createdAt": "2026-07-30T09:10:00.000Z"
}
```

Errors: `500 internal_error`.

---

### `GET /api/players/{playerId}`

The single endpoint the UI polls. It returns everything needed to render a frame:
score, guess state, and the price snapshot that guess state was evaluated against.
If the active guess is due, this call resolves it and the response already reflects the
new score.

**`200 OK`** — no active guess, previous guess won

```json
{
  "playerId": "9c1f3a7e-3d2b-4f61-8a2e-7b9d0c4e51aa",
  "score": 3,
  "canGuess": true,
  "activeGuess": null,
  "lastResolvedGuess": {
    "guessId": "f0a2c5d8-1b44-4c9e-9f31-6d2a8e7b0c13",
    "direction": "up",
    "priceAtGuess": 118234.56,
    "priceAtResolution": 118301.02,
    "outcome": "win",
    "scoreDelta": 1,
    "resolvedAt": "2026-07-30T09:11:07.400Z"
  },
  "price": {
    "symbol": "BTC-USD",
    "price": 118301.02,
    "asOf": "2026-07-30T09:11:07.400Z"
  }
}
```

**`200 OK`** — guess pending, 60 seconds not up yet

```json
{
  "playerId": "9c1f3a7e-3d2b-4f61-8a2e-7b9d0c4e51aa",
  "score": 3,
  "canGuess": false,
  "activeGuess": {
    "guessId": "b7e1d0c2-55aa-4f0e-8c31-9a2b4d6e7f80",
    "direction": "down",
    "priceAtGuess": 118301.02,
    "createdAt": "2026-07-30T09:12:00.000Z",
    "status": "pending",
    "pendingReason": "waiting_for_time",
    "secondsElapsed": 18,
    "resolvesNoEarlierThan": "2026-07-30T09:13:00.000Z"
  },
  "lastResolvedGuess": { "…": "unchanged from the previous resolution" },
  "price": { "symbol": "BTC-USD", "price": 118299.10, "asOf": "2026-07-30T09:12:18.000Z" }
}
```

**`200 OK`** — 60 seconds have passed but the price has not moved

```json
{
  "activeGuess": {
    "guessId": "b7e1d0c2-55aa-4f0e-8c31-9a2b4d6e7f80",
    "direction": "down",
    "priceAtGuess": 118301.02,
    "createdAt": "2026-07-30T09:12:00.000Z",
    "status": "pending",
    "pendingReason": "waiting_for_price_change",
    "secondsElapsed": 74,
    "resolvesNoEarlierThan": "2026-07-30T09:13:00.000Z"
  },
  "…": "score, canGuess, price as above"
}
```

Field notes:

- `canGuess` — `true` exactly when `activeGuess` is `null`. Redundant on purpose: the
  client should not have to re-derive a game rule to know whether to enable a button.
- `pendingReason` — `waiting_for_time` (less than 60s since the guess) or
  `waiting_for_price_change` (60s are up, price is still identical). This is the field
  that lets the UI say *why* nothing is happening.
- `lastResolvedGuess` — only the most recent one. Guess history is not stored; see
  [Data model](#data-model).
- `price` — the same snapshot the server used to evaluate the guess in this request, so
  what the player sees is what the server decided on. `asOf` also drives the
  "price updated N seconds ago" indicator.

Errors: `404 player_not_found`, `502 price_unavailable`, `500 internal_error`.

If the upstream price API is down, this endpoint returns `502 price_unavailable` rather
than a state snapshot without a price — a resolution decision must never be made on a
guessed price. The client keeps showing the last known state and a warning.

---

### `POST /api/players/{playerId}/guesses`

**Request**

```json
{ "direction": "up" }
```

`direction` must be exactly `"up"` or `"down"`. Nothing else in the body is read.

**`201 Created`**

```json
{
  "guessId": "b7e1d0c2-55aa-4f0e-8c31-9a2b4d6e7f80",
  "direction": "up",
  "priceAtGuess": 118301.02,
  "createdAt": "2026-07-30T09:12:00.000Z",
  "status": "pending",
  "pendingReason": "waiting_for_time",
  "resolvesNoEarlierThan": "2026-07-30T09:13:00.000Z"
}
```

`priceAtGuess` and `createdAt` are both taken from the server's price snapshot, so the
recorded price and the recorded time refer to the same observation.

**`409 Conflict`** — a guess is already pending

```json
{
  "error": "guess_already_pending",
  "message": "You already have a pending guess. Wait for it to resolve before guessing again."
}
```

This is enforced by a conditional write in DynamoDB, not by a read-then-write check, so
two simultaneous submissions cannot both succeed.

Errors: `400 invalid_direction`, `400 invalid_request` (unparseable body),
`404 player_not_found`, `409 guess_already_pending`, `502 price_unavailable`,
`500 internal_error`.

A guess is never recorded without a price. If the upstream call fails, the request fails
and the player can retry.

---

### `GET /api/price`

```json
{ "symbol": "BTC-USD", "price": 118301.02, "asOf": "2026-07-30T09:12:18.000Z" }
```

Errors: `502 price_unavailable`.

Kept as a cheap health check, and because it lets the price display be built and verified
before any persistence exists. The game loop itself does not need it, because
`GET /api/players/{playerId}` already carries a price snapshot.

---

## Error codes

| Code                    | HTTP | Meaning                                            |
| ----------------------- | ---- | -------------------------------------------------- |
| `invalid_request`       | 400  | Body missing or not valid JSON                     |
| `invalid_direction`     | 400  | `direction` was not `"up"` or `"down"`             |
| `player_not_found`      | 404  | Unknown `playerId` (e.g. stale `localStorage`)     |
| `guess_already_pending` | 409  | One guess at a time                                |
| `price_unavailable`     | 502  | Upstream price API failed or returned nonsense     |
| `internal_error`        | 500  | Anything else; details logged, not returned        |

On `404 player_not_found` the client clears `localStorage` and creates a fresh player.

## Resolution

### The rule

Extracted as a pure function so it can be tested without a network, a clock, or a
database:

```ts
resolveGuess(input: {
  direction: "up" | "down";
  priceAtGuess: number;
  currentPrice: number;
  elapsedMs: number;
}): "win" | "loss" | "pending";
```

In order:

1. `elapsedMs < 60_000` → `pending`
2. `currentPrice` equals `priceAtGuess` → `pending` (both conditions are required, so a
   flat market keeps the guess open indefinitely)
3. `direction === "up"` → `currentPrice > priceAtGuess ? "win" : "loss"`
4. `direction === "down"` → `currentPrice < priceAtGuess ? "win" : "loss"`

`win` is `+1`, `loss` is `-1`. Scores may go negative; the assignment does not say
otherwise.

Equality in step 2 is compared as integer cents (`Math.round(price * 100)`). The upstream
source publishes two decimal places, so this makes "the price has not changed" an exact
test instead of a floating-point judgement call with an epsilon nobody can defend.

### `elapsedMs` comes from the price observation, not from `Date.now()`

`elapsedMs = priceSnapshot.asOf - guess.createdAt`.

Both ends of that subtraction are server-side observations of the price feed, which means
the 60-second window is measured against the same clock that produced the prices. It also
means the price used for resolution was observed at least 60 seconds after the price used
for the guess — never a stale value from inside the window.

### Lazy resolution

Resolution happens inside `GET /api/players/{playerId}`, which the client polls. There is
no scheduler.

Two honest consequences:

- **A `GET` has a side effect.** That is a deliberate deviation from REST purity. The
  alternative — a `POST /api/players/{id}/resolve` the client would have to call on a
  timer anyway — adds a round trip and an endpoint without changing the outcome. The
  behaviour is documented rather than hidden.
- **A guess resolves the first time somebody looks at it.** If a player closes the
  browser mid-guess and returns an hour later, the guess resolves then, against the price
  at that moment. That is fair in the sense that both prices are real third-party
  observations, but it is not the same as resolving at the 60-second mark. A scheduled
  worker (EventBridge → Lambda) is the production answer; it is out of scope for a
  half-day build and is called out in the README.

The resolving update is a single conditional `UpdateItem`:

```
SET  lastResolvedGuess = :resolved
ADD  score :delta
REMOVE activeGuess
CONDITION activeGuess.guessId = :guessId
```

So concurrent polls cannot double-count: the first one wins, the rest fail the condition
and simply re-read.

## Price source

`GET https://api.coinbase.com/v2/prices/BTC-USD/spot` → `{"data":{"amount":"118301.02", …}}`

- **Server-side only.** The browser never calls Coinbase, so the client cannot influence
  a price the server will use.
- **No API key**, no auth, generous public rate limit.
- **In-memory cache, 2 second TTL.** Enough to keep polling clients from multiplying into
  upstream requests, short enough that resolution uses a near-live price. `asOf` is the
  time the snapshot was fetched, so callers can see the staleness rather than guess at it.
- The cache lives in the process, and on Amplify's SSR runtime each Lambda instance has
  its own. That reduces upstream traffic without guaranteeing a single global snapshot,
  which is fine: every value is still a real observed price with its own honest `asOf`.
- Chosen over Binance because Binance's public API returns HTTP 451 from several
  AWS/US-hosted regions, which would work locally and then fail in production.

## Data model

One DynamoDB table, one item per player. The active guess is embedded in the player item.

**Table** `btc-up-down-players`
**Partition key** `playerId` (S) — no sort key
**Billing** on-demand (`PAY_PER_REQUEST`)

| Attribute           | Type      | Notes                                                   |
| ------------------- | --------- | ------------------------------------------------------- |
| `playerId`          | S         | UUID v4, partition key                                  |
| `score`             | N         | Starts at 0, may go negative                            |
| `createdAt`         | S         | ISO 8601                                                |
| `updatedAt`         | S         | ISO 8601                                                |
| `activeGuess`       | M or absent | Absent means no pending guess                         |
| `lastResolvedGuess` | M or absent | Most recent resolved guess, for the result banner     |

`activeGuess`:

| Field          | Type | Notes                          |
| -------------- | ---- | ------------------------------ |
| `guessId`      | S    | UUID v4                        |
| `direction`    | S    | `up` \| `down`                 |
| `priceAtGuess` | N    | USD, 2 decimals                |
| `createdAt`    | S    | ISO 8601, from the price `asOf` |

`lastResolvedGuess`: the fields above plus `priceAtResolution` (N), `outcome`
(`win` \| `loss`), `scoreDelta` (N), `resolvedAt` (S).

### Why embed the guess instead of a separate guesses table

The rule "only one guess at a time" is exactly the constraint "this item has at most one
`activeGuess`". Embedding turns both of the tricky invariants into single-item conditional
writes, which DynamoDB guarantees atomically:

- submit — `ConditionExpression: attribute_not_exists(activeGuess)` → the 409 is enforced
  by the database, not by application logic that could race
- resolve — `ConditionExpression: activeGuess.guessId = :guessId` → idempotent, so
  overlapping polls cannot apply the score change twice

A separate table would need a transaction or a lock to get the same guarantee, for no
benefit at this scope.

### Tradeoff: no guess history

`lastResolvedGuess` overwrites, so past guesses are not retained. Nothing in the
assignment asks for history, and a leaderboard is explicitly out of scope.

The honest cost: keeping history would mean an item per guess, which means adding a sort
key — and DynamoDB key schemas cannot be changed in place, so it would be a new table
plus a migration. If we would plausibly want history, the cheap moment to decide is now,
not later. **My recommendation is still the simple table**: the requirements do not ask
for it, and all data access sits behind `lib/store.ts`, so the blast radius of changing
our mind is one module.

### Access pattern

Every request is a `GetItem` or `UpdateItem` by `playerId`. There are no queries, no
scans, no indexes.

## Swappability

Every read and write goes through `lib/store.ts`, which exposes intent, not DynamoDB:

```ts
createPlayer(): Promise<Player>
getPlayer(playerId): Promise<Player | null>
addGuess(playerId, guess): Promise<Player>          // throws GuessAlreadyPendingError
resolveActiveGuess(playerId, guessId, resolution): Promise<Player>
```

Nothing above this module imports the AWS SDK or knows a table exists. An in-memory
implementation of the same interface is what makes route-level tests possible without
AWS credentials.
