"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PriceSnapshot } from "@/lib/price";
import { RESOLUTION_DELAY_MS } from "@/lib/resolve-guess";
import type { Direction, GuessOutcome, PendingReason } from "@/lib/resolve-guess";

/**
 * The player's identity is an opaque id the server generated, kept in localStorage so the
 * same browser comes back to the same score. Everything else — score, guess state — is
 * read from the server on every poll, because the server is the source of truth.
 */
const STORAGE_KEY = "btc-up-down.playerId";

/** Faster while a guess is open, so a resolution shows up promptly. */
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
  createdAt: string;
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

export type CountdownAnchor = {
  guessId: string;
  /** What the server said was left, at the moment we anchored. */
  remainingMsAtAnchor: number;
  /** Local clock reading at that moment — used only as a delta. */
  anchoredAt: number;
};

export type PriceAgeAnchor = {
  /** How old the snapshot already was when it reached us, measured server-side. */
  ageAtReceiptMs: number;
  receivedAt: number;
};

export type GameError = {
  /**
   * `price_unavailable` — the third party is down, so no guess can be priced or resolved.
   * `unreachable` — our own API or the network is unavailable.
   */
  code: "price_unavailable" | "unreachable";
  message: string;
};

export function usePlayer() {
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<GameError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isNewPlayer, setIsNewPlayer] = useState(false);

  /**
   * The countdown is a *duration*, anchored once per guess and then counted on the local
   * clock. It deliberately never compares a server timestamp with a browser timestamp.
   *
   * The earlier version did: it treated `price.asOf` as "now on the server" and re-derived a
   * clock offset on every poll. But `asOf` is when the price was *observed*, and the 2-second
   * cache means it is anywhere from 0 to 2 seconds old — so every poll re-anchored the clock
   * somewhere new and the countdown visibly stepped backwards (31, 30, 31, 30…). The server's
   * own `secondsElapsed` is quantised the same way, for the same reason.
   *
   * Anchoring once removes both problems and, as a side effect, makes a wrong browser clock
   * irrelevant: only elapsed local time is used, never absolute local time.
   */
  const [countdown, setCountdown] = useState<CountdownAnchor | null>(null);

  /**
   * Price age has to reset when a new snapshot arrives, so it *is* re-anchored every poll —
   * but still without comparing clocks. `Date` (server time at response) minus `asOf` (server
   * time of observation) gives the true age at receipt from two server-side readings; local
   * time only measures how long ago we received it.
   */
  const [priceAge, setPriceAge] = useState<PriceAgeAnchor | null>(null);

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
      setIsNewPlayer(true);
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

      if (response.status === 502) {
        // The price source is down. Keep the last known state on screen: the score and any
        // pending guess are safe on the server, and nothing here is stale enough to mislead.
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError({
          code: "price_unavailable",
          message: body?.message ?? "The BTC price source is unavailable right now.",
        });
        return;
      }

      if (!response.ok) {
        throw new Error(`GET /api/players/${id} responded ${response.status}`);
      }

      const next = (await response.json()) as PlayerState;
      const receivedAt = Date.now();
      setState(next);

      const serverDate = response.headers.get("date");
      setPriceAge({
        ageAtReceiptMs: serverDate
          ? Math.max(0, Date.parse(serverDate) - Date.parse(next.price.asOf))
          : 0,
        receivedAt,
      });

      setCountdown((current) => {
        const guess = next.activeGuess;
        if (!guess) return null;
        // Never re-anchor mid-guess: that is what made the countdown jump backwards.
        if (current?.guessId === guess.guessId) return current;

        return {
          guessId: guess.guessId,
          remainingMsAtAnchor: Math.max(
            0,
            RESOLUTION_DELAY_MS - guess.secondsElapsed * 1_000,
          ),
          anchoredAt: receivedAt,
        };
      });

      setError(null);
    } catch {
      setError({
        code: "unreachable",
        message: "Can't reach the game right now. Retrying…",
      });
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
          const body = (await response.json().catch(() => null)) as {
            error?: string;
            message?: string;
          } | null;
          setError({
            code: body?.error === "price_unavailable" ? "price_unavailable" : "unreachable",
            message: body?.message ?? "Couldn't place that guess. Please try again.",
          });
        }
      } catch {
        setError({
          code: "unreachable",
          message: "Couldn't place that guess. Please try again.",
        });
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

  return { state, error, submitting, submitGuess, countdown, priceAge, isNewPlayer };
}
