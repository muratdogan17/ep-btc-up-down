"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PriceSnapshot } from "@/lib/price";
import type { Direction, GuessOutcome, PendingReason } from "@/lib/resolve-guess";

/**
 * The player's identity is an opaque id the server generated, kept in localStorage so the
 * same browser comes back to the same score. Everything else — score, guess state — is
 * read from the server on every poll, because the server is the source of truth.
 */
const STORAGE_KEY = "btc-up-down.playerId";

/** Faster while a guess is open, so the countdown stays honest. */
const POLL_PENDING_MS = 2_000;
const POLL_IDLE_MS = 5_000;

export type PendingGuess = {
  guessId: string;
  direction: Direction;
  priceAtGuess: number;
  createdAt: string;
  status: "pending";
  pendingReason: PendingReason;
  secondsElapsed: number;
  resolvesNoEarlierThan: string;
};

export type ResolvedGuessView = {
  guessId: string;
  direction: Direction;
  priceAtGuess: number;
  priceAtResolution: number;
  outcome: GuessOutcome;
  scoreDelta: number;
  resolvedAt: string;
};

export type PlayerState = {
  playerId: string;
  score: number;
  canGuess: boolean;
  activeGuess: PendingGuess | null;
  lastResolvedGuess: ResolvedGuessView | null;
  price: PriceSnapshot;
};

export function usePlayer() {
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // One identity request per mount, even though React's dev-mode double-invoke runs the
  // effect twice. Without this, a first visit creates two players and orphans one.
  const identity = useRef<Promise<string> | null>(null);

  const playerId = useCallback(async (): Promise<string> => {
    identity.current ??= (async () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) return stored;

      const response = await fetch("/api/players", { method: "POST" });
      if (!response.ok) {
        throw new Error(`POST /api/players responded ${response.status}`);
      }

      const created = (await response.json()) as { playerId: string };
      window.localStorage.setItem(STORAGE_KEY, created.playerId);
      return created.playerId;
    })().catch((cause: unknown) => {
      identity.current = null; // let the next poll retry
      throw cause;
    });

    return identity.current;
  }, []);

  const refresh = useCallback(async () => {
    try {
      let id = await playerId();
      let response = await fetch(`/api/players/${id}`, { cache: "no-store" });

      if (response.status === 404) {
        // The stored id no longer exists server-side. Start a fresh player rather than
        // leaving the player staring at an error they cannot act on.
        window.localStorage.removeItem(STORAGE_KEY);
        identity.current = null;
        id = await playerId();
        response = await fetch(`/api/players/${id}`, { cache: "no-store" });
      }

      if (!response.ok) {
        throw new Error(`GET /api/players/${id} responded ${response.status}`);
      }

      setState((await response.json()) as PlayerState);
      setError(null);
    } catch {
      setError("Can't reach the game right now. Retrying…");
    }
  }, [playerId]);

  const submitGuess = useCallback(
    async (direction: Direction) => {
      setSubmitting(true);
      try {
        const id = await playerId();
        const response = await fetch(`/api/players/${id}/guesses`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ direction }),
        });

        // 409 means the server already has a pending guess for this player — the refresh
        // below will show it, so there is nothing to report as an error.
        if (response.ok || response.status === 409) {
          setError(null);
        } else {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          setError(body?.message ?? "Couldn't place that guess. Please try again.");
        }
      } catch {
        setError("Couldn't place that guess. Please try again.");
      } finally {
        setSubmitting(false);
        // Never derive the new state locally: re-read it from the server.
        await refresh();
      }
    },
    [playerId, refresh],
  );

  const pollIntervalMs = state?.activeGuess ? POLL_PENDING_MS : POLL_IDLE_MS;

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollIntervalMs);
    return () => clearInterval(timer);
  }, [refresh, pollIntervalMs]);

  return { state, error, submitting, submitGuess };
}
