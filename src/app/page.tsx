"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PresetLook } from "../lib/preset-looks";
import type { BodyScanApiResponse } from "../lib/body-scan";
import {
  FALLBACK_KEYPOINTS,
  FALLBACK_MEASUREMENTS,
  makeFallbackBodyScan,
} from "../lib/body-scan";
import { BodyScanOverlay } from "../components/BodyScanOverlay";

/** Primary CTA — photo background + scrim in globals.css (`.vesti-cta`) */
const shieldButtonClass =
  "vesti-cta glass-button overflow-hidden rounded-2xl border border-white/20 font-semibold text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40";

const secondaryLinkButtonClass =
  "glass-button glass-btn glass-btn-secondary rounded-2xl font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

const VELVET_BG = "/Black_velvet_background_202603301114.jpeg";
/** Main hero — full-bleed background + header banner */
const HERO_IMG = "/Replace_products_with_202604030606.jpeg";
const SEEDREAM_ENDPOINT = "/api/clothes-swap/seedream";

// ─── ShopTheLookButton ───────────────────────────────────────────────────────
// מקבל גם את garmentFile כדי לשלוח את תמונת הבגד המקורית לגוגל ויז'ן
function ShopTheLookButton({
  resultUrl,
  garmentFile,
}: {
  resultUrl: string | null;
  garmentFile: File | null;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<
    Array<{ title?: string; price?: string; link?: string; thumbnail?: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");

  async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleShop() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      // שולחים את תמונת הבגד המקורית — לא את תמונת התוצאה
      let imagePayload: string | null = null;

      if (garmentFile) {
        imagePayload = await fileToBase64(garmentFile);
      } else if (resultUrl) {
        // fallback — אם אין קובץ בגד, ננסה עם תמונת התוצאה
        if (resultUrl.startsWith("data:")) {
          imagePayload = resultUrl;
        } else {
          try {
            const imgRes = await fetch(resultUrl);
            const blob = await imgRes.blob();
            imagePayload = await fileToBase64(new File([blob], "result.jpg", { type: "image/jpeg" }));
          } catch {
            setError("Could not load image");
            setLoading(false);
            return;
          }
        }
      }

      if (!imagePayload) {
        setError("No image available");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/visual-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imagePayload }),
      });
      const data = (await res.json()) as {
        shoppingResults?: Array<{ title?: string; price?: string; link?: string; thumbnail?: string }>;
        generatedQuery?: string;
        error?: string;
      };
      if (data.generatedQuery) setQuery(data.generatedQuery);
      if (!res.ok || data.error) {
        setError(data.error ?? "Search failed");
      } else {
        setResults(data.shoppingResults ?? []);
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (results.length > 0) {
    return (
      <div className="mt-8 w-full max-w-2xl">
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Shop similar pieces
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {results.slice(0, 12).map((item, i) => (
            <a
              key={i}
              href={item.link ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-2 rounded-xl border border-outline/30 bg-surface-container/90 p-3 transition-all hover:border-primary/50 hover:rose-glow"
            >
              {item.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail}
                  alt={item.title ?? ""}
                  className="w-full rounded-lg object-cover object-top"
                  style={{ height: "160px" }}
                />
              )}
              <p className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">{item.title}</p>
              {item.price && (
                <p className="text-[10px] font-bold text-primary">{item.price}</p>
              )}
            </a>
          ))}
        </div>
        <div className="mt-6 flex w-full gap-3">
          <a
            href={`https://www.asos.com/search/?q=${encodeURIComponent(query)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex-1 py-3 text-center text-xs font-bold uppercase tracking-[0.18em] ${secondaryLinkButtonClass}`}
          >
            Search on Asos
          </a>
          <a
            href={`https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop`}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex-1 py-3 text-center text-xs font-bold uppercase tracking-[0.18em] ${secondaryLinkButtonClass}`}
          >
            Search on Google
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 flex w-full max-w-md flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => void handleShop()}
        disabled={loading}
        className={`w-full px-8 py-4 text-sm font-bold uppercase tracking-[0.22em] ${shieldButtonClass}`}
      >
        {loading ? "Finding similar pieces..." : "Shop this look"}
      </button>
      {error && (
        <p className="text-xs text-muted-foreground">Search unavailable</p>
      )}
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────
type ApiSuccess = {
  success: true;
  message: string;
  requestId?: string;
  output: {
    model: string;
    size: string;
    quality: string;
    format: string;
    background: string;
  };
  image: { type: "data_url"; value: string } | { type: "url"; value: string };
};

type ApiError = {
  success: false;
  requestId?: string;
  error: {
    message: string;
    details?: Record<string, unknown>;
  };
};

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ─── UploadPortraitCard ───────────────────────────────────────────────────────
function UploadPortraitCard({
  preview,
  onFileChange,
  onClear,
}: {
  preview: string | null;
  onFileChange: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-outline/30 bg-surface-container/80 p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:p-6">
      <div className="flex flex-col items-center gap-1">
        <span className="font-headline text-base font-semibold tracking-wide text-foreground">Your portrait</span>
        <span className="text-sm text-muted-foreground">Face forward, soft light, shoulders visible.</span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`group relative flex w-full max-w-sm flex-col items-center justify-center gap-3 px-4 ${shieldButtonClass} ${
          preview ? "min-h-[min(72vh,40rem)] sm:min-h-[min(76vh,44rem)]" : "min-h-52"
        }`}
      >
        {preview ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-outline/25 bg-surface-container-lowest p-2 sm:p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your portrait" className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            <span className="text-sm font-bold uppercase tracking-[0.14em] text-on-primary">Upload photo</span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileChange(file);
        }}
      />

      <p className="text-xs text-muted-foreground">Preview only. Images are processed securely.</p>

      {preview && (
        <button
          type="button"
          onClick={() => {
            onClear();
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="rounded-md border border-outline/40 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary"
        >
          Remove
        </button>
      )}
    </div>
  );
}

// ─── CustomGarmentUpload ──────────────────────────────────────────────────────
function CustomGarmentUpload({
  preview,
  onFileChange,
  onClear,
}: {
  preview: string | null;
  onFileChange: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Or upload your own</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`group flex min-h-[8.5rem] w-full flex-col items-center justify-center gap-2 px-4 py-6 text-center ${shieldButtonClass}`}
      >
        {preview ? (
          <div className="relative flex min-h-44 w-full max-w-[240px] items-center justify-center overflow-hidden rounded-xl border border-outline/25 bg-surface-container-lowest sm:min-h-52">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Custom lingerie reference" className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white bg-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            <span className="text-sm font-bold uppercase tracking-[0.12em] text-on-primary">Select lingerie — upload</span>
            <span className="max-w-[240px] text-xs leading-relaxed text-on-primary/80">
              Flat lay or product photo. PNG or JPG.
            </span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileChange(file);
        }}
      />
      {preview && (
        <button
          type="button"
          onClick={() => {
            onClear();
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Clear custom upload
        </button>
      )}
    </div>
  );
}

// ─── StepIndicator ────────────────────────────────────────────────────────────
function StepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1 as const, label: "Your photo" },
    { n: 2 as const, label: "Your set" },
    { n: 3 as const, label: "Generate" },
  ];
  return (
    <div className="flex items-center justify-center gap-8 border-b border-outline/30 pb-5 sm:gap-12">
      {steps.map(({ n, label }) => {
        const done = currentStep > n;
        const isActive = currentStep === n;
        const circleClass =
          done || isActive
            ? "flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary"
            : "flex h-8 w-8 items-center justify-center rounded-full bg-surface-container text-xs font-bold text-primary";
        return (
          <div key={n} className="flex flex-col items-center gap-2">
            <div className={circleClass}>
              <span>{done ? "✓" : n}</span>
            </div>
            <span className="font-label text-[10px] font-medium uppercase tracking-[0.2em] text-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── HomePage ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [selectedLookId, setSelectedLookId] = useState<string | null>(null);
  const [presetLooks, setPresetLooks] = useState<PresetLook[]>([]);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [apiSuccess, setApiSuccess] = useState<ApiSuccess | null>(null);
  const inFlightRef = useRef(false);
  const stepTryOnRef = useRef<HTMLDivElement>(null);
  const portraitScanContainerRef = useRef<HTMLDivElement>(null);
  const portraitScanImageRef = useRef<HTMLImageElement>(null);
  const [bodyScanResult, setBodyScanResult] = useState<BodyScanApiResponse | null>(null);
  const [bodyScanLoading, setBodyScanLoading] = useState(false);

  const personPreview = useMemo(() => {
    if (!personFile) return null;
    return URL.createObjectURL(personFile);
  }, [personFile]);

  const garmentPreview = useMemo(() => {
    if (!garmentFile) return null;
    return URL.createObjectURL(garmentFile);
  }, [garmentFile]);

  const garmentDescriptionForPrompt = useMemo(() => {
    if (selectedLookId && presetLooks.length > 0) {
      const look = presetLooks.find((l) => l.id === selectedLookId);
      if (look?.title) return look.title;
    }
    return "Custom uploaded garment (Image B)";
  }, [selectedLookId, presetLooks]);

  useEffect(() => {
    return () => {
      if (personPreview) URL.revokeObjectURL(personPreview);
    };
  }, [personPreview]);

  useEffect(() => {
    return () => {
      if (garmentPreview) URL.revokeObjectURL(garmentPreview);
    };
  }, [garmentPreview]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/preset-looks?audience=women&category=Lingerie");
        if (!res.ok) {
          if (!cancelled) setPresetLooks([]);
          return;
        }
        const data = (await res.json()) as { success: boolean; looks?: PresetLook[] };
        if (!cancelled) {
          setPresetLooks(data.success && Array.isArray(data.looks) ? data.looks : []);
        }
      } catch {
        if (!cancelled) setPresetLooks([]);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (currentStep !== 3) return;
    const t = window.setTimeout(() => {
      stepTryOnRef.current?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    }, 100);
    return () => window.clearTimeout(t);
  }, [currentStep]);

  useEffect(() => {
    if (!personFile) {
      setBodyScanResult(null);
      setBodyScanLoading(false);
      return;
    }
    let cancelled = false;
    setBodyScanLoading(true);
    setBodyScanResult(null);
    const fd = new FormData();
    fd.append("image", personFile);
    void (async () => {
      try {
        const res = await fetch("/api/body-scan-from-image", { method: "POST", body: fd });
        const data = (await res.json()) as BodyScanApiResponse | { success?: boolean; error?: unknown };
        if (cancelled) return;
        if (
          res.ok && data && typeof data === "object" &&
          "success" in data && data.success === true &&
          "keypoints" in data &&
          Array.isArray((data as BodyScanApiResponse).measurementValues)
        ) {
          setBodyScanResult(data as BodyScanApiResponse);
        } else {
          setBodyScanResult(makeFallbackBodyScan());
        }
      } catch {
        if (!cancelled) setBodyScanResult(makeFallbackBodyScan());
      } finally {
        if (!cancelled) setBodyScanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [personFile]);

  function handleCustomGarmentFile(file: File) {
    setGarmentFile(file);
    setSelectedLookId(null);
    setCurrentStep(3);
  }

  function clearCustomGarment() {
    setGarmentFile(null);
    setSelectedLookId(null);
  }

  async function selectPresetLook(look: PresetLook) {
    setSelectedLookId(look.id);
    try {
      const res = await fetch(look.imageSrc);
      const blob = await res.blob();
      const ext = look.imageSrc.match(/\.[^./\\]+$/)?.[0] ?? ".jpg";
      const file = new File([blob], `${look.id}${ext}`, { type: blob.type || "image/jpeg" });
      setGarmentFile(file);
      setCurrentStep(3);
    } catch {
      setSelectedLookId(null);
      setGarmentFile(null);
    }
  }

  async function handleGenerate() {
    if (!personFile || !garmentFile) return;
    if (isSubmitting || inFlightRef.current) return;
    inFlightRef.current = true;
    const requestId = createRequestId();
    setIsSubmitting(true);
    setApiError(null);
    setApiSuccess(null);
    try {
      const formData = new FormData();
      formData.append("targetImage", personFile);
      formData.append("garmentImage", garmentFile);
      formData.append("requestId", requestId);
      formData.append("garmentDescription", garmentDescriptionForPrompt);
      const res = await fetch(SEEDREAM_ENDPOINT, { method: "POST", body: formData });
      const data = (await res.json()) as ApiSuccess | ApiError;
      if (!res.ok) {
        setApiError((data as ApiError) ?? { success: false, error: { message: "Request failed." } });
        return;
      }
      const success = data as ApiSuccess;
      setApiSuccess(success);
      setCurrentStep(4);
      void fetch("/api/events/try-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedLookId ?? "custom_upload",
          userFitPreference: "Regular",
          matchConfidence: 0.95,
        }),
      }).catch(() => {});
    } catch (error) {
      setApiError({
        success: false,
        error: { message: "Network error. Please try again.", details: { reason: error instanceof Error ? error.message : "Unknown error" } },
      });
    } finally {
      setIsSubmitting(false);
      inFlightRef.current = false;
    }
  }

  function resetFlow() {
    setPersonFile(null);
    setGarmentFile(null);
    setSelectedLookId(null);
    setCurrentStep(1);
    setApiError(null);
    setApiSuccess(null);
    setBodyScanResult(null);
    setBodyScanLoading(false);
  }

  const resultUrl =
    apiSuccess?.image?.type === "data_url"
      ? apiSuccess.image.value
      : apiSuccess?.image?.type === "url"
        ? apiSuccess.image.value
        : null;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-surface text-foreground">
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-fixed"
        style={{ backgroundImage: `url('${HERO_IMG}')` }}
        aria-hidden
      />
      <div className="pointer-events-none fixed inset-0 z-[1] bg-surface-container-lowest/55" aria-hidden />

      <div className="relative z-10 flex w-full flex-col">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-10 text-center sm:px-6 sm:py-14">

          {/* ─── Header (logo over full-bleed hero — no inner banner image) ─── */}
          <header className="mb-10 w-full">
            <div className="flex flex-col items-center justify-center gap-1.5 py-10 sm:py-12">
              <h1 className="font-headline serif-title text-glow text-[44px] font-bold leading-none tracking-[0.35em] text-foreground [text-shadow:0_2px_28px_rgba(0,0,0,0.9)]">
                VESTI
              </h1>
              <div className="h-px w-[90px] bg-primary [box-shadow:0_0_12px_rgba(211,18,26,0.45)]" />
              <p className="font-label m-0 text-[10px] font-light tracking-[0.5em] text-primary [text-shadow:0_1px_16px_rgba(0,0,0,0.85)]">
                LINGERIE
              </p>
            </div>
            <p className="mx-auto mt-4 max-w-md text-center text-sm leading-relaxed text-muted-foreground">
              Private try-on. One portrait. Your set. Instant confidence. ✦
            </p>
          </header>

          {currentStep < 4 && <StepIndicator currentStep={currentStep} />}

          <div className="mt-10 w-full flex-1">
            <AnimatePresence mode="wait">

              {/* ─── שלב 1: העלאת תמונה ─── */}
              {currentStep === 1 && (
                <motion.div
                  key="s1"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="mx-auto flex w-full flex-col items-center"
                >
                  <UploadPortraitCard
                    preview={personPreview}
                    onFileChange={setPersonFile}
                    onClear={() => setPersonFile(null)}
                  />
                  {personPreview && bodyScanLoading && (
                    <p className="mt-3 max-w-md text-xs text-muted-foreground">
                      Mapping your silhouette for accurate sizing…
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={!personFile}
                    onClick={() => setCurrentStep(2)}
                    className={`mt-8 w-full max-w-md px-6 py-3.5 text-sm uppercase tracking-[0.18em] ${shieldButtonClass}`}
                  >
                    Continue
                  </button>
                </motion.div>
              )}

              {/* ─── שלב 2: בחירת סט ─── */}
              {currentStep === 2 && !isSubmitting && (
                <motion.div
                  key="s2"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                  className="mx-auto flex w-full flex-col items-center text-center"
                >
                  <p className="mb-6 text-sm text-muted-foreground">
                    Upload your own reference, or choose a preset from our gallery.
                  </p>

                  <CustomGarmentUpload
                    preview={selectedLookId === null ? garmentPreview : null}
                    onFileChange={handleCustomGarmentFile}
                    onClear={clearCustomGarment}
                  />

                  <div className="my-8 flex w-full max-w-md items-center gap-4">
                    <div className="h-px flex-1 bg-white/15" />
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                      Presets
                    </span>
                    <div className="h-px flex-1 bg-white/15" />
                  </div>

                  {presetLooks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading sets…</p>
                  ) : (
                    <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
                      {presetLooks.map((look) => {
                        const selected = selectedLookId === look.id;
                        return (
                          <button
                            key={look.id}
                            type="button"
                            onClick={() => void selectPresetLook(look)}
                            className={
                              selected
                                ? `${shieldButtonClass} rose-glow rounded-2xl p-1 ring-2 ring-primary`
                                : `${shieldButtonClass} rounded-2xl p-1 opacity-95 transition-shadow hover:opacity-100 hover:rose-glow`
                            }
                          >
                            <div
                              className="relative w-full overflow-hidden rounded-xl"
                              style={{
                                height: "200px",
                                backgroundImage: `url('${VELVET_BG}')`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={look.imageSrc}
                                alt={look.title}
                                className="h-full w-full object-contain"
                              />
                            </div>
                            <p className="px-2 py-2 text-center text-xs font-medium leading-snug text-foreground">
                              {look.title}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-10 flex w-full max-w-md justify-center">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      className={`px-8 py-3 text-sm font-semibold text-on-primary ${shieldButtonClass}`}
                    >
                      Back
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ─── שלב 3: גנרציה ─── */}
              {currentStep === 3 && (
                <div key="s3" ref={stepTryOnRef} className="scroll-mt-28">
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                    className="mx-auto flex w-full flex-col items-center text-center"
                  >
                    <div className="mb-8 flex w-full flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-8">
                      {/* תמונת האדם */}
                      {personPreview && (
                        <div className="flex w-full max-w-[280px] flex-col items-center gap-2">
                          <div
                            ref={portraitScanContainerRef}
                            className={`relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-outline/25 bg-surface-container-lowest ${
                              isSubmitting ? "h-[400px]" : "h-[400px]"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              ref={portraitScanImageRef}
                              src={personPreview}
                              alt=""
                              className="relative z-0 max-h-full max-w-full object-contain"
                            />
                            <BodyScanOverlay
                              active={isSubmitting}
                              containerRef={portraitScanContainerRef}
                              imageRef={portraitScanImageRef}
                              keypoints={bodyScanResult?.keypoints ?? FALLBACK_KEYPOINTS}
                              measurementValues={bodyScanResult?.measurementValues ?? FALLBACK_MEASUREMENTS}
                            />
                          </div>
                          <span className="text-xs uppercase tracking-widest text-muted-foreground">You</span>
                        </div>
                      )}

                      {/* תמונת הסט — אותו גודל בדיוק */}
                      {garmentPreview && !isSubmitting && (
                        <div className="flex w-full max-w-[280px] flex-col items-center gap-2">
                          <div
                            className="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-outline/25 bg-surface-container-lowest"
                            style={{ height: "400px" }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={garmentPreview}
                              alt=""
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <span className="text-xs uppercase tracking-widest text-muted-foreground">Set</span>
                        </div>
                      )}
                    </div>

                    {apiError && (
                      <p className="mb-6 max-w-md rounded-xl border border-primary bg-surface-container/90 px-4 py-3 text-sm text-foreground">
                        {apiError.error?.message ?? "Something went wrong."}
                      </p>
                    )}

                    <button
                      type="button"
                      disabled={!personFile || !garmentFile || isSubmitting}
                      onClick={() => void handleGenerate()}
                      className={`relative inline-flex min-h-[3.5rem] w-full max-w-md touch-manipulation items-center justify-center overflow-hidden px-6 py-4 text-base font-bold uppercase tracking-[0.14em] sm:px-8 sm:tracking-[0.18em] ${shieldButtonClass}`}
                    >
                      {isSubmitting ? (
                        <span className="relative z-[1] text-center text-[11px] font-bold leading-snug tracking-[0.06em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] sm:text-sm sm:tracking-[0.1em]">
                          AI Analysis &amp; Lingerie Fusion in Progress...
                        </span>
                      ) : (
                        <span className="relative z-[1] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">Generate</span>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setCurrentStep(2)}
                      className="mt-6 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Back
                    </button>
                  </motion.div>
                </div>
              )}

              {/* ─── שלב 4: תוצאה ─── */}
              {currentStep === 4 && resultUrl && (
                <motion.div
                  key="s4"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mx-auto flex w-full flex-col items-center text-center"
                >
                  <div className="mx-auto w-full max-w-2xl rounded-2xl border border-outline/30 bg-surface-container p-2 shadow-[0_0_60px_rgba(211,18,26,0.18)] sm:p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resultUrl}
                      alt="Your Vesti Lingerie try-on result"
                      className="mx-auto max-h-[min(78vh,720px)] w-full object-contain"
                    />
                  </div>

                  <div className="mt-10 w-full max-w-md rounded-2xl border border-outline/30 bg-surface-container/80 px-6 py-6 backdrop-blur-sm">
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Fit insight</p>
                    <p className="mt-4 text-lg font-medium leading-relaxed text-foreground">
                      AI Body Scan Complete. Your perfect fit for this set is{" "}
                      <span className="whitespace-nowrap font-semibold text-foreground">
                        {bodyScanResult?.recommendedBraSize ?? "—"}
                      </span>
                      .
                    </p>
                    {bodyScanResult?.bodyAnalysis && (
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                        {bodyScanResult.bodyAnalysis}
                      </p>
                    )}
                    <p className="mt-3 text-[11px] text-muted-foreground/80">
                      Confidence: {bodyScanResult?.confidence ?? "—"}
                      {bodyScanResult?.fallback ? " · Estimate only" : ""}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Sizing is illustrative for this experience. Always confirm in-store or with a fit specialist.
                    </p>
                  </div>

                  <ShopTheLookButton resultUrl={resultUrl} garmentFile={garmentFile} />

                  <button
                    type="button"
                    onClick={resetFlow}
                    className="mt-8 text-xs font-semibold uppercase tracking-widest text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Try another look
                  </button>
                </motion.div>
              )}

            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}