import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryStore } from "@/lib/store.memory";
import type { ActiveGuess, Player, ResolvedGuess, Store } from "@/lib/store";
import { GuessAlreadyPendingError, PlayerNotFoundError } from "@/lib/store.errors";

/**
 * These cover the two invariants the game depends on. The DynamoDB implementation enforces
 * them with conditional writes; this one enforces them in code. Testing the contract here
 * keeps the suite fast and offline — the risk that remains is a divergence between the two
 * implementations, which is a trade I took knowingly.
 */

const guess = (overrides: Partial<ActiveGuess> = {}): ActiveGuess => ({
  guessId: "guess-1",
  direction: "up",
  priceAtGuess: 100_000,
  createdAt: "2026-07-30T10:00:00.000Z",
  ...overrides,
});

const resolution = (overrides: Partial<ResolvedGuess> = {}): ResolvedGuess => ({
  ...guess(),
  priceAtResolution: 100_100,
  outcome: "win",
  scoreDelta: 1,
  resolvedAt: "2026-07-30T10:01:05.000Z",
  ...overrides,
});

describe("memory store", () => {
  let store: Store;
  let player: Player;

  beforeEach(async () => {
    store = createMemoryStore();
    player = await store.createPlayer();
  });

  it("starts a new player at zero with no guess", () => {
    expect(player.score).toBe(0);
    expect(player.activeGuess).toBeUndefined();
    expect(player.lastResolvedGuess).toBeUndefined();
  });

  it("returns null for an unknown player", async () => {
    await expect(store.getPlayer("nobody")).resolves.toBeNull();
  });

  describe("one guess at a time", () => {
    it("records the first guess", async () => {
      const updated = await store.addGuess(player.playerId, guess());
      expect(updated.activeGuess).toEqual(guess());
    });

    it("rejects a second guess while one is pending", async () => {
      await store.addGuess(player.playerId, guess());

      await expect(
        store.addGuess(player.playerId, guess({ guessId: "guess-2", direction: "down" })),
      ).rejects.toBeInstanceOf(GuessAlreadyPendingError);
    });

    it("accepts a new guess once the previous one resolved", async () => {
      await store.addGuess(player.playerId, guess());
      await store.resolveActiveGuess(player.playerId, resolution());

      const updated = await store.addGuess(player.playerId, guess({ guessId: "guess-2" }));
      expect(updated.activeGuess?.guessId).toBe("guess-2");
    });

    it("rejects a guess for a player that does not exist", async () => {
      await expect(store.addGuess("nobody", guess())).rejects.toBeInstanceOf(
        PlayerNotFoundError,
      );
    });
  });

  describe("resolution applies exactly once", () => {
    it("moves the score and clears the pending guess", async () => {
      await store.addGuess(player.playerId, guess());
      const updated = await store.resolveActiveGuess(player.playerId, resolution());

      expect(updated.score).toBe(1);
      expect(updated.activeGuess).toBeUndefined();
      expect(updated.lastResolvedGuess?.outcome).toBe("win");
    });

    it("subtracts a point for a loss", async () => {
      await store.addGuess(player.playerId, guess());
      const updated = await store.resolveActiveGuess(
        player.playerId,
        resolution({ outcome: "loss", scoreDelta: -1 }),
      );

      expect(updated.score).toBe(-1);
    });

    it("does not double-count when the same guess is resolved twice", async () => {
      await store.addGuess(player.playerId, guess());

      const first = await store.resolveActiveGuess(player.playerId, resolution());
      const second = await store.resolveActiveGuess(player.playerId, resolution());

      expect(first.score).toBe(1);
      expect(second.score).toBe(1);
    });

    it("ignores a resolution for a guess that is no longer active", async () => {
      await store.addGuess(player.playerId, guess({ guessId: "current" }));

      const updated = await store.resolveActiveGuess(
        player.playerId,
        resolution({ guessId: "stale" }),
      );

      expect(updated.score).toBe(0);
      expect(updated.activeGuess?.guessId).toBe("current");
    });

    it("survives concurrent resolutions of the same guess", async () => {
      await store.addGuess(player.playerId, guess());

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.resolveActiveGuess(player.playerId, resolution()),
        ),
      );

      expect(results.map((r) => r.score)).toEqual(Array.from({ length: 8 }, () => 1));
    });
  });
});
