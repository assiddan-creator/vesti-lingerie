/**
 * Integration test for POST /api/size-finder (Find My Size).
 *
 * Usage: node test-size.mjs
 * Optional: API_BASE_URL=http://localhost:3000 node test-size.mjs
 *
 * Requires Next dev server and ANTHROPIC_API_KEY (and product fetch may need SCRAPER_API_KEY for some stores).
 */

const PAYLOAD = {
  productUrl:
    "https://www.asos.com/asos-design/asos-design-oversized-long-sleeve-t-shirt-in-washed-black/prd/206888684",
  userHeight: "178",
  bodyAnalysis:
    "Average build, balanced shoulders and waist; typically wears EU M in tops for a regular fit.",
  fitPreference: "Oversize",
};

async function tryPost(baseUrl) {
  const url = `${String(baseUrl).replace(/\/$/, "")}/api/size-finder`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(PAYLOAD),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, url };
}

async function main() {
  const bases = process.env.API_BASE_URL
    ? [process.env.API_BASE_URL]
    : ["http://localhost:3001", "http://localhost:3000"];

  let lastErr = null;

  for (const base of bases) {
    try {
      console.log(`Trying ${base}/api/size-finder ...\n`);
      const { res, data, url } = await tryPost(base);

      console.log("HTTP status:", res.status);
      console.log("Request URL:", url);
      console.log("Payload (fitPreference):", PAYLOAD.fitPreference);
      console.log("\n--- Response JSON ---\n");
      console.log(JSON.stringify(data, null, 2));

      if (!res.ok && res.status !== 502) {
        process.exitCode = 1;
      }
      return;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      const refused =
        e?.cause?.code === "ECONNREFUSED" || e?.code === "ECONNREFUSED" || msg.includes("ECONNREFUSED");
      if (refused) {
        console.warn(`Connection refused for ${base}, trying next...\n`);
        continue;
      }
      throw e;
    }
  }

  console.error("Could not reach the API on any tried base URL:", bases.join(", "));
  console.error("Last error:", lastErr);
  console.error("\nStart the dev server: npm run dev");
  console.error("If Next uses another port, set API_BASE_URL, e.g. $env:API_BASE_URL=\"http://localhost:3001\"");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
