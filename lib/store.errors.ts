/**
 * Store failures that callers are expected to handle, in their own module so both store
 * implementations can import them without a cycle.
 */

export class PlayerNotFoundError extends Error {
  constructor(playerId: string) {
    super(`No player with id ${playerId}`);
    this.name = "PlayerNotFoundError";
  }
}

export class GuessAlreadyPendingError extends Error {
  constructor() {
    super("That player already has a pending guess");
    this.name = "GuessAlreadyPendingError";
  }
}
