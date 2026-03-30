import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const inFlightByRequestId = new Map<string, { startedAt: number }>();

function jsonError(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json(
    { success: false, error: { message, ...(details ? { details } : {}) } },
    { status },
  );
}

function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function isImageFile(file: File): boolean {
  return typeof file.type === "string" && file.type.startsWith("image/");
}

function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

function buildImagenPrompt(refinePrompt: string | null) {
  const basePrompt = [
    "Photorealistic virtual try-on edit using two reference images.",
    "Image A: the target person photo.",
    "Image B: the garment reference photo.",
    "",
    "Edit Image A so the person is wearing the clothing from Image B.",
    "Transfer ONLY the clothing. Do not change the person's identity.",
    "",
    "Preserve exactly: face/identity, skin texture, age, expression; hair and hairline; pose; body proportions; full-body framing; background; lighting; shadows; camera angle; and overall scene realism.",
    "Keep the full body visible and do not crop the subject. Preserve the original framing from Image A.",
    "",
    "Preserve garment details accurately: color, material, texture, pattern/print, fit, length, seams, collar/neckline, cuffs, sleeves, and any logos/graphics.",
    "Maintain natural drape and folds consistent with the pose and lighting.",
    "Avoid anatomy distortions and warping (hands, arms, shoulders, neck).",
    "",
    "Output one high-quality edited image.",
  ].join("\n");

  if (refinePrompt && refinePrompt.trim().length > 0) {
    return `${basePrompt}\n\nAdditional instruction: ${refinePrompt.trim()}\n`;
  }
  return basePrompt;
}

export async function POST(request: Request) {
  try {
    const googleApiKey = process.env.GOOGLE_AI_API_KEY;
    if (!googleApiKey) {
      return jsonError("Server is missing GOOGLE_AI_API_KEY.", 500);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return jsonError("Unsupported content type. Expected multipart/form-data.", 415, {
        received: contentType || null,
      });
    }

    const form = await request.formData();
    const target = form.get("targetImage");
    const garment = form.get("garmentImage");
    const refinePromptRaw = form.get("refinePrompt");
    const requestIdRaw = form.get("requestId");

    const requestId = typeof requestIdRaw === "string" ? requestIdRaw.trim() : "";
    if (!requestId) return jsonError("Missing requestId.", 400);

    console.log(`REQ_RECEIVED ${requestId}`);

    if (inFlightByRequestId.has(requestId)) {
      console.log(`REQ_DUPLICATE_BLOCKED ${requestId}`);
      return NextResponse.json(
        {
          success: false,
          requestId,
          duplicate: true,
          status: "processing",
          message: "Duplicate request blocked.",
        },
        { status: 202 },
      );
    }

    if (!target || !garment) {
      return jsonError("Missing required image inputs.", 400, {
        requiredFields: ["targetImage", "garmentImage"],
        receivedFields: Array.from(form.keys()),
      });
    }

    if (!isFile(target) || !isFile(garment)) {
      return jsonError("Invalid input type. Images must be uploaded as files.", 400);
    }

    if (!isImageFile(target) || !isImageFile(garment)) {
      return jsonError("Invalid file type. Only image files are supported.", 415);
    }

    if (target.size === 0 || garment.size === 0) {
      return jsonError("Uploaded image files must not be empty.", 400);
    }

    const refinePrompt =
      typeof refinePromptRaw === "string" && refinePromptRaw.trim().length > 0
        ? refinePromptRaw.trim()
        : null;

    const prompt = buildImagenPrompt(refinePrompt);

    const [targetBuffer, garmentBuffer] = await Promise.all([
      target.arrayBuffer(),
      garment.arrayBuffer(),
    ]);

    const targetBase64 = toBase64(targetBuffer);
    const garmentBase64 = toBase64(garmentBuffer);

    const ai = new GoogleGenAI({ apiKey: googleApiKey });

    const modelStartMs = Date.now();
    let resultBase64: string | null = null;
    let resultMimeType = "image/png";

    try {
      inFlightByRequestId.set(requestId, { startedAt: Date.now() });
      console.log(`REQ_IMAGEN_START ${requestId}`);

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-image-preview",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: target.type || "image/jpeg",
                  data: targetBase64,
                },
              },
              {
                inlineData: {
                  mimeType: garment.type || "image/jpeg",
                  data: garmentBase64,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["IMAGE", "TEXT"],
        },
      });

      console.log(`MODEL_DONE imagen ${Date.now() - modelStartMs}ms`);

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          resultBase64 = part.inlineData.data;
          resultMimeType = part.inlineData.mimeType ?? "image/png";
          break;
        }
      }
    } finally {
      inFlightByRequestId.delete(requestId);
    }

    console.log(`REQ_IMAGEN_DONE ${requestId}`);

    if (!resultBase64) {
      return jsonError("Imagen returned no image output.", 502, {
        model: "gemini-3.1-flash-image-preview",
      });
    }

    const dataUrl = `data:${resultMimeType};base64,${resultBase64}`;

    return NextResponse.json(
      {
        success: true,
        requestId,
        message: "Swap generated successfully",
        output: { model: "gemini-3.1-flash-image-preview" },
        image: { type: "data_url", value: dataUrl },
      },
      { status: 200 },
    );
  } catch (error) {
    const raw =
      error && typeof error === "object"
        ? {
            message: (error as { message?: unknown }).message ?? "Unknown error",
            name: (error as { name?: unknown }).name ?? null,
          }
        : { message: "Unknown error", name: null };

    console.error("Imagen error", raw, error);

    return jsonError("Failed to process request.", 500, {
      reason: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

