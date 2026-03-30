import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // קליטת העדפת הגזרה של המשתמש בנוסף לנתונים הקיימים
  const { productUrl, userHeight, bodyAnalysis, fitPreference = "Regular" } = await req.json();

  // שלב 1 — שלוף את תוכן דף המוצר
  let productHtml = "";
  try {
    // הכנה עתידית ל-ScraperAPI כדי לעקוף חסימות
    const fetchUrl = process.env.SCRAPER_API_KEY
      ? `http://api.scraperapi.com/?api_key=${process.env.SCRAPER_API_KEY}&url=${encodeURIComponent(productUrl)}`
      : productUrl;

    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    productHtml = await res.text();
    // הגדלת טווח הסריקה ל-35,000 תווים כדי לתפוס טבלאות מידות ב-JSON
    productHtml = productHtml.slice(0, 35000);
  } catch {
    productHtml = "Could not fetch page content";
  }

  // שלב 2 — שלח לקלוד לניתוח עם לוגיקת פיזיקת בדים ומרווח
  const claudePrompt = `
You are a master fashion sizing engineer. Analyze this product page HTML and the user's body info to calculate the perfect size.

USER INFO:
- Height: ${userHeight} cm
- Body type analysis/measurements: ${bodyAnalysis}
- Fit Preference: ${fitPreference} (Crucial: Adjust your recommendation based on whether they want Slim, Regular, or Oversize).

PRODUCT PAGE HTML/DATA (Truncated):
${productHtml}

YOUR TASKS & LOGIC:
1. Extract the exact size chart (look for HTML tables, size guides, or JSON arrays like 'size_chart', 'attr_name_value_cm').
2. Identify the brand (AliExpress, Shein, Zara, ASOS, etc.) and account for regional sizing (Asian sizing often runs 1-2 sizes smaller).
3. APPLY GARMENT EASE FORMULA: (Garment Measurement) - (Body Measurement) = Ease. 
   - Ensure the calculated ease matches the user's Fit Preference (${fitPreference}).
4. CONSIDER FABRIC PHYSICS: Search the HTML for fabric composition. If the item contains high-stretch materials (Elastane, Spandex, Lycra), allow for "Negative Ease" (the garment can be slightly smaller than the body measurement for a fitted look).

Return ONLY a valid JSON object with these fields:
{
  "store": "store name",
  "productName": "product name if found",
  "recommendedSize": "S/M/L/XL/etc",
  "confidence": "high/medium/low",
  "reasoning": "Explain the math briefly. Mention the Garment Ease calculated, fabric stretch considerations, and how the ${fitPreference} preference influenced the choice.",
  "sizeChart": "Brief summary of the exact measurements found for the recommended size, or null",
  "warning": "Any important warnings (e.g., 'high stretch fabric', 'runs very small in the bust') or null"
}
No markdown, no explanation outside the JSON.
  `;

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
          content: claudePrompt,
        },
      ],
    }),
  });

  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? `Anthropic request failed (${response.status})` },
      { status: response.status >= 400 ? response.status : 502 },
    );
  }

  const text = data.content?.[0]?.text || "{}";

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not parse response", raw: text });
  }
}
