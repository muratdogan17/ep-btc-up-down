"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PriceSnapshot } from "@/lib/price";

/**
 * The player's identity is an opaque id the server generated, kept in localStorage so the
 * same browser comes back to the same score. Everything else — score, guess state — is
 * read from the server on every poll, because the server is the source of truth.
 */
const STORAGE_KEY = "btc-up-down.playerId";
const POLL_INTERVAL_MS = 5_000;

export type PlayerState = {
  playerId: string;
  score: number;
  canGuess: boolean;
  activeGuess: null;
  lastResolvedGuess: null;
  price: PriceSnapshot;
};

export function usePlayer() {
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { state, error };
}
