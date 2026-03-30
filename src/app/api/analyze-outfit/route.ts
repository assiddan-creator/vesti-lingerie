import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { imageBase64, mediaType } = await req.json();

  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const safeMediaType = allowedTypes.includes(mediaType) ? mediaType : "image/jpeg";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: safeMediaType, data: imageBase64 },
            },
            {
              type: "text",
              text: "You are a fashion expert. Analyze this clothing item and return ONLY a JSON object with: item, style, color, material, occasion, searchQuery (5-8 words for Google Shopping), asosQuery (3-5 words). No markdown, no explanation.",
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  return NextResponse.json(data);
}
