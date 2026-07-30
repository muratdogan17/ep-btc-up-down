import { describe, expect, it } from "vitest";

import {
  pendingReason,
  RESOLUTION_DELAY_MS,
  resolveGuess,
  scoreDeltaFor,
} from "@/lib/resolve-guess";

const AFTER_60S = RESOLUTION_DELAY_MS;
const BEFORE_60S = RESOLUTION_DELAY_MS - 1;

describe("resolveGuess", () => {
  describe("both conditions met", () => {
    it("up wins when the price rose", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000,
          currentPrice: 100_000.01,
          elapsedMs: AFTER_60S,
        }),
      ).toBe("win");
    });

    it("down wins when the price fell", () => {
      expect(
        resolveGuess({
          direction: "down",
          priceAtGuess: 100_000,
          currentPrice: 99_999.99,
          elapsedMs: AFTER_60S,
        }),
      ).toBe("win");
    });

    it("up loses when the price fell", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000,
          currentPrice: 99_500,
          elapsedMs: AFTER_60S,
        }),
      ).toBe("loss");
    });

    it("down loses when the price rose", () => {
      expect(
        resolveGuess({
          direction: "down",
          priceAtGuess: 100_000,
          currentPrice: 100_500,
          elapsedMs: AFTER_60S,
        }),
      ).toBe("loss");
    });
  });

  describe("time alone is not enough", () => {
    it("stays pending when the price has not moved, however long it has been", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000,
          currentPrice: 100_000,
          elapsedMs: 60 * 60 * 1000,
        }),
      ).toBe("pending");
    });
  });

  describe("a price change alone is not enough", () => {
    it("stays pending under 60 seconds even on a big move", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000,
          currentPrice: 120_000,
          elapsedMs: BEFORE_60S,
        }),
      ).toBe("pending");
    });
  });

  describe("the 60 second boundary", () => {
    it("is inclusive: exactly 60s resolves", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000,
          currentPrice: 100_001,
          elapsedMs: RESOLUTION_DELAY_MS,
        }),
      ).toBe("win");
    });

    it("one millisecond earlier does not", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000,
          currentPrice: 100_001,
          elapsedMs: RESOLUTION_DELAY_MS - 1,
        }),
      ).toBe("pending");
    });
  });

  describe("'changed' means changed in cents", () => {
    it("treats sub-cent differences as no change", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000.001,
          currentPrice: 100_000.004,
          elapsedMs: AFTER_60S,
        }),
      ).toBe("pending");
    });

    it("resolves on a one cent move", () => {
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 100_000.0,
          currentPrice: 100_000.01,
          elapsedMs: AFTER_60S,
        }),
      ).toBe("win");
    });

    it("is not fooled by floating point noise", () => {
      // 0.1 + 0.2 !== 0.3 in binary floating point; in cents both are 30.
      expect(
        resolveGuess({
          direction: "up",
          priceAtGuess: 0.1 + 0.2,
          currentPrice: 0.3,
          elapsedMs: AFTER_60S,
        }),
      ).toBe("pending");
    });
  });
});

describe("pendingReason", () => {
  it("blames the clock before 60 seconds", () => {
    expect(pendingReason(BEFORE_60S)).toBe("waiting_for_time");
  });

  it("blames the flat price once 60 seconds have passed", () => {
    expect(pendingReason(AFTER_60S)).toBe("waiting_for_price_change");
  });
});

describe("scoreDeltaFor", () => {
  it("is +1 for a win and -1 for a loss", () => {
    expect(scoreDeltaFor("win")).toBe(1);
    expect(scoreDeltaFor("loss")).toBe(-1);
  });
});
