import { NextResponse } from "next/server";
import Replicate from "replicate";

// Temporary in-memory deduplication for in-flight requests.
// Note: This is per-process (works in dev / single instance). In serverless/multi-instance
// deployments, consider a shared store.
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

type ImageDimensions = { width: number; height: number };

function readUInt32BE(buf: Buffer, offset: number) {
  return buf.readUInt32BE(offset);
}

function getPngDimensions(buf: Buffer): ImageDimensions | null {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return null;

  // IHDR chunk starts at byte 8, width/height at bytes 16..23
  const width = readUInt32BE(buf, 16);
  const height = readUInt32BE(buf, 20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function getJpegDimensions(buf: Buffer): ImageDimensions | null {
  // JPEG starts with FF D8
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < buf.length) {
    // Find next marker (0xFF ...)
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buf.length && buf[offset] === 0xff) offset += 1;
    if (offset >= buf.length) break;

    const marker = buf[offset];
    offset += 1;

    // Standalone markers without length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 1 >= buf.length) break;

    const length = buf.readUInt16BE(offset);
    if (length < 2 || offset + length > buf.length) break;

    // SOF markers that contain width/height
    const isSOF =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;

    if (isSOF) {
      // Segment structure: [len hi][len lo][precision][height hi][height lo][width hi][width lo]...
      if (offset + 7 >= buf.length) return null;
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }

    offset += length;
  }

  return null;
}

function getWebpDimensions(buf: Buffer): ImageDimensions | null {
  // Minimal WEBP parser for VP8X / VP8L
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buf.toString("ascii", 8, 12) !== "WEBP") return null;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkType = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    const chunkDataEnd = chunkDataStart + chunkSize;
    if (chunkDataEnd > buf.length) break;

    if (chunkType === "VP8X" && chunkSize >= 10) {
      // bytes: 4 flags, then 3 bytes width-1, 3 bytes height-1 (little endian)
      const wMinus1 = buf.readUIntLE(chunkDataStart + 4, 3);
      const hMinus1 = buf.readUIntLE(chunkDataStart + 7, 3);
      return { width: wMinus1 + 1, height: hMinus1 + 1 };
    }

    if (chunkType === "VP8L" && chunkSize >= 5) {
      // https://developers.google.com/speed/webp/docs/riff_container#simple_file_format_lossless
      if (buf[chunkDataStart] !== 0x2f) {
        // Signature byte
      } else {
        const b0 = buf[chunkDataStart + 1];
        const b1 = buf[chunkDataStart + 2];
        const b2 = buf[chunkDataStart + 3];
        const b3 = buf[chunkDataStart + 4];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height };
      }
    }

    // Chunks are padded to even sizes.
    offset = chunkDataEnd + (chunkSize % 2);
  }

  return null;
}

function getImageDimensions(buf: Buffer, mimeType: string): ImageDimensions | null {
  const mt = (mimeType || "").toLowerCase();
  if (mt.includes("png")) return getPngDimensions(buf);
  if (mt.includes("jpeg") || mt.includes("jpg")) return getJpegDimensions(buf);
  if (mt.includes("webp")) return getWebpDimensions(buf);

  // Fallback: try common formats in case mime is missing/wrong
  return getPngDimensions(buf) ?? getJpegDimensions(buf) ?? getWebpDimensions(buf);
}

type AspectRatio = "1:1" | "3:2" | "2:3";

function chooseAspectRatio(dim: ImageDimensions | null): AspectRatio {
  if (!dim) return "2:3"; // default for try-on / full body
  const ratio = dim.width / dim.height;
  if (Math.abs(ratio - 1) <= 0.12) return "1:1";
  if (ratio > 1) return "3:2";
  return "2:3";
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

  // Array outputs: strings, file-like objects, nested arrays/objects
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

  // Object outputs: common shapes { output: [...] }, { images: [...] }, { image: ... }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["output", "outputs", "images", "image", "data", "result"]) {
      if (key in obj) {
        const nested = extractFirstImageUrl(obj[key]);
        if (nested.url) return { url: nested.url, path: `$.${key}${nested.path === "$" ? "" : nested.path.replace("$", "")}` };
      }
    }

    // Fall back: scan all enumerable fields
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

function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

async function fileToDataUrl(file: File): Promise<string> {
  const mimeType = file.type || "application/octet-stream";
  const base64 = toBase64(await file.arrayBuffer());
  return `data:${mimeType};base64,${base64}`;
}

function buildClothingSwapPrompt(refinePrompt: string | null) {
  const basePrompt = [
    "You are an expert photorealistic image editor for virtual try-on.",
    "",
    "Task:",
    "- Image A is the TARGET PERSON photo.",
    "- Image B is the GARMENT REFERENCE photo.",
    "",
    "Goal: Transfer ONLY the clothing from Image B onto the person in Image A.",
    "",
    "Hard constraints (must follow):",
    "- Preserve the target person's identity exactly (face, skin texture, age, expression).",
    "- Preserve hair, hairstyle, and hairline exactly.",
    "- Preserve pose, body proportions, and silhouette; do not change body shape.",
    "- Preserve background, lighting, shadows, camera angle, and depth of field.",
    "- Keep the full body visible; do not crop the subject.",
    "- Preserve the original framing of the target image exactly.",
    "- Keep the result photorealistic; avoid stylization, filters, or cartoon looks.",
    "- Avoid anatomy distortions (hands, arms, shoulders, neck) and avoid warping.",
    "",
    "Clothing transfer constraints:",
    "- Replace the person's existing outfit with the garment from Image B.",
    "- Preserve garment details as accurately as possible: color, texture, pattern, material, fit, length, seams, collar, neckline, cuffs, sleeves, logos/prints.",
    "- Maintain natural drape and folds consistent with the pose and lighting.",
    "- Do not add accessories unless they are part of the garment in Image B.",
    "",
    "Output:",
    "- Return a single high-quality edited image.",
  ].join("\n");

  if (refinePrompt && refinePrompt.trim().length > 0) {
    return `${basePrompt}\n\nExtra instruction:\n${refinePrompt.trim()}\n`;
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
    if (!requestId) {
      return jsonError("Missing requestId.", 400);
    }

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

    const model = "openai/gpt-image-1.5" as const;

    const prompt = buildClothingSwapPrompt(refinePrompt);

    // Convert browser File(s) into Replicate-friendly inputs.
    // Many Replicate image models accept URLs or base64 data URLs.
    const targetArrayBuffer = await target.arrayBuffer();
    const targetBuffer = Buffer.from(targetArrayBuffer);
    const targetDims = getImageDimensions(targetBuffer, target.type);
    const aspect_ratio = chooseAspectRatio(targetDims);

    // eslint-disable-next-line no-console
    console.log("Replicate aspect ratio chosen:", {
      aspect_ratio,
      target: { name: target.name, type: target.type, width: targetDims?.width ?? null, height: targetDims?.height ?? null },
    });

    const [targetDataUrl, garmentDataUrl] = await Promise.all([
      // Reuse the already-read target buffer for base64 encoding.
      (async () => `data:${target.type || "application/octet-stream"};base64,${targetBuffer.toString("base64")}`)(),
      fileToDataUrl(garment),
    ]);

    const input = {
      prompt,
      input_images: [targetDataUrl, garmentDataUrl],
      input_fidelity: "high",
      quality: "high",
      output_format: "png",
      number_of_images: 1,
      aspect_ratio,
    } as const;

    let output: unknown;
    try {
      inFlightByRequestId.set(requestId, { startedAt: Date.now() });
      // eslint-disable-next-line no-console
      console.log(`REQ_REPLICATE_START ${requestId}`);
      // eslint-disable-next-line no-console
      console.log("MODEL_USED gpt-image-1.5");
      const modelStartMs = Date.now();

      output = await replicate.run(model, { input });

      // eslint-disable-next-line no-console
      console.log(`MODEL_DONE gpt-image-1.5 ${Date.now() - modelStartMs}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Replicate run error", e);
      throw e;
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
        output: {
          model,
          input,
        },
        image: { type: "url", value: firstUrl },
        debug,
      },
      { status: 200 },
    );
  } catch (error) {
    // Replicate errors come back as generic Errors with status/response sometimes.
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

