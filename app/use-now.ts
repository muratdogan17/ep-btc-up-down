"use client";

import { useEffect, useState } from "react";

/**
 * Re-renders once a second so countdowns and "updated N seconds ago" stay live between
 * polls.
 *
 * The clock is only ever used for *display*. Every deadline it counts towards is an absolute
 * timestamp the server issued, and no outcome is decided here — the server resolves guesses.
 */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
