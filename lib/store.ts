/**
 * The only module that knows where data lives.
 *
 * Everything above this file works with `Player` and the `Store` interface, so swapping
 * DynamoDB for something else is a change confined to this directory.
 */

import { randomUUID } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { sharedMemoryStore } from "@/lib/store.memory";

export type Player = {
  playerId: string;
  score: number;
  createdAt: string;
  updatedAt: string;
};

export interface Store {
  createPlayer(): Promise<Player>;
  getPlayer(playerId: string): Promise<Player | null>;
}

const TABLE_NAME = process.env.PLAYERS_TABLE_NAME ?? "btc-up-down-players";

function createDynamoStore(): Store {
  // Region and credentials come from the ambient environment: `~/.aws` locally, the
  // execution role on Amplify. The app never holds a long-lived credential.
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

    async getPlayer(playerId) {
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
  };
}

/**
 * `STORE_DRIVER=memory` runs the whole app without an AWS account — useful for reviewing
 * this repo, and it is the implementation the tests exercise.
 */
export const store: Store =
  process.env.STORE_DRIVER === "memory" ? sharedMemoryStore() : createDynamoStore();
