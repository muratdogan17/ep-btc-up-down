import { NextResponse } from "next/server";

import { internalError, playerNotFound, priceUnavailable } from "@/lib/http";
import { getPriceSnapshot, PriceUnavailableError } from "@/lib/price";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Everything the UI needs for one frame: score, guess state, and the price snapshot that
 * guess state was evaluated against. One poll, one consistent view.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;

  try {
    const player = await store.getPlayer(playerId);
    if (!player) {
      return playerNotFound();
    }

    const price = await getPriceSnapshot();

    return NextResponse.json({
      playerId: player.playerId,
      score: player.score,
      // Guessing is not implemented yet, so there is never a pending guess to report.
      canGuess: true,
      activeGuess: null,
      lastResolvedGuess: null,
      price,
    });
  } catch (error) {
    if (error instanceof PriceUnavailableError) {
      return priceUnavailable();
    }
    return internalError(`GET /api/players/${playerId} failed`, error);
  }
}
