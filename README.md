# BTC Up/Down

Guess whether BTC/USD will be higher or lower one minute from now. +1 if you are right,
-1 if you are wrong, one guess at a time.

**Live:** https://main.d1ladzr322rz9f.amplifyapp.com

**Status:** work in progress. The design is settled before the implementation:
[docs/api.md](docs/api.md) is the API contract — endpoints, error codes, the resolution
rule, and the DynamoDB data model, with the reasoning behind each. Setup, deployment and
tradeoffs land here as the app is built.

## Run locally

Requires Node 20 or newer.

### Without an AWS account

The store has a second implementation that keeps players in memory, so the app runs with
no AWS setup at all. State is lost when the server restarts.

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
curl -s localhost:3000/api/price                  # {"symbol":"BTC-USD","price":…,"asOf":…}
curl -s -X POST localhost:3000/api/players        # {"playerId":"…","score":0,…}
curl -s localhost:3000/api/players/<playerId>     # score + guess state + price snapshot
npm run typecheck
npm run build
```

## AWS setup

Two things: a table, and permission for the deployed app to use it. Replace
`<account-id>` with your AWS account id and keep the region consistent — a table in a
different region than the app is the quietest way to produce "table not found".

### 1. The table

One table, one item per player, on-demand billing. No sort key, no indexes: every access
is by `playerId`.

```bash
aws dynamodb create-table \
  --table-name btc-up-down-players \
  --attribute-definitions AttributeName=playerId,AttributeType=S \
  --key-schema AttributeName=playerId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region eu-central-1
```

Set `PLAYERS_TABLE_NAME` if you want a different name; the code defaults to
`btc-up-down-players`.

### 2. Permission for the deployed app

Amplify's SSR functions run with a *compute role*, which a newly created app does not have.
Without it the app deploys and serves pages but every data call fails. The role that
Amplify creates by default (`AmplifySSRLoggingRole…`) only writes CloudWatch logs — it is
not this.

Create a role Amplify can assume:

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
scope it to one app and rule out the confused-deputy case. Amplify rejects such a role when
you attach it — *"The compute role provided cannot be assumed by Amplify"* — because its
validation call doesn't carry those context keys. A role that can't be attached protects
nothing, so the conditions are gone. The narrowing that survives is on the permission side,
below: three actions, one table.

Grant it exactly the three actions the app performs on exactly one table — no `Scan`, no
`Query`, no `DeleteItem`, no wildcard resource:

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

Attach it to the app and redeploy, since the role is bound at deploy time:

```bash
aws amplify update-app \
  --app-id <app-id> \
  --compute-role-arn arn:aws:iam::<account-id>:role/btc-up-down-amplify-compute \
  --region eu-central-1

aws amplify start-job --app-id <app-id> --branch-name main --job-type RELEASE \
  --region eu-central-1
```

The application itself never holds an AWS credential: locally the SDK uses your
`~/.aws` profile, and on Amplify it uses this role. There is no access key in the
repository, in the build settings, or in an environment variable.

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
