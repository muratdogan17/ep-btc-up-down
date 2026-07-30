import { NextResponse } from "next/server";

import { internalError } from "@/lib/http";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Creates an anonymous player. The id is generated server-side; there is no auth. */
export async function POST() {
  try {
    const player = await store.createPlayer();

    return NextResponse.json(
      {
        playerId: player.playerId,
        score: player.score,
        activeGuess: null,
        createdAt: player.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    return internalError("POST /api/players failed", error);
  }
}
