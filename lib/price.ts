/**
 * BTC/USD price, read from Coinbase server-side only.
 *
 * The browser never talks to Coinbase: a client that could choose the price could choose
 * the outcome of its own guess. Every price the game uses enters through this module.
 */

export type PriceSnapshot = {
  symbol: "BTC-USD";
  /** USD, two decimal places, as published upstream. */
  price: number;
  /** When this process observed the price. ISO 8601 UTC. */
  asOf: string;
};

export class PriceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The BTC price source is unavailable.");
    this.name = "PriceUnavailableError";
    this.cause = cause;
  }
}

const COINBASE_SPOT_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";

/**
 * Short enough that a resolution still runs against a near-live price, long enough that
 * many polling clients collapse into one upstream request. The cache is per process, so
 * on a serverless runtime each instance keeps its own — every value is still a real
 * observation carrying its own honest `asOf`.
 */
const CACHE_TTL_MS = 2_000;
const UPSTREAM_TIMEOUT_MS = 3_000;

let cached: PriceSnapshot | null = null;
let cachedAt = 0;
let inFlight: Promise<PriceSnapshot> | null = null;

/**
 * @param maxAgeMs how stale a cached snapshot may be. Pass 0 to force a live read.
 *
 * Recording a guess must use a live price. With a cached one, a player watching the real
 * feed could wait for a jump and then guess against a price the server recorded seconds
 * before it — the direction would already be known. Reads that only *display* or resolve a
 * price can use the cache, because there is nothing to gain from a value the player cannot
 * choose.
 */
export async function getPriceSnapshot(maxAgeMs = CACHE_TTL_MS): Promise<PriceSnapshot> {
  if (cached && Date.now() - cachedAt < maxAgeMs) {
    return cached;
  }

  // Concurrent callers on a cold cache share one upstream request rather than racing.
  inFlight ??= fetchSpotPrice().then(
    (snapshot) => {
      cached = snapshot;
      cachedAt = Date.now();
      inFlight = null;
      return snapshot;
    },
    (error: unknown) => {
      inFlight = null;
      throw error;
    },
  );

  return inFlight;
}

async function fetchSpotPrice(): Promise<PriceSnapshot> {
  let response: Response;
  try {
    response = await fetch(COINBASE_SPOT_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    throw new PriceUnavailableError(error);
  }

  if (!response.ok) {
    throw new PriceUnavailableError(new Error(`Coinbase responded ${response.status}`));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new PriceUnavailableError(error);
  }

  const amount = (body as { data?: { amount?: unknown } } | null)?.data?.amount;
  const parsed = typeof amount === "string" ? Number.parseFloat(amount) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PriceUnavailableError(new Error(`Unusable price in response: ${String(amount)}`));
  }

  return {
    symbol: "BTC-USD",
    price: Math.round(parsed * 100) / 100,
    asOf: new Date().toISOString(),
  };
}
