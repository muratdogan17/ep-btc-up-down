import { NextResponse } from "next/server";

import { elapsedMsFor, serializePlayerState } from "@/lib/game";
import { internalError, playerNotFound, priceUnavailable } from "@/lib/http";
import { getPriceSnapshot, PriceUnavailableError } from "@/lib/price";
import { resolveGuess, scoreDeltaFor } from "@/lib/resolve-guess";
import type { Player, ResolvedGuess } from "@/lib/store";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Everything the UI needs for one frame: score, guess state, and the price snapshot that
 * guess state was evaluated against. One poll, one consistent view.
 *
 * This is also where a due guess is resolved. Resolution is lazy — it happens when somebody
 * reads the player, not on a schedule — which means this GET can change state. That is a
 * deliberate trade documented in docs/api.md, not an accident: the client polls this
 * endpoint anyway, so a separate resolve call would add a round trip and change nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;

  try {
    let player = await store.getPlayer(playerId);
    if (!player) {
      return playerNotFound();
    }

    const price = await getPriceSnapshot();
    player = await resolveIfDue(player, price);

    return NextResponse.json(serializePlayerState(player, price));
  } catch (error) {
    if (error instanceof PriceUnavailableError) {
      return priceUnavailable();
    }
    return internalError(`GET /api/players/${playerId} failed`, error);
  }
}

async function resolveIfDue(
  player: Player,
  price: Awaited<ReturnType<typeof getPriceSnapshot>>,
): Promise<Player> {
  const guess = player.activeGuess;
  if (!guess) return player;

  const outcome = resolveGuess({
    direction: guess.direction,
    priceAtGuess: guess.priceAtGuess,
    currentPrice: price.price,
    elapsedMs: elapsedMsFor(guess, price),
  });

  if (outcome === "pending") return player;

  const resolved: ResolvedGuess = {
    ...guess,
    priceAtResolution: price.price,
    outcome,
    scoreDelta: scoreDeltaFor(outcome),
    // The observation that decided the guess is also its resolution time.
    resolvedAt: price.asOf,
  };

  return store.resolveActiveGuess(player.playerId, resolved);
}
