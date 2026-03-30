"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const fitOptions = ["Slim", "Regular", "Oversize"] as const;

/** CDN builds — must match installed npm versions for locateFile consistency. */
const MP_POSE_VER = "0.5.1675469404";
const MP_CAM_VER = "0.3.1675466862";
const MP_DRAW_VER = "0.3.1675466124";

const SCRIPT_POSE = `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${MP_POSE_VER}/pose.js`;
const SCRIPT_CAMERA = `https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@${MP_CAM_VER}/camera_utils.js`;
const SCRIPT_DRAW = `https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@${MP_DRAW_VER}/drawing_utils.js`;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-mp-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.mpSrc = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}

function poseAssetUrl(file: string) {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${MP_POSE_VER}/${file}`;
}

type NormalizedLandmarkList = Array<{
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}>;

type MpPose = {
  setOptions: (o: Record<string, unknown>) => void;
  onResults: (cb: (results: { poseLandmarks?: NormalizedLandmarkList }) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close: () => Promise<void>;
};

type MpPoseCtor = new (config?: { locateFile?: (file: string) => string }) => MpPose;

type MpCamera = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type MpCameraCtor = new (
  video: HTMLVideoElement,
  options: { onFrame: () => Promise<void> | void; width?: number; height?: number; facingMode?: string },
) => MpCamera;

/** MediaPipe pose indices (full-body model). */
const LM_LEFT_EYE_INNER = 1;
const LM_LEFT_SHOULDER = 11;
const LM_RIGHT_SHOULDER = 12;
const LM_LEFT_HEEL = 29;

function distancePixels2D(
  a: { x: number; y: number },
  b: { x: number; y: number },
  imageWidthPx: number,
  imageHeightPx: number,
): number {
  const dxPx = (b.x - a.x) * imageWidthPx;
  const dyPx = (b.y - a.y) * imageHeightPx;
  return Math.sqrt(dxPx * dxPx + dyPx * dyPx);
}

declare global {
  interface Window {
    Pose?: MpPoseCtor;
    Camera?: MpCameraCtor;
    POSE_CONNECTIONS?: Array<[number, number]>;
    drawConnectors?: (
      ctx: CanvasRenderingContext2D,
      landmarks: NormalizedLandmarkList | undefined,
      connections: Array<[number, number]>,
      style?: Record<string, unknown>,
    ) => void;
    drawLandmarks?: (
      ctx: CanvasRenderingContext2D,
      landmarks: NormalizedLandmarkList | undefined,
      style?: Record<string, unknown>,
    ) => void;
  }
}

export function BodyScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestLandmarksRef = useRef<NormalizedLandmarkList | null>(null);
  const [userHeightCm, setUserHeightCm] = useState(170);
  const [shoulderWidthCm, setShoulderWidthCm] = useState<number | null>(null);
  const [measurementMessage, setMeasurementMessage] = useState<string | null>(null);
  const [productUrl, setProductUrl] = useState("");
  const [fitPreference, setFitPreference] = useState("Regular");
  const [sizeLoading, setSizeLoading] = useState(false);
  const [sizeRecommended, setSizeRecommended] = useState<string | null>(null);
  const [sizeReasoning, setSizeReasoning] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);

  const calculateMeasurements = useCallback(
    (landmarks: NormalizedLandmarkList | null) => {
      const video = videoRef.current;
      if (!landmarks || landmarks.length < 33) {
        setShoulderWidthCm(null);
        setMeasurementMessage("Full pose not visible — need landmarks for eyes, shoulders, and feet.");
        return;
      }

      if (!video) {
        setMeasurementMessage("Camera not ready.");
        return;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) {
        setMeasurementMessage("Video dimensions not ready yet.");
        return;
      }

      const heightCm = Number(userHeightCm);
      if (!Number.isFinite(heightCm) || heightCm <= 0) {
        setShoulderWidthCm(null);
        setMeasurementMessage("Enter your height in centimeters.");
        return;
      }

      const eye = landmarks[LM_LEFT_EYE_INNER];
      const heel = landmarks[LM_LEFT_HEEL];
      const leftShoulder = landmarks[LM_LEFT_SHOULDER];
      const rightShoulder = landmarks[LM_RIGHT_SHOULDER];

      if (!eye || !heel || !leftShoulder || !rightShoulder) {
        setShoulderWidthCm(null);
        setMeasurementMessage("Missing key points — stay in frame (full body if possible).");
        return;
      }

      const bodyHeightPx = distancePixels2D(eye, heel, w, h);
      if (bodyHeightPx <= 1e-6) {
        setShoulderWidthCm(null);
        setMeasurementMessage("Could not estimate body span in pixels.");
        return;
      }

      const pixelsPerCm = bodyHeightPx / heightCm;
      const shoulderPx = distancePixels2D(leftShoulder, rightShoulder, w, h);
      const shoulderCm = shoulderPx / pixelsPerCm;

      setShoulderWidthCm(shoulderCm);
      setMeasurementMessage(null);
    },
    [userHeightCm],
  );

  const onCalculateShoulderWidth = useCallback(() => {
    calculateMeasurements(latestLandmarksRef.current);
  }, [calculateMeasurements]);

  const fetchSizeRecommendation = useCallback(async () => {
    if (shoulderWidthCm === null) return;

    setSizeLoading(true);
    setSizeError(null);
    setSizeRecommended(null);
    setSizeReasoning(null);

    try {
      const res = await fetch("/api/size-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productUrl: productUrl.trim(),
          userHeight: userHeightCm,
          bodyAnalysis: "Shoulder width is " + shoulderWidthCm + " cm",
          fitPreference,
        }),
      });
      const data = (await res.json()) as {
        recommendedSize?: string;
        reasoning?: string;
        error?: string;
        raw?: string;
      };

      if (!res.ok || data.error) {
        setSizeError(typeof data.error === "string" ? data.error : "Could not get size recommendation.");
        return;
      }

      setSizeRecommended(data.recommendedSize ?? null);
      setSizeReasoning(data.reasoning ?? null);
    } catch {
      setSizeError("Network error. Please try again.");
    } finally {
      setSizeLoading(false);
    }
  }, [fitPreference, productUrl, shoulderWidthCm, userHeightCm]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const videoEl = video;
    const canvasEl = canvas;

    let cancelled = false;
    const ctx2d = canvasEl.getContext("2d");
    if (!ctx2d) return;
    const ctx = ctx2d;

    let pose: MpPose | null = null;
    let camera: MpCamera | null = null;

    async function setup() {
      await loadScriptOnce(SCRIPT_POSE);
      await loadScriptOnce(SCRIPT_CAMERA);
      await loadScriptOnce(SCRIPT_DRAW);
      if (cancelled) return;

      const PoseCtor = window.Pose;
      const CameraCtor = window.Camera;
      const connections = window.POSE_CONNECTIONS;
      const drawConnectors = window.drawConnectors;
      const drawLandmarks = window.drawLandmarks;

      if (!PoseCtor || !CameraCtor || !connections || !drawConnectors || !drawLandmarks) {
        // eslint-disable-next-line no-console
        console.error("[BodyScanner] MediaPipe globals missing after script load.");
        return;
      }

      pose = new PoseCtor({ locateFile: poseAssetUrl });
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results) => {
        if (cancelled) return;
        const w = videoEl.videoWidth;
        const h = videoEl.videoHeight;
        if (w && h) {
          canvasEl.width = w;
          canvasEl.height = h;
        }
        ctx.save();
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        const landmarks = results.poseLandmarks;
        latestLandmarksRef.current = landmarks ?? null;
        if (landmarks) {
          drawConnectors(ctx, landmarks, connections, {
            color: "#FF2800",
            lineWidth: 3,
          });
          drawLandmarks(ctx, landmarks, {
            color: "#FF2800",
            lineWidth: 1,
            radius: 4,
            fillColor: "rgba(255, 40, 0, 0.35)",
          });
        }
        ctx.restore();
      });

      camera = new CameraCtor(videoEl, {
        onFrame: async () => {
          if (cancelled || !pose) return;
          await pose.send({ image: videoEl });
        },
        width: 1280,
        height: 720,
        facingMode: "user",
      });

      await camera.start().catch(() => {
        /* permission / device */
      });
    }

    void setup();

    return () => {
      cancelled = true;
      void camera?.stop();
      void pose?.close();
      camera = null;
      pose = null;
      latestLandmarksRef.current = null;
    };
  }, []);

  const capturePose = useCallback(() => {
    const lm = latestLandmarksRef.current;
    // eslint-disable-next-line no-console -- dev: inspect pose snapshot
    console.log("[BodyScanner] pose landmarks:", lm);
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md sm:p-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#FF2800]">Body measurement</p>
        <h2 className="mb-4 text-lg font-semibold text-white">Live pose</h2>

        <div className="mb-4 rounded-xl border border-white/10 bg-black/35 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md">
          <label htmlFor="user-height-cm" className="text-xs font-semibold uppercase tracking-widest text-[#FF2800]">
            Your height (cm)
          </label>
          <input
            id="user-height-cm"
            type="number"
            min={100}
            max={250}
            step={0.1}
            value={userHeightCm}
            onChange={(e) => setUserHeightCm(Number(e.target.value))}
            className="mt-2 w-full rounded-lg border border-white/15 bg-black/50 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent transition-[border,box-shadow] placeholder:text-white/30 focus:border-[#FF2800]/50 focus:ring-[#FF2800]/25"
          />
          <p className="mt-2 text-[11px] leading-relaxed text-[rgba(255,255,255,0.6)]">
            Used to scale pixel distances. Stand so your full body fits in frame for best accuracy.
          </p>
        </div>

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/10 bg-black/50 ring-1 ring-[#FF2800]/20">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            width={1280}
            height={720}
          />
        </div>

        <p className="mt-3 text-xs text-[rgba(255,255,255,0.6)]">
          Allow camera access. Stand so your full upper body is visible for best tracking.
        </p>

        {(shoulderWidthCm !== null || measurementMessage) && (
          <div className="mt-5 rounded-2xl border border-[#FF2800]/25 bg-black/40 p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_32px_rgba(255,40,0,0.08)] backdrop-blur-md sm:text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#FF2800]">Shoulder width (estimate)</p>
            {shoulderWidthCm !== null ? (
              <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-white">
                {shoulderWidthCm.toFixed(1)}
                <span className="ml-1 text-lg font-semibold text-white/60">cm</span>
              </p>
            ) : (
              <p className="mt-2 text-sm text-[rgba(255,255,255,0.6)]">{measurementMessage}</p>
            )}
            {shoulderWidthCm !== null && (
              <p className="mt-3 text-xs leading-relaxed text-[rgba(255,255,255,0.6)]">
                Based on eye-to-heel pixel span vs your stated height, then shoulder landmark spacing. For
                demonstration — not medical grade.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCalculateShoulderWidth}
            className="flex-1 rounded-xl border border-[#FF2800]/50 bg-[#FF2800]/15 py-3.5 text-sm font-semibold uppercase tracking-widest text-white shadow-[0_0_24px_rgba(255,40,0,0.2)] backdrop-blur-sm transition-colors hover:border-[#FF2800] hover:bg-[#FF2800]/25"
          >
            Calculate Shoulder Width
          </button>
          <button
            type="button"
            onClick={capturePose}
            className="flex-1 rounded-xl border border-[#FF2800]/40 bg-[#FF2800]/10 py-3.5 text-sm font-semibold uppercase tracking-widest text-white shadow-[0_0_24px_rgba(255,40,0,0.15)] backdrop-blur-sm transition-colors hover:border-[#FF2800]/70 hover:bg-[#FF2800]/20"
          >
            Capture Pose
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-black/35 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md">
          <label htmlFor="body-scan-product-url" className="text-xs font-semibold uppercase tracking-widest text-[#FF2800]">
            Product link
          </label>
          <input
            id="body-scan-product-url"
            type="url"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://..."
            className="mt-2 w-full rounded-lg border border-white/15 bg-black/50 px-4 py-3 text-sm text-white outline-none ring-1 ring-transparent placeholder:text-white/30 focus:border-[#FF2800]/50 focus:ring-[#FF2800]/25"
          />
          <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-md">
            <p className="mb-3 text-xs uppercase tracking-widest text-white/50">Fit preference</p>
            <p className="mb-3 text-xs leading-relaxed text-white/45">
              How do you like clothes to fit in this garment? We adjust ease and sizing math accordingly.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {fitOptions.map((option) => {
                const selected = fitPreference === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFitPreference(option)}
                    className={`rounded-xl border px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider backdrop-blur-md transition-all sm:text-sm ${
                      selected
                        ? "border-[#FF2800] bg-[#FF2800]/15 text-white shadow-[0_0_20px_rgba(255,40,0,0.25)] ring-1 ring-[#FF2800]/40"
                        : "border-white/15 bg-white/[0.06] text-white/65 hover:border-white/25 hover:text-white/90"
                    }`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void fetchSizeRecommendation()}
            disabled={shoulderWidthCm === null || sizeLoading || !productUrl.trim()}
            className="mt-4 w-full rounded-xl border border-[#FF2800]/45 bg-[#FF2800]/12 py-3.5 text-sm font-semibold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(255,40,0,0.12)] backdrop-blur-sm transition-colors hover:border-[#FF2800]/70 hover:bg-[#FF2800]/22 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Get Size Recommendation
          </button>
          <p className="mt-2 text-[11px] text-[rgba(255,255,255,0.6)]">
            Calculate shoulder width first, then paste a store product URL.
          </p>
        </div>

        {sizeLoading && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 px-5 py-6 text-center backdrop-blur-md">
            <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-[#FF2800] border-t-transparent" />
            <p className="text-sm font-medium text-white/80">Analyzing fit…</p>
          </div>
        )}

        {!sizeLoading && sizeError && (
          <div className="mt-4 rounded-2xl border border-[#FF2800]/30 bg-black/40 px-5 py-4 text-sm text-white backdrop-blur-md">
            {sizeError}
          </div>
        )}

        {!sizeLoading && !sizeError && (sizeRecommended || sizeReasoning) && (
          <div className="mt-4 rounded-2xl border border-[#FF2800]/30 bg-black/45 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#FF2800]">Size recommendation</p>
            {sizeRecommended && (
              <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-white">{sizeRecommended}</p>
            )}
            {sizeReasoning && (
              <p className="mt-4 text-sm leading-relaxed text-white/75">{sizeReasoning}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
