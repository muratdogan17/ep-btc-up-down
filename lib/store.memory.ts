import { randomUUID } from "node:crypto";

// Type-only import, so there is no runtime cycle with lib/store.ts.
import type { Player, Store } from "@/lib/store";

/**
 * In-process implementation of the same contract as the DynamoDB store.
 *
 * Pass no argument and you get an isolated Map — that is what the tests want.
 */
export function createMemoryStore(players = new Map<string, Player>()): Store {
  return {
    async createPlayer() {
      const now = new Date().toISOString();
      const player: Player = {
        playerId: randomUUID(),
        score: 0,
        createdAt: now,
        updatedAt: now,
      };

      players.set(player.playerId, player);
      return { ...player };
    },

    async getPlayer(playerId) {
      const player = players.get(playerId);
      return player ? { ...player } : null;
    },
  };
}

/**
 * Next compiles every route into its own bundle, so module-level state is *not* shared
 * between `/api/players` and `/api/players/[playerId]` — each would get its own Map and a
 * player created by one route would be invisible to the other. Parking the Map on
 * globalThis is the standard Next workaround (the same trick used for database clients) and
 * it also survives hot reloads in dev.
 *
 * This only concerns the memory driver. DynamoDB has no such problem: the state is not in
 * the process to begin with, which is rather the point of using a data store.
 */
const globalForStore = globalThis as typeof globalThis & {
  __btcUpDownPlayers?: Map<string, Player>;
};

export function sharedMemoryStore(): Store {
  globalForStore.__btcUpDownPlayers ??= new Map<string, Player>();
  return createMemoryStore(globalForStore.__btcUpDownPlayers);
}
