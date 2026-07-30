import { NextResponse } from "next/server";

import { getPriceSnapshot, PriceUnavailableError } from "@/lib/price";

// A price must never be served from Next's build-time or route cache.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getPriceSnapshot());
  } catch (error) {
    if (error instanceof PriceUnavailableError) {
      return NextResponse.json(
        {
          error: "price_unavailable",
          message: "The BTC price source is unavailable right now. Please try again shortly.",
        },
        { status: 502 },
      );
    }

    console.error("GET /api/price failed", error);
    return NextResponse.json(
      { error: "internal_error", message: "Something went wrong on our side." },
      { status: 500 },
    );
  }
}
