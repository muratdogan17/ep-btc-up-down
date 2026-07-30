import type { PriceSnapshot } from "@/lib/price";
import { pendingReason, RESOLUTION_DELAY_MS } from "@/lib/resolve-guess";
import type { ActiveGuess, Player, ResolvedGuess } from "@/lib/store";

/**
 * How long the guess has been open, measured between two price observations rather than
 * against `Date.now()`.
 *
 * Both ends are server-side readings of the price feed, so the 60-second window is measured
 * on the same clock that produced the prices — and the price used to resolve was necessarily
 * observed at least that long after the price used for the guess.
 */
export function elapsedMsFor(guess: ActiveGuess, price: PriceSnapshot): number {
  return Date.parse(price.asOf) - Date.parse(guess.createdAt);
}

/** The pending shape from the API contract: says what is happening and why. */
export function serializePendingGuess(guess: ActiveGuess, elapsedMs: number) {
  return {
    guessId: guess.guessId,
    direction: guess.direction,
    priceAtGuess: guess.priceAtGuess,
    createdAt: guess.createdAt,
    status: "pending" as const,
    pendingReason: pendingReason(elapsedMs),
    secondsElapsed: Math.max(0, Math.floor(elapsedMs / 1000)),
    resolvesNoEarlierThan: new Date(
      Date.parse(guess.createdAt) + RESOLUTION_DELAY_MS,
    ).toISOString(),
  };
}

export function serializeResolvedGuess(resolved: ResolvedGuess) {
  return {
    guessId: resolved.guessId,
    direction: resolved.direction,
    priceAtGuess: resolved.priceAtGuess,
    priceAtResolution: resolved.priceAtResolution,
    outcome: resolved.outcome,
    scoreDelta: resolved.scoreDelta,
    resolvedAt: resolved.resolvedAt,
  };
}

/** Everything the UI needs for one frame, from one consistent read. */
export function serializePlayerState(player: Player, price: PriceSnapshot) {
  const activeGuess = player.activeGuess;

  return {
    playerId: player.playerId,
    score: player.score,
    canGuess: !activeGuess,
    activeGuess: activeGuess
      ? serializePendingGuess(activeGuess, elapsedMsFor(activeGuess, price))
      : null,
    lastResolvedGuess: player.lastResolvedGuess
      ? serializeResolvedGuess(player.lastResolvedGuess)
      : null,
    price,
  };
}
