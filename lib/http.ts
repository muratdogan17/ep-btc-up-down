import { NextResponse } from "next/server";

/**
 * Every error the API returns has the same shape, so a client can handle failures without
 * pattern-matching on prose:
 *
 *   { "error": "snake_case_code", "message": "Human readable." }
 */
export type ApiErrorCode =
  | "invalid_request"
  | "invalid_direction"
  | "player_not_found"
  | "guess_already_pending"
  | "price_unavailable"
  | "internal_error";

export function apiError(code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json({ error: code, message }, { status });
}

export const priceUnavailable = () =>
  apiError(
    "price_unavailable",
    502,
    "The BTC price source is unavailable right now. Please try again shortly.",
  );

export const playerNotFound = () =>
  apiError("player_not_found", 404, "We couldn't find that player. Start a new game.");

/** Logs the cause and returns a response that leaks nothing about it. */
export function internalError(context: string, cause: unknown) {
  console.error(context, cause);
  return apiError("internal_error", 500, "Something went wrong on our side.");
}
