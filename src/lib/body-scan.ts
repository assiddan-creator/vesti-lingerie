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
