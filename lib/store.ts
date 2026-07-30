/**
 * The only module that knows where data lives.
 *
 * Everything above this file works with `Player` and the `Store` interface, so swapping
 * DynamoDB for something else is a change confined to this directory.
 */

import { randomUUID } from "node:crypto";

import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

import type { Direction, GuessOutcome } from "@/lib/resolve-guess";
import { GuessAlreadyPendingError, PlayerNotFoundError } from "@/lib/store.errors";
import { sharedMemoryStore } from "@/lib/store.memory";

export { GuessAlreadyPendingError, PlayerNotFoundError };

export type ActiveGuess = {
  guessId: string;
  direction: Direction;
  /** The price the server observed when it recorded the guess. */
  priceAtGuess: number;
  /** The `asOf` of that same observation, so time and price come from one reading. */
  createdAt: string;
};

export type ResolvedGuess = ActiveGuess & {
  priceAtResolution: number;
  outcome: GuessOutcome;
  scoreDelta: number;
  resolvedAt: string;
};

export type Player = {
  playerId: string;
  score: number;
  createdAt: string;
  updatedAt: string;
  /** Absent means no pending guess — which is exactly the "one guess at a time" rule. */
  activeGuess?: ActiveGuess;
  lastResolvedGuess?: ResolvedGuess;
};

export interface Store {
  createPlayer(): Promise<Player>;
  getPlayer(playerId: string): Promise<Player | null>;
  /** @throws PlayerNotFoundError, GuessAlreadyPendingError */
  addGuess(playerId: string, guess: ActiveGuess): Promise<Player>;
  /**
   * Applies the score change and clears the pending guess, but only if that guess is still
   * the active one. Concurrent callers therefore cannot double-count: the first wins and
   * the rest are no-ops that return the already-resolved player.
   */
  resolveActiveGuess(playerId: string, resolved: ResolvedGuess): Promise<Player>;
}

const TABLE_NAME = process.env.PLAYERS_TABLE_NAME ?? "btc-up-down-players";

function createDynamoStore(): Store {
  // Region and credentials come from the ambient environment: `~/.aws` locally, the
  // execution role on Amplify. The app never holds a long-lived credential.
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  const readPlayer = async (playerId: string): Promise<Player | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { playerId },
        // A player polls immediately after writing, so an eventually consistent read
        // could show them a stale score. Doubling the read cost is the cheaper problem.
        ConsistentRead: true,
      }),
    );

    return toPlayer(result.Item);
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

      await client.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: player,
          ConditionExpression: "attribute_not_exists(playerId)",
        }),
      );

      return player;
    },

    getPlayer: readPlayer,

    async addGuess(playerId, guess) {
      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { playerId },
            UpdateExpression: "SET activeGuess = :guess, updatedAt = :now",
            // The database enforces "one guess at a time". Two simultaneous submissions
            // cannot both pass this check, so the 409 is a guarantee rather than a race we
            // hope to win by reading first.
            ConditionExpression:
              "attribute_exists(playerId) AND attribute_not_exists(activeGuess)",
            ExpressionAttributeValues: { ":guess": guess, ":now": guess.createdAt },
            ReturnValues: "ALL_NEW",
          }),
        );

        const player = toPlayer(result.Attributes);
        if (!player) throw new PlayerNotFoundError(playerId);
        return player;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          // One condition covers two causes; a read on this rare path tells them apart.
          const existing = await readPlayer(playerId);
          if (!existing) throw new PlayerNotFoundError(playerId);
          throw new GuessAlreadyPendingError();
        }
        throw error;
      }
    },

    async resolveActiveGuess(playerId, resolved) {
      try {
        const result = await client.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { playerId },
            UpdateExpression: [
              "SET lastResolvedGuess = :resolved, updatedAt = :now",
              "ADD score :delta",
              "REMOVE activeGuess",
            ].join(" "),
            ConditionExpression: "activeGuess.guessId = :guessId",
            ExpressionAttributeValues: {
              ":resolved": resolved,
              ":now": resolved.resolvedAt,
              ":delta": resolved.scoreDelta,
              ":guessId": resolved.guessId,
            },
            ReturnValues: "ALL_NEW",
          }),
        );

        const player = toPlayer(result.Attributes);
        if (!player) throw new PlayerNotFoundError(playerId);
        return player;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) {
          // Somebody else resolved this guess first. That is a success, not a failure:
          // return the current state rather than applying the score change twice.
          const existing = await readPlayer(playerId);
          if (!existing) throw new PlayerNotFoundError(playerId);
          return existing;
        }
        throw error;
      }
    },
  };
}

function toPlayer(item: unknown): Player | null {
  if (typeof item !== "object" || item === null) return null;

  const candidate = item as Partial<Player>;
  if (typeof candidate.playerId !== "string") return null;
  if (typeof candidate.score !== "number") return null;
  if (typeof candidate.createdAt !== "string") return null;
  if (typeof candidate.updatedAt !== "string") return null;

  return {
    playerId: candidate.playerId,
    score: candidate.score,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    ...(candidate.activeGuess ? { activeGuess: candidate.activeGuess } : {}),
    ...(candidate.lastResolvedGuess ? { lastResolvedGuess: candidate.lastResolvedGuess } : {}),
  };
}

/**
 * `STORE_DRIVER=memory` runs the whole app without an AWS account — useful for reviewing
 * this repo, and it is the implementation the tests exercise.
 */
export const store: Store =
  process.env.STORE_DRIVER === "memory" ? sharedMemoryStore() : createDynamoStore();
