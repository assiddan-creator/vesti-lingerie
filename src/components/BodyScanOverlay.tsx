"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const MEASUREMENTS = [
  { key: "shoulders", label: "SHOULDERS", final: "41 cm" },
  { key: "bust", label: "BUST", final: "34" },
  { key: "waist", label: "WAIST", final: "28" },
  { key: "hips", label: "HIPS", final: "38" },
] as const;

type BodyScanOverlayProps = {
  active: boolean;
  className?: string;
};

export function BodyScanOverlay({ active, className = "" }: BodyScanOverlayProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    setTick(0);
    const id = window.setInterval(() => setTick((t) => t + 1), 520);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) return null;

  function lineFor(idx: number) {
    const m = MEASUREMENTS[idx];
    const threshold = 2 + idx * 2;
    if (tick < threshold) {
      return `${m.label}: Analyzing...`;
    }
    return `${m.label}: ${m.final}`;
  }

  const labelSlots = [
    { x: 50, y: 17, text: lineFor(0) },
    { x: 50, y: 35, text: lineFor(1) },
    { x: 50, y: 50, text: lineFor(2) },
    { x: 50, y: 65, text: lineFor(3) },
  ];

  const shoulderDots = [
    { x: 22, y: 21 },
    { x: 78, y: 21 },
  ];

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden rounded-xl ${className}`}
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
            <p className="text-[10px] font-bold leading-tight tracking-wide text-white sm:text-[11px]">{slot.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
