"use client";

import { useCallback, useEffect, useState } from "react";

import type { PriceSnapshot } from "@/lib/price";

const POLL_INTERVAL_MS = 5_000;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Home() {
  const [price, setPrice] = useState<PriceSnapshot | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const loadPrice = useCallback(async () => {
    try {
      const response = await fetch("/api/price", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`/api/price responded ${response.status}`);
      }
      setPrice((await response.json()) as PriceSnapshot);
      setPriceError(null);
    } catch {
      setPriceError("Can't reach the price feed. Retrying…");
    }
  }, []);

  useEffect(() => {
    void loadPrice();
    const timer = setInterval(() => void loadPrice(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadPrice]);

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
        <div className="price">{price ? usd.format(price.price) : "—"}</div>
        <p className="meta" data-tone={priceError ? "warn" : undefined}>
          {priceError ?? (price ? "Live from Coinbase" : "Loading…")}
        </p>
      </section>

      <section className="card" aria-labelledby="score-label">
        <p className="label" id="score-label">
          Your score
        </p>
        <div className="score">0</div>
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
