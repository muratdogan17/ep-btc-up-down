"use client";

import { usePlayer } from "@/app/use-player";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Home() {
  const { state, error } = usePlayer();

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

      <div className="actions">
        <button className="guess" data-direction="up" type="button" disabled>
          Up
        </button>
        <button className="guess" data-direction="down" type="button" disabled>
          Down
        </button>
      </div>
      <p className="subtitle">Guessing is not wired up yet.</p>
    </main>
  );
}
