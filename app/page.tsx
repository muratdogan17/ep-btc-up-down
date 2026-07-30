"use client";

import { usePlayer } from "@/app/use-player";
import { RESOLUTION_DELAY_MS } from "@/lib/resolve-guess";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const RESOLUTION_DELAY_SECONDS = RESOLUTION_DELAY_MS / 1000;

export default function Home() {
  const { state, error, submitting, submitGuess } = usePlayer();

  const pending = state?.activeGuess ?? null;
  const resolved = state?.lastResolvedGuess ?? null;
  const canGuess = Boolean(state?.canGuess) && !submitting;

  return (
    <main className="page">
      <h1 className="title">BTC Up/Down</h1>
      <p className="subtitle">
        Will BTC/USD be higher or lower one minute from now? Right is +1, wrong is -1.
      </p>

      <section className="card" aria-labelledby="price-label">
        <p className="label" id="price-label">
          BTC / USD
        </p>
        <div className="price">{state ? usd.format(state.price.price) : "—"}</div>
        <p className="meta" data-tone={error ? "warn" : undefined}>
          {error ?? (state ? "Live from Coinbase" : "Loading…")}
        </p>
      </section>

      <section className="card" aria-labelledby="score-label">
        <p className="label" id="score-label">
          Your score
        </p>
        <div className="score">{state ? state.score : "—"}</div>
      </section>

      {pending ? (
        <section className="card" aria-labelledby="pending-label">
          <p className="label" id="pending-label">
            Guess in progress
          </p>
          <div className="pending-direction" data-direction={pending.direction}>
            {pending.direction === "up" ? "Up" : "Down"} from {usd.format(pending.priceAtGuess)}
          </div>
          <p className="meta">
            {pending.pendingReason === "waiting_for_time"
              ? `Resolves in about ${Math.max(
                  0,
                  RESOLUTION_DELAY_SECONDS - pending.secondsElapsed,
                )}s`
              : `${RESOLUTION_DELAY_SECONDS} seconds are up — waiting for the price to move.`}
          </p>
        </section>
      ) : null}

      {!pending && resolved ? (
        <section className="card" aria-labelledby="result-label">
          <p className="label" id="result-label">
            Last guess
          </p>
          <div className="result" data-outcome={resolved.outcome}>
            {resolved.outcome === "win" ? "Correct" : "Wrong"} · {resolved.scoreDelta > 0 ? "+1" : "-1"}
          </div>
          <p className="meta">
            {resolved.direction === "up" ? "Up" : "Down"} from {usd.format(resolved.priceAtGuess)} to{" "}
            {usd.format(resolved.priceAtResolution)}
          </p>
        </section>
      ) : null}

      <div className="actions">
        <button
          className="guess"
          data-direction="up"
          type="button"
          onClick={() => void submitGuess("up")}
          disabled={!canGuess}
        >
          Up
        </button>
        <button
          className="guess"
          data-direction="down"
          type="button"
          onClick={() => void submitGuess("down")}
          disabled={!canGuess}
        >
          Down
        </button>
      </div>

      <p className="subtitle">
        {!state
          ? "Getting things ready…"
          : pending
            ? "One guess at a time — you can guess again once this one resolves."
            : "Pick a direction. A guess resolves after 60 seconds, once the price has changed."}
      </p>
    </main>
  );
}
