"use client";

import { useNow } from "@/app/use-now";
import { usePlayer } from "@/app/use-player";
import { RESOLUTION_DELAY_MS } from "@/lib/resolve-guess";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const RESOLUTION_DELAY_SECONDS = RESOLUTION_DELAY_MS / 1000;

/** A resolution this much later than the guess needs explaining, not just reporting. */
const LATE_RESOLUTION_MS = 90_000;

export default function Home() {
  const { state, error, submitting, submitGuess, countdown, priceAge, isNewPlayer } =
    usePlayer();
  const now = useNow();

  const pending = state?.activeGuess ?? null;
  const resolved = state?.lastResolvedGuess ?? null;
  const feedDown = error?.code === "price_unavailable";
  const canGuess = Boolean(state?.canGuess) && !submitting && !feedDown;

  // Both of these count elapsed *local* time from an anchor the server supplied, so they
  // tick every second without a request and never step backwards when a poll lands.
  const msUntilResolvable = countdown
    ? countdown.remainingMsAtAnchor - (now - countdown.anchoredAt)
    : 0;
  const secondsRemaining = Math.max(0, Math.ceil(msUntilResolvable / 1000));
  const elapsedFraction = countdown
    ? Math.min(1, Math.max(0, 1 - msUntilResolvable / RESOLUTION_DELAY_MS))
    : 0;
  const waitingForPrice = Boolean(pending) && msUntilResolvable <= 0;

  const priceAgeSeconds = priceAge
    ? Math.max(0, Math.round((priceAge.ageAtReceiptMs + (now - priceAge.receivedAt)) / 1000))
    : 0;

  const resolutionTookMs = resolved
    ? Date.parse(resolved.resolvedAt) - Date.parse(resolved.createdAt)
    : 0;

  // Only discrete events belong in the live region — never the ticking numbers, or a screen
  // reader would talk over itself once a second.
  const announcement = pending
    ? `Guess recorded: ${pending.direction} from ${usd.format(pending.priceAtGuess)}.`
    : resolved
      ? `${resolved.outcome === "win" ? "Correct" : "Wrong"}, ${
          resolved.scoreDelta > 0 ? "plus one" : "minus one"
        }. Your score is ${state?.score ?? 0}.`
      : "";

  return (
    <main className="page">
      <h1 className="title">BTC Up/Down</h1>
      <p className="subtitle">
        Will BTC/USD be higher or lower one minute from now? Right is +1, wrong is -1.
      </p>

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <section className="card" aria-labelledby="price-label">
        <p className="label" id="price-label">
          BTC / USD
        </p>
        <div className="price" data-stale={feedDown ? "true" : undefined}>
          {state ? usd.format(state.price.price) : "—"}
        </div>
        <p className="meta" data-tone={error ? "warn" : undefined}>
          {!state
            ? "Loading…"
            : feedDown
              ? `Price feed unavailable — last price is ${priceAgeSeconds}s old`
              : error
                ? error.message
                : priceAgeSeconds <= 1
                  ? "Updated just now"
                  : `Updated ${priceAgeSeconds}s ago`}
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

          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={RESOLUTION_DELAY_SECONDS}
            aria-valuenow={RESOLUTION_DELAY_SECONDS - secondsRemaining}
            aria-label="Time until this guess can resolve"
          >
            <div
              className="progress-fill"
              data-complete={waitingForPrice ? "true" : undefined}
              style={{ width: `${elapsedFraction * 100}%` }}
            />
          </div>

          {waitingForPrice && feedDown ? (
            // Don't blame a flat market when the real reason is that we cannot read a price.
            <p className="meta" data-tone="warn">
              {RESOLUTION_DELAY_SECONDS} seconds are up. This resolves as soon as the price
              feed is back.
            </p>
          ) : waitingForPrice ? (
            <p className="meta" data-tone="warn">
              {RESOLUTION_DELAY_SECONDS} seconds are up. The guess stays open until the price
              changes — that is part of the rule, not a problem.
            </p>
          ) : (
            <p className="meta">Resolves in {secondsRemaining}s, once the price has changed</p>
          )}
        </section>
      ) : null}

      {!pending && resolved ? (
        <section className="card" aria-labelledby="result-label">
          <p className="label" id="result-label">
            Last guess
          </p>
          <div className="result" data-outcome={resolved.outcome}>
            {resolved.outcome === "win" ? "Correct" : "Wrong"} ·{" "}
            {resolved.scoreDelta > 0 ? "+1" : "-1"}
          </div>
          <p className="meta">
            {resolved.direction === "up" ? "Up" : "Down"} from{" "}
            {usd.format(resolved.priceAtGuess)} to {usd.format(resolved.priceAtResolution)}
          </p>
          {resolutionTookMs > LATE_RESOLUTION_MS ? (
            <p className="meta">
              Resolved {formatDuration(resolutionTookMs)} after you guessed — at the first
              price reading taken once you were back.
            </p>
          ) : null}
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

      <p className="subtitle" data-tone={feedDown ? "warn" : undefined}>
        {!state
          ? "Getting things ready…"
          : feedDown
            ? pending
              ? "Guessing is paused until the price feed is back. Your guess is safe on the server."
              : "Guessing is paused until the price feed is back."
            : pending
              ? "One guess at a time — you can guess again once this one resolves."
              : isNewPlayer && !resolved
                ? "New here? Pick a direction — you'll find out in about a minute, and your score is saved even if you close the tab."
                : "Pick a direction. A guess resolves after 60 seconds, once the price has changed."}
      </p>
    </main>
  );
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;

  const hours = Math.round(totalMinutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
