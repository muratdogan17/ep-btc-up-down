/**
 * The rule that decides whether a guess won or lost.
 *
 * Deliberately pure: no clock, no network, no database. Everything it needs is an
 * argument, which is what makes the one piece of logic that moves someone's score
 * testable without mocking anything.
 */

export type Direction = "up" | "down";
export type GuessOutcome = "win" | "loss";
export type ResolutionStatus = GuessOutcome | "pending";

/** Both conditions are required: this much time *and* a price change. */
export const RESOLUTION_DELAY_MS = 60_000;

export type PendingReason = "waiting_for_time" | "waiting_for_price_change";

export type ResolveGuessInput = {
  direction: Direction;
  priceAtGuess: number;
  currentPrice: number;
  elapsedMs: number;
};

export function resolveGuess({
  direction,
  priceAtGuess,
  currentPrice,
  elapsedMs,
}: ResolveGuessInput): ResolutionStatus {
  if (elapsedMs < RESOLUTION_DELAY_MS) {
    return "pending";
  }

  const before = toCents(priceAtGuess);
  const after = toCents(currentPrice);

  // A flat market keeps the guess open, however long it stays flat.
  if (after === before) {
    return "pending";
  }

  const wentUp = after > before;
  return (direction === "up") === wentUp ? "win" : "loss";
}

export function pendingReason(elapsedMs: number): PendingReason {
  return elapsedMs < RESOLUTION_DELAY_MS ? "waiting_for_time" : "waiting_for_price_change";
}

export function scoreDeltaFor(outcome: GuessOutcome): number {
  return outcome === "win" ? 1 : -1;
}

/**
 * Prices are published with two decimals, so comparing integer cents makes "the price has
 * not changed" an exact test rather than a floating-point tolerance nobody can defend.
 */
function toCents(price: number): number {
  return Math.round(price * 100);
}
