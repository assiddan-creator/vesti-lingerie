import { NextRequest, NextResponse } from "next/server";

type VisionAnnotateResponse = {
  responses?: Array<{
    error?: { code?: number; message?: string };
    labelAnnotations?: Array<{ description?: string; score?: number }>;
    localizedObjectAnnotations?: Array<{ name?: string; score?: number }>;
    webDetection?: {
      webEntities?: Array<{ description?: string; score?: number }>;
      bestGuessLabels?: Array<{ label?: string }>;
      pagesWithMatchingImages?: Array<{ pageTitle?: string; url?: string }>;
      visuallySimilarImages?: unknown;
    };
  }>;
};

function stripDataUrlToRawBase64(input: string): string {
  const trimmed = input.trim();
  const m = /^data:[^;]+;base64,([\s\S]+)$/.exec(trimmed);
  const raw = m ? m[1] : trimmed;
  return raw.replace(/\s/g, "");
}

function buildVisionSummary(v: VisionAnnotateResponse): Record<string, unknown> {
  const r = v.responses?.[0];
  if (!r || r.error) {
    return { error: r?.error?.message ?? "No vision response" };
  }
  return {
    labels: (r.labelAnnotations ?? [])
      .slice(0, 25)
      .map((x) => ({ description: x.description, score: x.score })),
    objects: (r.localizedObjectAnnotations ?? [])
      .slice(0, 10)
      .map((x) => ({ name: x.name, score: x.score })),
    web: {
      bestGuessLabels: r.webDetection?.bestGuessLabels,
      webEntities: (r.webDetection?.webEntities ?? [])
        .slice(0, 15)
        .map((x) => ({ description: x.description, score: x.score })),
      pageTitles: (r.webDetection?.pagesWithMatchingImages ?? [])
        .slice(0, 8)
        .map((p) => p.pageTitle)
        .filter(Boolean),
    },
  };
}

async function callGoogleVision(imageBase64Raw: string, apiKey: string): Promise<VisionAnnotateResponse> {
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64Raw },
          features: [
            { type: "LABEL_DETECTION", maxResults: 25 },
            { type: "OBJECT_LOCALIZATION", maxResults: 10 },
            { type: "WEB_DETECTION", maxResults: 10 },
          ],
        },
      ],
    }),
  });

  const data = (await res.json()) as VisionAnnotateResponse;
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } }).error?.message ?? res.statusText;
    throw new Error(`Google Vision API error: ${msg}`);
  }
  const err = data.responses?.[0]?.error;
  if (err?.message) {
    throw new Error(`Google Vision: ${err.message}`);
  }
  return data;
}

async function generateShoppingQueryFromVision(visionSummary: Record<string, unknown>, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: `You are a shopping search expert. Below is structured output from Google Cloud Vision (labels, localized objects, and web detection) for a fashion/clothing photo.

Your task: output EXACTLY ONE line containing a 3–6 word English search query optimized for Google Shopping. Focus on garment type, color, material, and style when visible. No brand names unless Vision strongly implies them. No quotes, no punctuation at the end, no explanation.

Vision data (JSON):
${JSON.stringify(visionSummary, null, 2)}`,
        },
      ],
    }),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    content?: Array<{ type: string; text?: string }>;
  };

  if (!res.ok) {
    throw new Error(data.error?.message ?? `Anthropic API error (${res.status})`);
  }

  const text = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const cleaned = line.replace(/^["']|["']$/g, "").trim();
  if (!cleaned) {
    throw new Error("Claude returned an empty search query.");
  }
  return cleaned.slice(0, 200);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    searchQuery?: string;
    imageBase64?: string;
  };

  const imageBase64 =
    typeof body.imageBase64 === "string" && body.imageBase64.replace(/\s/g, "").length > 0
      ? body.imageBase64
      : null;

  if (!imageBase64) {
    return NextResponse.json(
      {
        error: "imageBase64 is required (non-empty data URL or raw base64).",
        generatedQuery: null,
        shoppingResults: [],
      },
      { status: 400 },
    );
  }

  const visionKey = process.env.GOOGLE_VISION_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serpKey = process.env.SERP_API_KEY;

  if (!visionKey) {
    return NextResponse.json(
      { error: "GOOGLE_VISION_API_KEY is not configured", generatedQuery: null, shoppingResults: [] },
      { status: 500 },
    );
  }
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured", generatedQuery: null, shoppingResults: [] },
      { status: 500 },
    );
  }
  if (!serpKey) {
    return NextResponse.json(
      { error: "SERP_API_KEY is not configured", generatedQuery: null, shoppingResults: [] },
      { status: 500 },
    );
  }

  try {
    const rawBase64 = stripDataUrlToRawBase64(imageBase64);

    const visionJson = await callGoogleVision(rawBase64, visionKey);
    const visionSummary = buildVisionSummary(visionJson);

    if ("error" in visionSummary && Object.keys(visionSummary).length <= 1) {
      return NextResponse.json(
        {
          error: String((visionSummary as { error?: string }).error ?? "Vision analysis failed"),
          generatedQuery: null,
          shoppingResults: [],
        },
        { status: 502 },
      );
    }

    const generatedQuery = await generateShoppingQueryFromVision(visionSummary, anthropicKey);

    const params = new URLSearchParams({
      engine: "google_shopping",
      q: generatedQuery,
      api_key: serpKey,
      num: "6",
    });

    const serpRes = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const serpData = (await serpRes.json()) as { shopping_results?: unknown[]; error?: string };

    if (!serpRes.ok) {
      return NextResponse.json(
        {
          error: serpData.error ?? `SerpApi request failed (${serpRes.status})`,
          generatedQuery,
          shoppingResults: [],
        },
        { status: 502 },
      );
    }

    const shoppingResults = serpData.shopping_results?.slice(0, 6) || [];

    return NextResponse.json({ generatedQuery, shoppingResults });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Visual search pipeline failed";
    return NextResponse.json(
      { error: message, generatedQuery: null, shoppingResults: [] },
      { status: 502 },
    );
  }
}
