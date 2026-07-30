import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { serializePendingGuess } from "@/lib/game";
import { apiError, internalError, playerNotFound, priceUnavailable } from "@/lib/http";
import { getPriceSnapshot, PriceUnavailableError } from "@/lib/price";
import type { ActiveGuess } from "@/lib/store";
import { GuessAlreadyPendingError, PlayerNotFoundError, store } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The client sends a direction. That is the whole of its input: the price and the timestamp
 * are read here, server-side, from the price feed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;

  let direction: unknown;
  try {
    const body = (await request.json()) as { direction?: unknown } | null;
    direction = body?.direction;
  } catch {
    return apiError("invalid_request", 400, 'Send a JSON body like { "direction": "up" }.');
  }

  if (direction !== "up" && direction !== "down") {
    return apiError("invalid_direction", 400, 'direction must be either "up" or "down".');
  }

  try {
    // Live price, not a cached one: see the note on getPriceSnapshot.
    const price = await getPriceSnapshot(0);

    const guess: ActiveGuess = {
      guessId: randomUUID(),
      direction,
      priceAtGuess: price.price,
      createdAt: price.asOf,
    };

    // A guess is never recorded without a price, so there is no guess that cannot be
    // resolved later.
    await store.addGuess(playerId, guess);

    return NextResponse.json(serializePendingGuess(guess, 0), { status: 201 });
  } catch (error) {
    if (error instanceof PriceUnavailableError) return priceUnavailable();
    if (error instanceof PlayerNotFoundError) return playerNotFound();
    if (error instanceof GuessAlreadyPendingError) {
      return apiError(
        "guess_already_pending",
        409,
        "You already have a pending guess. Wait for it to resolve before guessing again.",
      );
    }
    return internalError(`POST /api/players/${playerId}/guesses failed`, error);
  }
}
