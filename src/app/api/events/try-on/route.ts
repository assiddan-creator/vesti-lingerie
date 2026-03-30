import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type TryOnPayload = {
  productId?: unknown;
  userFitPreference?: unknown;
  originalUserImageUrl?: unknown;
  matchConfidence?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TryOnPayload;

    const productIdRaw = body.productId;
    const productId =
      typeof productIdRaw === "string" && productIdRaw.trim() !== "" ? productIdRaw.trim() : undefined;

    const fitRaw = body.userFitPreference;
    const userFitPreference =
      typeof fitRaw === "string" && fitRaw.trim() !== "" ? fitRaw.trim() : "Regular";

    const urlRaw = body.originalUserImageUrl;
    const originalUserImageUrl =
      typeof urlRaw === "string" && urlRaw.trim() !== "" ? urlRaw.trim() : undefined;

    let matchConfidence: number | undefined;
    if (body.matchConfidence != null && body.matchConfidence !== "") {
      const n = Number(body.matchConfidence);
      if (Number.isFinite(n)) matchConfidence = n;
    }

    const event = await db.tryOnEvent.create({
      data: {
        productId: productId ?? null,
        userFitPreference,
        originalUserImageUrl: originalUserImageUrl ?? null,
        matchConfidence: matchConfidence ?? null,
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
