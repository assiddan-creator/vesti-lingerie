"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PresetLook } from "../lib/preset-looks";

/** Frontend always uses Seedream 5 Lite (`bytedance/seedream-5-lite` on the server). */
const SEEDREAM_ENDPOINT = "/api/clothes-swap/seedream";

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
    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-white/15 bg-black/50 p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:p-6">
      <div className="flex flex-col items-center gap-1">
        <span className="text-base font-semibold tracking-wide text-white">Your portrait</span>
        <span className="text-sm text-[rgba(255,255,255,0.6)]">Face forward, soft light, shoulders visible.</span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="group relative flex min-h-52 w-full max-w-sm flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF2800]"
      >
        {preview ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl border border-white/10 bg-black/60 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your portrait" className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-white">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-[#FF2800]"
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
            <span className="text-sm font-medium text-[rgba(255,255,255,0.6)] group-hover:text-white">Upload photo</span>
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

      <p className="text-xs text-[rgba(255,255,255,0.6)]">Preview only. Images are processed securely.</p>

      {preview && (
        <button
          type="button"
          onClick={() => {
            onClear();
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:border-[#FF2800]"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  const steps = [
    { n: 1 as const, label: "Your photo" },
    { n: 2 as const, label: "Your set" },
    { n: 3 as const, label: "Try on" },
  ];
  return (
    <div className="flex items-center justify-center gap-8 border-b border-white pb-5 sm:gap-12">
      {steps.map(({ n, label }) => {
        const done = currentStep > n;
        const isActive = currentStep === n;
        const circleClass =
          done || isActive
            ? "flex h-8 w-8 items-center justify-center rounded-full bg-[#FF2800] text-xs font-bold text-white"
            : "flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-bold text-[#FF2800]";
        const showCheck = done;
        return (
          <div key={n} className="flex flex-col items-center gap-2">
            <div className={circleClass}>
              <span>{showCheck ? "✓" : n}</span>
            </div>
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

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

  const personPreview = useMemo(() => {
    if (!personFile) return null;
    return URL.createObjectURL(personFile);
  }, [personFile]);

  const garmentPreview = useMemo(() => {
    if (!garmentFile) return null;
    return URL.createObjectURL(garmentFile);
  }, [garmentFile]);

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
    return () => {
      cancelled = true;
    };
  }, []);

  async function selectPresetLook(look: PresetLook) {
    setSelectedLookId(look.id);
    try {
      const res = await fetch(look.imageSrc);
      const blob = await res.blob();
      const file = new File([blob], `${look.id}.svg`, {
        type: blob.type || "image/svg+xml",
      });
      setGarmentFile(file);
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

      const res = await fetch(SEEDREAM_ENDPOINT, {
        method: "POST",
        body: formData,
      });

      const data = (await res.json()) as ApiSuccess | ApiError;
      if (!res.ok) {
        setApiError(
          (data as ApiError) ?? {
            success: false,
            error: { message: "Request failed." },
          },
        );
        return;
      }

      const success = data as ApiSuccess;
      setApiSuccess(success);
      setCurrentStep(4);

      const productIdForTracking = selectedLookId ?? "custom_upload";
      void fetch("/api/events/try-on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productIdForTracking,
          userFitPreference: "Regular",
          matchConfidence: 0.95,
        }),
      }).catch(() => {});
    } catch (error) {
      setApiError({
        success: false,
        error: {
          message: "Network error. Please try again.",
          details: { reason: error instanceof Error ? error.message : "Unknown error" },
        },
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
  }

  const resultUrl =
    apiSuccess?.image?.type === "data_url"
      ? apiSuccess.image.value
      : apiSuccess?.image?.type === "url"
        ? apiSuccess.image.value
        : null;

  return (
    <div className="min-h-screen bg-[#000000] text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-10 flex w-full flex-col items-center text-center">
          <h1 className="relative inline-block text-3xl font-extralight tracking-[0.35em] text-white sm:text-4xl">
            Vesti Lingerie
            <span className="absolute -bottom-2 left-0 right-0 h-px bg-[#FF2800]" aria-hidden />
          </h1>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-[rgba(255,255,255,0.6)]">
            Private try-on. One portrait. Your set. Instant confidence.
          </p>
        </header>

        {currentStep < 4 && <StepIndicator currentStep={currentStep} />}

        <div className="mt-10 w-full flex-1">
          <AnimatePresence mode="wait">
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
                <button
                  type="button"
                  disabled={!personFile}
                  onClick={() => setCurrentStep(2)}
                  className="mt-8 w-full max-w-md rounded-xl bg-[#FF2800] px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-[0_0_28px_rgba(255,40,0,0.35)] transition-[filter,box-shadow] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continue
                </button>
              </motion.div>
            )}

            {currentStep === 2 && (
              <motion.div
                key="s2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="mx-auto flex w-full flex-col items-center text-center"
              >
                <p className="mb-6 text-sm text-[rgba(255,255,255,0.6)]">
                  Select a Victoria&apos;s Secret–style set. These presets reference our curated lingerie gallery.
                </p>
                {presetLooks.length === 0 ? (
                  <p className="text-sm text-[rgba(255,255,255,0.6)]">Loading sets…</p>
                ) : (
                  <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
                    {presetLooks.map((look) => {
                      const selected = selectedLookId === look.id;
                      return (
                        <button
                          key={look.id}
                          type="button"
                          onClick={() => void selectPresetLook(look)}
                          className={
                            selected
                              ? "rounded-2xl border-2 border-[#FF2800] bg-black/40 p-1 shadow-[0_0_24px_rgba(255,40,0,0.25)]"
                              : "rounded-2xl border border-white/15 bg-black/40 p-1 hover:border-white/30"
                          }
                        >
                          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={look.imageSrc} alt={look.title} className="h-full w-full object-cover" />
                          </div>
                          <p className="px-2 py-2 text-center text-xs font-medium leading-snug text-white">{look.title}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-10 flex w-full max-w-md flex-col items-center gap-3 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="w-full rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-[rgba(255,255,255,0.85)] hover:border-white sm:w-auto"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={!garmentFile}
                    onClick={() => setCurrentStep(3)}
                    className="w-full rounded-xl bg-[#FF2800] px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white shadow-[0_0_28px_rgba(255,40,0,0.35)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {currentStep === 3 && (
              <motion.div
                key="s3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="mx-auto flex w-full flex-col items-center text-center"
              >
                <div className="mb-8 flex w-full flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-8">
                  {personPreview && (
                    <div className="flex flex-col items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={personPreview}
                        alt=""
                        className="h-28 w-28 rounded-xl border border-white/15 object-cover sm:h-32 sm:w-32"
                      />
                      <span className="text-xs uppercase tracking-widest text-[rgba(255,255,255,0.6)]">You</span>
                    </div>
                  )}
                  {garmentPreview && (
                    <div className="flex flex-col items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={garmentPreview}
                        alt=""
                        className="h-28 w-28 rounded-xl border border-white/15 object-cover sm:h-32 sm:w-32"
                      />
                      <span className="text-xs uppercase tracking-widest text-[rgba(255,255,255,0.6)]">Set</span>
                    </div>
                  )}
                </div>

                {apiError && (
                  <p className="mb-6 max-w-md rounded-xl border border-[#FF2800] bg-black/60 px-4 py-3 text-sm text-white">
                    {apiError.error?.message ?? "Something went wrong."}
                  </p>
                )}

                <button
                  type="button"
                  disabled={!personFile || !garmentFile || isSubmitting}
                  onClick={() => void handleGenerate()}
                  className="relative inline-flex min-h-[3.5rem] w-full max-w-md touch-manipulation items-center justify-center overflow-hidden rounded-2xl border-2 border-white bg-black px-8 py-4 text-base font-bold uppercase tracking-[0.28em] text-white shadow-[0_0_48px_rgba(255,40,0,0.55),inset_0_1px_0_rgba(255,255,255,0.12)] transition-[filter,box-shadow] hover:shadow-[0_0_56px_rgba(255,40,0,0.7)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSubmitting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Generating
                    </span>
                  ) : (
                    "Try it on"
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="mt-6 text-xs font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.6)] hover:text-white"
                >
                  Back
                </button>
              </motion.div>
            )}

            {currentStep === 4 && resultUrl && (
              <motion.div
                key="s4"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="mx-auto flex w-full flex-col items-center text-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resultUrl}
                  alt="Your Vesti Lingerie try-on result"
                  className="max-h-[min(70vh,640px)] w-auto max-w-full rounded-2xl border border-white/10 object-contain shadow-[0_0_60px_rgba(255,40,0,0.15)]"
                />

                <div className="mt-10 w-full max-w-md rounded-2xl border border-white/12 bg-black/50 px-6 py-6 backdrop-blur-sm">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#FF2800]">Fit insight</p>
                  <p className="mt-4 text-lg font-medium leading-relaxed text-white">
                    AI Body Scan Complete. Your perfect fit for this set is 34C.
                  </p>
                  <p className="mt-2 text-xs text-[rgba(255,255,255,0.6)]">
                    Sizing is illustrative for this experience. Always confirm in-store or with a fit specialist.
                  </p>
                </div>

                <button
                  type="button"
                  className="mt-8 w-full max-w-md rounded-xl bg-[#FF2800] px-8 py-4 text-sm font-bold uppercase tracking-[0.25em] text-white shadow-[0_0_40px_rgba(255,40,0,0.55)] transition-[filter,box-shadow] hover:brightness-110"
                >
                  Buy now
                </button>

                <button
                  type="button"
                  onClick={resetFlow}
                  className="mt-8 text-xs font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.6)] underline-offset-4 hover:text-white hover:underline"
                >
                  Try another look
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
