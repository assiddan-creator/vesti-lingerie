# Vesti Lingerie — System flow (current codebase)

This document describes the **exact** data journey for the three main features, as implemented in the repository at the time of writing.

---

## Feature 1: Try It On (`/` — `src/app/page.tsx`)

### Purpose
Virtual try-on: user provides a **person image** and a **garment image** (or preset look), selects an **AI model** (endpoint), and receives a **generated result image**.

### Client-side flow

1. **Inputs**
   - `personFile`, `garmentFile` (`File`), optional `refinePrompt`, `selectedModel` → resolves to `selected.endpoint` (e.g. `/api/clothes-swap`, `/api/clothes-swap/flux`, …) via `MODEL_OPTIONS`.

2. **Submit — `handleGenerate()`**
   - Guards: both files required; blocks double-submit via `inFlightRef` + `isSubmitting`.
   - Builds **`FormData`**: `targetImage`, `garmentImage`, `requestId` (UUID-like), optional `refinePrompt`.
   - **`fetch(selected.endpoint, { method: "POST", body: formData })`** — no JSON; multipart upload.

3. **Success response (`ApiSuccess`)**
   - Expects `success: true`, `image: { type: "data_url" | "url", value: string }`, plus metadata (`message`, `output`, etc.).
   - **`setApiSuccess(success)`** drives the result UI (preview, save/share, lightbox).

4. **Local storage history (`tryOnHistory`)**
   - **Constants:** `TRYON_HISTORY_KEY = "vesti_tryon_history_v1"`, `TRYON_HISTORY_MAX = 20`.
   - **On successful generation:** if `success.image.value` is a non-empty string, append a **`TryOnHistoryItem`** `{ id, url: imageUrl, createdAt }` to state (prepend, dedupe same `url`, cap at 20).
   - **`persistTryOnHistory(items)`** writes `JSON.stringify` to `localStorage`; on `QuotaExceededError`, retries with roughly half the items.
   - **On mount:** one `useEffect` reads `localStorage`, validates array shape, **`setTryOnHistory`** (max 20).
   - **Clear history:** button sets state to `[]` and calls `persistTryOnHistory([])`.
   - **UI:** grid of thumbnails; tap opens shared lightbox (`historyLightboxUrl` or current result). **Note:** large `data:` URLs can stress `localStorage` quota.

### Server-side (referenced, not fully detailed here)
- Each `selected.endpoint` is a **route under `src/app/api/clothes-swap/...`** that consumes the multipart images and returns `ApiSuccess` with an image `data_url` or remote `url`.

---

## Feature 2: Shop The Look (`/street` — `src/app/street/page.tsx` + `src/app/api/visual-search/route.ts`)

### Purpose
User uploads a **street snap**; the app analyzes the outfit, then finds **shopping results**.

### Client flow (`analyze` in `street/page.tsx`)

1. **Image → base64**
   - `fileToBase64Image(file)` → `{ mediaType, data }` where `data` is raw base64 (no data-URL prefix).

2. **Outfit analysis — `POST /api/analyze-outfit`**
   - Body: `{ imageBase64: data, mediaType }`.
   - Response: Anthropic-style JSON with `content[]`; first **text** block is parsed as JSON (`parseAnalysisJson`) → `AnalysisResult` (`item`, `style`, `color`, `material`, `occasion`, `searchQuery`, `asosQuery`, etc.).
   - **`setResult(parsed)`** for the UI text summary.

3. **Visual / shopping search — `POST /api/visual-search`**
   - Body: `{ searchQuery: parsed.searchQuery, imageBase64 }` (both sent; **the route implementation does not use `searchQuery` for the pipeline** — see server below).
   - Response: `{ generatedQuery, shoppingResults }` (and errors as JSON).
   - **`setShoppingResults(visualData.shoppingResults || [])`**.
   - **Console:** `console.log("[Shop The Look] /api/visual-search response:", visualData)`.

### Server flow (`src/app/api/visual-search/route.ts`)

**Prerequisite:** non-empty **`imageBase64`** (data URL or raw base64). **`searchQuery` in the body is ignored** for generation; shopping query is fully derived from Vision + Claude.

1. **Env:** `GOOGLE_VISION_API_KEY`, `ANTHROPIC_API_KEY`, `SERP_API_KEY` — all required; else `500` JSON error.

2. **Normalize image**
   - `stripDataUrlToRawBase64(imageBase64)` → raw base64 string for Vision.

3. **Google Cloud Vision — `images:annotate`**
   - `POST https://vision.googleapis.com/v1/images:annotate?key=...`
   - Features: **LABEL_DETECTION** (25), **OBJECT_LOCALIZATION** (10), **WEB_DETECTION** (10).
   - **`buildVisionSummary()`** flattens labels, objects, web entities / best-guess / page titles into one JSON object for the LLM.

4. **Anthropic Claude — shopping query**
   - Model: **`claude-3-haiku-20240307`**, `max_tokens: 120`.
   - User message: instructions to output **one line**, **3–6 words**, English, Google Shopping–oriented, from the Vision JSON (no brands unless strongly implied).
   - First non-empty line of text → **`generatedQuery`** (trimmed, quotes stripped, max 200 chars).

5. **SerpApi**
   - `GET https://serpapi.com/search?engine=google_shopping&q=<generatedQuery>&api_key=...&num=6`
   - Response: take **`shopping_results`** → slice **first 6** items.

6. **HTTP response:** `{ generatedQuery, shoppingResults }` or structured errors (`400` / `500` / `502`).

---

## Feature 3: Find My Size & Body Scanner

Two UIs share **`POST /api/size-finder`** (`src/app/api/size-finder/route.ts`).

### A) Find My Size page (`/size` — `src/app/size/page.tsx`)

1. User photo → optional **`POST /api/analyze-outfit`** (placeholder `bodyAnalysis` text if call fails).
2. User enters **height**, **product URL**, **`fitPreference`** (Slim / Regular / Oversize).
3. **`analyze()`** → **`POST /api/size-finder`** with  
   `{ productUrl, userHeight: height, bodyAnalysis, fitPreference }`.

### B) Body Scanner (`/body-scan` — `src/components/BodyScanner.tsx`)

1. **Camera + MediaPipe (browser)**
   - Loads **jsDelivr** scripts: `@mediapipe/pose`, `@mediapipe/camera_utils`, `@mediapipe/drawing_utils` (versions pinned in component).
   - **`Pose`** with `locateFile` → CDN assets for WASM/models.
   - **`Camera`**: `getUserMedia` → each frame **`pose.send({ image: video })`**.
   - **`onResults`**: `poseLandmarks` → draw with **`drawConnectors` / `drawLandmarks`** + `POSE_CONNECTIONS` on canvas overlay; **`latestLandmarksRef`** stores latest landmarks.

2. **Pixel → cm math (`calculateMeasurements`)**
   - Uses **`video.videoWidth` / `video.videoHeight`** and normalized landmark **x,y** in [0,1].
   - **Distance in pixels** between two points:  
     `dx = (x2-x1)*w`, `dy = (y2-y1)*h`, `dist = sqrt(dx²+dy²)`.
   - **“Body height” proxy (pixels):** landmark **1** (left eye inner) to **29** (left heel).
   - **`pixelsPerCm = bodyHeightPx / userHeightCm`** (user-entered height).
   - **Shoulder width (pixels):** landmarks **11** ↔ **12**.
   - **`shoulderCm = shoulderPx / pixelsPerCm`** → **`shoulderWidthCm`** state.

3. **Size recommendation**
   - **`fetchSizeRecommendation()`** → **`POST /api/size-finder`** with  
     `{ productUrl, userHeight: userHeightCm, bodyAnalysis: "Shoulder width is " + shoulderWidthCm + " cm", fitPreference: "Regular" }`  
     (button disabled until shoulder width is computed and URL non-empty).

---

### Shared server: `src/app/api/size-finder/route.ts`

1. **Parse JSON body:** `productUrl`, `userHeight`, `bodyAnalysis`, `fitPreference` (default **`"Regular"`**).

2. **Scrape / fetch product HTML**
   - If **`SCRAPER_API_KEY`** is set:  
     `fetch("http://api.scraperapi.com/?api_key=...&url=" + encodeURIComponent(productUrl))`.
   - Else: direct **`fetch(productUrl)`** with browser-like headers.
   - **`productHtml`** = response text, **truncated to 35,000** characters. On failure, placeholder string `"Could not fetch page content"`.

3. **Claude Sonnet — sizing**
   - Model: **`claude-sonnet-4-20250514`**, `max_tokens: 1000`.
   - Single user message: long prompt including height, `bodyAnalysis`, `fitPreference`, truncated HTML; instructions for size chart extraction, regional sizing, ease, fabric/stretch, **JSON-only** output shape (`store`, `productName`, `recommendedSize`, `confidence`, `reasoning`, `sizeChart`, `warning`).

4. **Response handling**
   - If Anthropic HTTP not OK → JSON error with status.
   - Else parse **`content[0].text`**: strip ```json fences, **`JSON.parse`**, return parsed object as **`NextResponse.json(result)`**.
   - Parse failure → `{ error: "Could not parse response", raw: text }`.

---

## Environment variables (summary)

| Variable | Used by |
|----------|---------|
| `ANTHROPIC_API_KEY` | `analyze-outfit`, `visual-search` (Haiku), `size-finder` (Sonnet) |
| `GOOGLE_VISION_API_KEY` | `visual-search` |
| `SERP_API_KEY` | `visual-search` |
| `SCRAPER_API_KEY` | `size-finder` (optional proxy) |

---

## Route map (user-facing)

| Feature | Page | Primary API routes |
|---------|------|-------------------|
| Try It On | `/` | `POST /api/clothes-swap*` (model-specific) |
| Shop The Look | `/street` | `POST /api/analyze-outfit` → `POST /api/visual-search` |
| Find My Size | `/size` | `POST /api/analyze-outfit` (optional), `POST /api/size-finder` |
| Body Scanner | `/body-scan` | (MediaPipe client-only) → `POST /api/size-finder` |
