"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const MEASUREMENTS = [
  { key: "shoulders", label: "SHOULDERS", final: "41 cm" },
  { key: "bust", label: "BUST", final: "34" },
  { key: "waist", label: "WAIST", final: "28" },
  { key: "hips", label: "HIPS", final: "38" },
] as const;

/** Initial “scan” phase — rapid noise / analyzing (ms) */
const WARMUP_MS = 2600;
/** Delay between each measurement locking in (ms) */
const STAGGER_MS = 550;
/** How often to refresh random readings (ms) */
const TICK_MS = 90;

type BodyScanOverlayProps = {
  active: boolean;
  className?: string;
};

function randomReadingForRow(rowIdx: number, salt: number): string {
  const jitter = (n: number, spread: number) =>
    Math.max(0, Math.round(n + (Math.sin(salt * 0.7 + rowIdx + spread) * spread) / 2 + (Math.random() - 0.5) * spread));
  switch (rowIdx) {
    case 0:
      return `${jitter(41, 8)} cm`;
    case 1:
      return `${jitter(34, 6)}`;
    case 2:
      return `${jitter(28, 5)}`;
    case 3:
      return `${jitter(38, 7)}`;
    default:
      return "—";
  }
}

function lineForRow(rowIdx: number, elapsedMs: number, noiseTick: number): string {
  const m = MEASUREMENTS[rowIdx];
  const lockAt = WARMUP_MS + rowIdx * STAGGER_MS;
  if (elapsedMs >= lockAt) {
    return `${m.label}: ${m.final}`;
  }
  if (elapsedMs < WARMUP_MS) {
    if (noiseTick % 14 < 4) {
      return `${m.label}: Analyzing...`;
    }
    return `${m.label}: ${randomReadingForRow(rowIdx, noiseTick)}`;
  }
  return `${m.label}: ${randomReadingForRow(rowIdx, noiseTick)}`;
}

export function BodyScanOverlay({ active, className = "" }: BodyScanOverlayProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [noiseTick, setNoiseTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    setElapsedMs(0);
    setNoiseTick(0);
    const start = performance.now();
    const id = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - start));
      setNoiseTick((n) => n + 1);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  const labelSlots = [
    { x: 50, y: 17, rowIdx: 0 as const },
    { x: 50, y: 35, rowIdx: 1 as const },
    { x: 50, y: 50, rowIdx: 2 as const },
    { x: 50, y: 65, rowIdx: 3 as const },
  ].map((slot) => ({
    ...slot,
    text: lineForRow(slot.rowIdx, elapsedMs, noiseTick),
  }));

  const shoulderDots = [
    { x: 22, y: 21 },
    { x: 78, y: 21 },
  ];

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-xl ${className}`}
      aria-hidden
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <pattern id="body-scan-grid" width="3.5" height="3.5" patternUnits="userSpaceOnUse">
            <path d="M 3.5 0 L 0 0 0 3.5" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.12" />
          </pattern>
          <linearGradient id="body-scan-sweep" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF2800" stopOpacity="0" />
            <stop offset="48%" stopColor="#FF2800" stopOpacity="0.5" />
            <stop offset="52%" stopColor="#FF2800" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#FF2800" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#body-scan-grid)" opacity={0.9} />
        <motion.rect
          x="0"
          width="100"
          height="14"
          fill="url(#body-scan-sweep)"
          initial={{ y: -14 }}
          animate={{ y: 114 }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
        />
        <motion.rect
          x="0"
          width="100"
          height="10"
          fill="url(#body-scan-sweep)"
          initial={{ y: -10 }}
          animate={{ y: 110 }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "linear", delay: 0.9 }}
        />
      </svg>

      {shoulderDots.map((d, i) => (
        <div
          key={`sd-${i}`}
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[#FF2800] shadow-[0_0_12px_#FF2800]"
          style={{ left: `${d.x}%`, top: `${d.y}%` }}
        />
      ))}

      {labelSlots.map((slot, i) => (
        <div
          key={`lbl-${i}`}
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
        >
          <div className="mb-1 h-2 w-2 rounded-full border border-white bg-[#FF2800] shadow-[0_0_12px_#FF2800]" />
          <div className="min-w-[10rem] max-w-[12rem] rounded-md border border-white/30 bg-black/75 px-2 py-1.5 text-center shadow-[0_0_18px_rgba(255,40,0,0.25)] backdrop-blur-[2px]">
            <p className="text-[10px] font-bold leading-tight tracking-wide text-white tabular-nums sm:text-[11px]">
              {slot.text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
