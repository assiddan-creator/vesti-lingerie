import { NextRequest, NextResponse } from "next/server";
import type { BodyKeypoints } from "../../../lib/body-scan";

function jsonError(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json(
    { success: false, error: { message, ...(details ? { details } : {}) } },
    { status },
  );
}

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function parseKeypoints(raw: unknown): BodyKeypoints | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pt = (v: unknown) => {
    if (!v || typeof v !== "object") return null;
    const p = v as Record<string, unknown>;
    const x = typeof p.x === "number" ? p.x : Number(p.x);
    const y = typeof p.y === "number" ? p.y : Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: clamp01(x), y: clamp01(y) };
  };
  const ls = pt(o.leftShoulder);
  const rs = pt(o.rightShoulder);
  const bust = pt(o.bust);
  const waist = pt(o.waist);
  const hips = pt(o.hips);
  if (!ls || !rs || !bust || !waist || !hips) return null;
  return { leftShoulder: ls, rightShoulder: rs, bust, waist, hips };
}

const VISION_PROMPT = `You are a computer-vision assistant for a luxury lingerie virtual try-on app.

Analyze this photograph of a person (full-body or partial). Estimate:

1) Normalized keypoint positions as fractions of image width (x) and height (y), origin top-left, range 0 to 1:
   - leftShoulder, rightShoulder (joint centers)
   - bust (center of chest / bra line)
   - waist (narrowest torso)
   - hips (hip line for lingerie)

2) Approximate body measurements in centimeters (reasonable estimates from visible proportions): shouldersCm, bustCm, waistCm, hipsCm (numbers or null if not inferable).

3) recommendedBraSize: US-style band + cup (e.g. "34C") as your best estimate from the image, or "—" if not inferable.

4) confidence: "high", "medium", or "low"

5) bodyAnalysis: one short sentence describing what you inferred.

Return ONLY valid JSON, no markdown:
{
  "keypoints": {
    "leftShoulder": {"x": number, "y": number},
    "rightShoulder": {"x": number, "y": number},
    "bust": {"x": number, "y": number},
    "waist": {"x": number, "y": number},
    "hips": {"x": number, "y": number}
  },
  "shouldersCm": number | null,
  "bustCm": number | null,
  "waistCm": number | null,
  "hipsCm": number | null,
  "recommendedBraSize": string,
  "confidence": "high" | "medium" | "low",
  "bodyAnalysis": string
}`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonError("Server is missing ANTHROPIC_API_KEY for body scan vision.", 503);
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return jsonError("Expected multipart/form-data with field \"image\".", 415);
    }

    const form = await req.formData();
    const image = form.get("image");
    if (!isFile(image)) {
      return jsonError("Missing image file.", 400);
    }
    if (!image.type.startsWith("image/")) {
      return jsonError("File must be an image.", 415);
    }
    if (image.size === 0) {
      return jsonError("Empty image.", 400);
    }

    const buf = Buffer.from(await image.arrayBuffer());
    const base64 = buf.toString("base64");
    const mediaType =
      image.type === "image/png" || image.type === "image/webp" || image.type === "image/gif"
        ? image.type
        : "image/jpeg";

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              { type: "text", text: VISION_PROMPT },
            ],
          },
        ],
      }),
    });

    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      return jsonError(data.error?.message ?? `Anthropic request failed (${res.status})`, res.status >= 400 ? res.status : 502);
    }

    const text = data.content?.[0]?.text ?? "";
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return jsonError("Could not parse vision JSON.", 502, { rawPreview: clean.slice(0, 500) });
    }

    const p = parsed as Record<string, unknown>;
    const keypoints = parseKeypoints(p.keypoints);
    if (!keypoints) {
      return jsonError("Invalid keypoints in vision response.", 502);
    }

    const fmt = (cm: unknown, suffix: string) => {
      if (typeof cm !== "number" || !Number.isFinite(cm)) return "—";
      return `${Math.round(cm * 10) / 10}${suffix}`;
    };

    const measurementValues: [string, string, string, string] = [
      fmt(p.shouldersCm, " cm"),
      fmt(p.bustCm, " cm"),
      fmt(p.waistCm, " cm"),
      fmt(p.hipsCm, " cm"),
    ];

    const recommendedBraSize =
      typeof p.recommendedBraSize === "string" && p.recommendedBraSize.trim().length > 0
        ? p.recommendedBraSize.trim()
        : "—";

    const confidence =
      p.confidence === "high" || p.confidence === "medium" || p.confidence === "low"
        ? p.confidence
        : "medium";

    const bodyAnalysis = typeof p.bodyAnalysis === "string" ? p.bodyAnalysis.trim() : null;

    return NextResponse.json({
      success: true,
      keypoints,
      measurementValues,
      recommendedBraSize,
      bodyAnalysis,
      confidence,
    });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Body scan failed.", 500);
  }
}
