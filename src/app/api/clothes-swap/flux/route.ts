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

function buildFluxPrompt(refinePrompt: string | null) {
  const basePrompt = `You are an expert photorealistic image editor for virtual try-on.
Task:
- Image A is the TARGET PERSON photo.
- Image B is the GARMENT REFERENCE photo.

Goal:
Transfer ONLY the clothing from Image B onto the person in Image A.

Hard constraints (must follow):
- Preserve the target person's identity exactly (face, skin texture, age, expression).
- Preserve hair, hairstyle, and hairline exactly.
- Preserve pose, body proportions, and silhouette; do not change body shape.
- Preserve background, lighting, shadows, camera angle, and depth of field.
- Keep the full body visible; do not crop the subject.
- Preserve the original framing of the target image exactly.
- Keep the result photorealistic; avoid stylization, filters, or cartoon looks.
- Avoid anatomy distortions (hands, arms, shoulders, neck) and avoid warping.

Clothing transfer constraints:
- Replace the person's existing outfit with the garment from Image B.
- Preserve garment details as accurately as possible: color, texture, pattern, material, fit, length, seams, collar, neckline, cuffs, sleeves, logos/prints.
- Maintain natural drape and folds consistent with the pose and lighting.
- Do not add accessories unless they are part of the garment in Image B.

Output:
- Return a single high-quality edited image.
`;

  if (refinePrompt && refinePrompt.trim().length > 0) {
    return `${basePrompt}\n${refinePrompt.trim()}\n`;
  }
  return basePrompt;
}

function safeStringify(value: unknown, maxLength = 8000) {
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

function toUrlString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj.href === "string") return obj.href;
    if (typeof (value as { toString?: unknown }).toString === "function") {
      const s = String(value);
      return s && s !== "[object Object]" ? s : null;
    }
  }
  return null;
}

function looksLikeImageUrl(url: string) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extractFirstImageUrl(output: unknown): { url: string | null; path: string } {
  const direct = toUrlString(output);
  if (direct && looksLikeImageUrl(direct)) return { url: direct, path: "$" };

  if (Array.isArray(output)) {
    for (let i = 0; i < output.length; i++) {
      const candidate = output[i];
      const str = toUrlString(candidate);
      if (str && looksLikeImageUrl(str)) return { url: str, path: `$[${i}]` };

      if (candidate && (typeof candidate === "object" || Array.isArray(candidate))) {
        const nested = extractFirstImageUrl(candidate);
        if (nested.url) return { url: nested.url, path: `$[${i}].${nested.path.replace("$", "")}` };
      }
    }
  }

  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["output", "outputs", "images", "image", "data", "result"]) {
      if (key in obj) {
        const nested = extractFirstImageUrl(obj[key]);
        if (nested.url) return { url: nested.url, path: `$.${key}${nested.path === "$" ? "" : nested.path.replace("$", "")}` };
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      const str = toUrlString(v);
      if (str && looksLikeImageUrl(str)) return { url: str, path: `$.${k}` };
      if (v && (typeof v === "object" || Array.isArray(v))) {
        const nested = extractFirstImageUrl(v);
        if (nested.url) return { url: nested.url, path: `$.${k}${nested.path === "$" ? "" : nested.path.replace("$", "")}` };
      }
    }
  }

  return { url: null, path: "$" };
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
    const model = "black-forest-labs/flux-2-pro" as const;
    const prompt = buildFluxPrompt(refinePrompt);

    const [targetDataUrl, garmentDataUrl] = await Promise.all([
      fileToDataUrl(target),
      fileToDataUrl(garment),
    ]);

    // Keep the exact payload structure requested.
    const input = {
      prompt,
      input_images: [targetDataUrl, garmentDataUrl],
      aspect_ratio: "match_input_image",
      output_format: "jpg",
      resolution: "1 MP",
      safety_tolerance: 2,
    } as const;

    let output: unknown;
    const modelStartMs = Date.now();
    try {
      inFlightByRequestId.set(requestId, { startedAt: Date.now() });
      // eslint-disable-next-line no-console
      console.log(`REQ_REPLICATE_START ${requestId}`);
      // eslint-disable-next-line no-console
      console.log("MODEL_USED flux-2-pro");

      output = await replicate.run(model, { input });

      // eslint-disable-next-line no-console
      console.log(`MODEL_DONE flux-2-pro ${Date.now() - modelStartMs}`);
    } finally {
      inFlightByRequestId.delete(requestId);
    }

    // eslint-disable-next-line no-console
    console.log(`REQ_REPLICATE_DONE ${requestId}`);

    // eslint-disable-next-line no-console
    console.log("Replicate run raw output:", safeStringify(output));

    const parsed = extractFirstImageUrl(output);
    const firstUrl = parsed.url ?? undefined;

    const debug = {
      outputType: typeof output,
      isArray: Array.isArray(output),
      keys: output && typeof output === "object" && !Array.isArray(output) ? Object.keys(output as object) : null,
      extractedUrlPath: parsed.path,
      extractedUrl: firstUrl ?? null,
      raw: safeStringify(output, 4000),
    };

    if (!firstUrl) {
      return jsonError("Replicate returned no image output.", 502, {
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
        debug,
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

