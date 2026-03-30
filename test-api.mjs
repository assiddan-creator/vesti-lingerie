/**
 * Integration test: POST /api/visual-search with a data-URL image (no UI).
 *
 * Run: node test-api.mjs
 * Requires Next dev server. Default base URL is http://localhost:3000 — if Next
 * prints "Port 3000 is in use, using 3001", run:
 *   set API_BASE_URL=http://localhost:3001   (Windows PowerShell: $env:API_BASE_URL="http://localhost:3001")
 *   node test-api.mjs
 */

const SAMPLE_IMAGE_URL =
  "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=800&auto=format&fit=crop&q=80";

async function main() {
  const imgRes = await fetch(SAMPLE_IMAGE_URL);
  if (!imgRes.ok) {
    throw new Error(`Failed to download sample image: ${imgRes.status} ${imgRes.statusText}`);
  }

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buffer.toString("base64");
  const contentType = imgRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const imageBase64 = `data:${contentType};base64,${base64}`;

  const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/visual-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64 }),
  });

  const data = await res.json().catch(() => ({}));

  console.log("HTTP status:", res.status);
  console.log("generatedQuery:", data.generatedQuery);
  console.log("shoppingResults:", JSON.stringify(data.shoppingResults, null, 2));

  if (!res.ok) {
    console.log("Full response:", data);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  const msg = String(err?.message ?? err);
  const refused =
    err?.cause?.code === "ECONNREFUSED" ||
    err?.code === "ECONNREFUSED" ||
    msg.includes("ECONNREFUSED");
  if (refused) {
    console.error(
      "Connection refused — start the Next.js dev server (npm run dev). If it uses a port other than 3000, set API_BASE_URL.",
    );
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
