import { randomUUID } from "node:crypto";

// Type-only import, so there is no runtime cycle with lib/store.ts.
import type { ActiveGuess, Player, ResolvedGuess, Store } from "@/lib/store";
import { GuessAlreadyPendingError, PlayerNotFoundError } from "@/lib/store.errors";

/**
 * In-process implementation of the same contract as the DynamoDB store, including its two
 * invariants: no second guess while one is pending, and a guess resolves at most once.
 *
 * Pass no argument and you get an isolated Map — that is what the tests want.
 */
export function createMemoryStore(players = new Map<string, Player>()): Store {
  const read = (playerId: string): Player => {
    const player = players.get(playerId);
    if (!player) throw new PlayerNotFoundError(playerId);
    return player;
  };

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

    async addGuess(playerId: string, guess: ActiveGuess) {
      const player = read(playerId);
      if (player.activeGuess) throw new GuessAlreadyPendingError();

      const updated: Player = { ...player, activeGuess: guess, updatedAt: guess.createdAt };
      players.set(playerId, updated);
      return { ...updated };
    },

    async resolveActiveGuess(playerId: string, resolved: ResolvedGuess) {
      const player = read(playerId);

      // Mirrors the DynamoDB conditional write: if this guess is no longer the active one,
      // somebody already resolved it and the score must not move again.
      if (player.activeGuess?.guessId !== resolved.guessId) {
        return { ...player };
      }

      const { activeGuess: _resolved, ...rest } = player;
      const updated: Player = {
        ...rest,
        score: player.score + resolved.scoreDelta,
        lastResolvedGuess: resolved,
        updatedAt: resolved.resolvedAt,
      };

      players.set(playerId, updated);
      return { ...updated };
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
