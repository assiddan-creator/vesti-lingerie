import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { imageBase64?: string };
  const imageBase64 =
    typeof body.imageBase64 === "string" && body.imageBase64.length > 0 ? body.imageBase64 : null;

  if (!imageBase64) {
    return NextResponse.json(
      { error: "imageBase64 is required", generatedQuery: null, shoppingResults: [] },
      { status: 400 },
    );
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serpKey = process.env.SERP_API_KEY;

  if (!anthropicKey || !serpKey) {
    return NextResponse.json(
      { error: "Missing API keys", generatedQuery: null, shoppingResults: [] },
      { status: 500 },
    );
  }

  try {
    const rawBase64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: rawBase64 },
              },
              {
                type: "text",
                text: `You are a lingerie shopping expert. Look at this lingerie or intimate apparel image carefully.

Output EXACTLY ONE line: a 4-7 word Google Shopping search query for this specific lingerie item.

Focus on: garment type (bra, bralette, bodysuit, teddy, corset, chemise, thong, panty set), color, material (lace, satin, silk, mesh, velvet), and style (push-up, wireless, strappy, floral, embroidered).

Examples:
black lace push-up bra set
red satin strappy bodysuit lingerie
pink floral lace bralette panty set
white mesh corset lingerie set

One line only. No quotes. No punctuation at end.`,
              },
            ],
          },
        ],
      }),
    });

    const claudeData = (await claudeRes.json()) as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message?: string };
    };
    if (!claudeRes.ok) throw new Error(claudeData.error?.message ?? "Claude error");

    const rawText = claudeData.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    const generatedQuery =
      rawText.split("\n")[0].replace(/^["']|["']$/g, "").trim() || "women lingerie lace set";

    const params = new URLSearchParams({
      engine: "google_shopping",
      q: generatedQuery,
      api_key: serpKey,
      num: "12",
    });
    const serpRes = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const serpData = (await serpRes.json()) as { shopping_results?: unknown[]; error?: string };

    if (!serpRes.ok) {
      return NextResponse.json(
        { error: serpData.error ?? "SerpApi failed", generatedQuery, shoppingResults: [] },
        { status: 502 },
      );
    }

    return NextResponse.json({
      generatedQuery,
      shoppingResults: serpData.shopping_results?.slice(0, 12) ?? [],
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Failed",
        generatedQuery: null,
        shoppingResults: [],
      },
      { status: 502 },
    );
  }
}
