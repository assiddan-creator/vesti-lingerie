/** Normalized keypoints (0–1), origin top-left. */
export type BodyKeypoints = {
  leftShoulder: { x: number; y: number };
  rightShoulder: { x: number; y: number };
  bust: { x: number; y: number };
  waist: { x: number; y: number };
  hips: { x: number; y: number };
};

export type BodyScanApiResponse = {
  success: true;
  keypoints: BodyKeypoints;
  /** Display strings for SHOULDERS / BUST / WAIST / HIPS rows */
  measurementValues: [string, string, string, string];
  recommendedBraSize: string;
  bodyAnalysis: string | null;
  confidence: "high" | "medium" | "low";
  fallback?: boolean;
};

export const FALLBACK_KEYPOINTS: BodyKeypoints = {
  leftShoulder: { x: 0.22, y: 0.21 },
  rightShoulder: { x: 0.78, y: 0.21 },
  bust: { x: 0.5, y: 0.36 },
  waist: { x: 0.5, y: 0.51 },
  hips: { x: 0.5, y: 0.66 },
};

export const FALLBACK_MEASUREMENTS: [string, string, string, string] = ["—", "—", "—", "—"];

/**
 * Maps vision keypoints (0–1 in full image space) to percentage positions inside a container
 * that displays the image with CSS `object-contain` (letterboxed).
 */
export function mapNormalizedToContainBox(
  nx: number,
  ny: number,
  containerW: number,
  containerH: number,
  naturalW: number,
  naturalH: number,
): { xPct: number; yPct: number } {
  if (
    containerW <= 0 ||
    containerH <= 0 ||
    naturalW <= 0 ||
    naturalH <= 0 ||
    !Number.isFinite(nx) ||
    !Number.isFinite(ny)
  ) {
    return { xPct: nx * 100, yPct: ny * 100 };
  }
  const scale = Math.min(containerW / naturalW, containerH / naturalH);
  const dispW = naturalW * scale;
  const dispH = naturalH * scale;
  const offX = (containerW - dispW) / 2;
  const offY = (containerH - dispH) / 2;
  const px = offX + nx * dispW;
  const py = offY + ny * dispH;
  return { xPct: (px / containerW) * 100, yPct: (py / containerH) * 100 };
}

export function makeFallbackBodyScan(): BodyScanApiResponse {
  return {
    success: true,
    keypoints: FALLBACK_KEYPOINTS,
    measurementValues: FALLBACK_MEASUREMENTS,
    recommendedBraSize: "—",
    bodyAnalysis: null,
    confidence: "low",
    fallback: true,
  };
}
