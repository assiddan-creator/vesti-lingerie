import { NextResponse } from "next/server";
import Replicate from "replicate";

// Temporary in-memory deduplication for in-flight requests.
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

async function fileToDataUrl(file: File): Promise<string> {
  const mimeType = file.type || "application/octet-stream";
  const base64 = toBase64(await file.arrayBuffer());
  return `data:${mimeType};base64,${base64}`;
}

function safeStringify(value: unknown, maxLength = 12000) {
  const seen = new WeakSet<object>();
  const json = JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "function") return `[Function ${(v as Function).name || "anonymous"}]`;
      if (typeof v === "object" && v !== null) {
        if (seen.has(v as object)) return "[Circular]";
        seen.add(v as object);
      }
      return v;
    },
    2,
  );

  if (typeof json === "string" && json.length > maxLength) {
    return `${json.slice(0, maxLength)}\n…(truncated ${json.length - maxLength} chars)`;
  }
  return json;
}

function looksLikeUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extractUrlFromFirstItem(firstItem: unknown): string | null {
  if (!firstItem) return null;
  if (typeof firstItem === "string") return looksLikeUrl(firstItem) ? firstItem : null;

  if (typeof firstItem === "object") {
    const obj = firstItem as Record<string, unknown>;
    if (typeof obj.url === "string" && looksLikeUrl(obj.url)) return obj.url;
    if (typeof obj.href === "string" && looksLikeUrl(obj.href)) return obj.href;

    const maybeToString = (firstItem as { toString?: unknown }).toString;
    if (typeof maybeToString === "function") {
      const s = String(firstItem);
      if (s && s !== "[object Object]" && looksLikeUrl(s)) return s;
    }
  }

  return null;
}

function buildSeedreamPrompt(refinePrompt: string | null) {
  // Seedream-friendly natural-language prompt, keeping the exact same intent as the app's
  // clothes-swap prompt used for other models.
  const basePrompt = [
    "Photorealistic virtual try-on edit using two reference images.",
    "Image A: the target person photo.",
    "Image B: the garment reference photo.",
    "",
    "Edit Image A so the person is wearing the clothing from Image B.",
    "Transfer ONLY the clothing. Do not change the person’s identity.",
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
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!replicateToken) {
      return jsonError("Server is missing REPLICATE_API_TOKEN.", 500);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return jsonError(
        "Unsupported content type. Expected multipart/form-data.",
        415,
        { received: contentType || null },
      );
    }

    const form = await request.formData();
    const target = form.get("targetImage");
    const garment = form.get("garmentImage");
    const refinePromptRaw = form.get("refinePrompt");
    const requestIdRaw = form.get("requestId");

    const requestId = typeof requestIdRaw === "string" ? requestIdRaw.trim() : "";
    if (!requestId) return jsonError("Missing requestId.", 400);

    // eslint-disable-next-line no-console
    console.log(`REQ_RECEIVED ${requestId}`);

    if (inFlightByRequestId.has(requestId)) {
      // eslint-disable-next-line no-console
      console.log(`REQ_DUPLICATE_BLOCKED ${requestId}`);
      return NextResponse.json(
        {
          success: false,
          requestId,
          duplicate: true,
          status: "processing",
          message: "Duplicate request blocked (already processing).",
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
      return jsonError("Invalid input type. Images must be uploaded as files.", 400, {
        targetImageType: typeof target,
        garmentImageType: typeof garment,
      });
    }

    if (!isImageFile(target) || !isImageFile(garment)) {
      return jsonError("Invalid file type. Only image files are supported.", 415, {
        targetImageMimeType: target.type || null,
        garmentImageMimeType: garment.type || null,
      });
    }

    if (target.size === 0 || garment.size === 0) {
      return jsonError("Uploaded image files must not be empty.", 400, {
        targetImageSize: target.size,
        garmentImageSize: garment.size,
      });
    }

    const refinePrompt =
      typeof refinePromptRaw === "string" && refinePromptRaw.trim().length > 0
        ? refinePromptRaw.trim()
        : null;

    const replicate = new Replicate({ auth: replicateToken });
    const model = "bytedance/seedream-5-lite" as const;
    const prompt = buildSeedreamPrompt(refinePrompt);

    const [targetDataUrl, garmentDataUrl] = await Promise.all([
      fileToDataUrl(target),
      fileToDataUrl(garment),
    ]);

    // Use the exact payload structure requested.
    const input = {
      prompt,
      image_input: [targetDataUrl, garmentDataUrl],
      size: "2K",
      aspect_ratio: "match_input_image",
      output_format: "jpeg",
      sequential_image_generation: "disabled",
    } as const;

    let output: unknown;
    const modelStartMs = Date.now();
    try {
      inFlightByRequestId.set(requestId, { startedAt: Date.now() });
      // eslint-disable-next-line no-console
      console.log(`REQ_REPLICATE_START ${requestId}`);
      // eslint-disable-next-line no-console
      console.log("MODEL_USED seedream-5-lite");

      output = await replicate.run(model, { input });

      // eslint-disable-next-line no-console
      console.log(`MODEL_DONE seedream-5-lite ${Date.now() - modelStartMs}`);
    } finally {
      inFlightByRequestId.delete(requestId);
    }

    // eslint-disable-next-line no-console
    console.log(`REQ_REPLICATE_DONE ${requestId}`);

    // Log the full raw output safely (debug).
    // eslint-disable-next-line no-console
    console.log("Seedream raw output:", safeStringify(output));

    const isArray = Array.isArray(output);
    const firstItem = isArray ? (output as unknown[])[0] : undefined;

    // eslint-disable-next-line no-console
    console.log("Seedream output[0] debug:", {
      outputType: typeof output,
      isArray,
      firstItemType: typeof firstItem,
      firstItemKeys: firstItem && typeof firstItem === "object" ? Object.keys(firstItem as object) : null,
      firstItemPreview: safeStringify(firstItem, 4000),
    });

    // Seedream is expected to return an array. Parse output[0] robustly.
    const firstUrl = isArray ? extractUrlFromFirstItem(firstItem) : null;

    if (!firstUrl) {
      const debug = {
        outputType: typeof output,
        isArray,
        firstItemType: typeof firstItem,
        firstItemKeys: firstItem && typeof firstItem === "object" ? Object.keys(firstItem as object) : null,
        rawOutputPreview: safeStringify(output, 4000),
      };
      return jsonError("Seedream returned no image output.", 502, {
        model,
        debug,
      });
    }

    return NextResponse.json(
      {
        success: true,
        requestId,
        message: "Swap generated successfully",
        output: { model, input },
        image: { type: "url", value: firstUrl },
      },
      { status: 200 },
    );
  } catch (error) {
    const raw =
      error && typeof error === "object"
        ? {
            message: (error as { message?: unknown }).message ?? "Unknown error",
            name: (error as { name?: unknown }).name ?? null,
            status: (error as { status?: unknown }).status ?? null,
          }
        : { message: "Unknown error", name: null, status: null };

    // eslint-disable-next-line no-console
    console.error("Replicate error", raw, error);

    return jsonError("Failed to process request.", 500, {
      reason: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

