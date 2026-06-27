// Tiny histogram sparkline drawn on a per-row canvas. Helps judge a channel's
// distribution at a glance when culling series.

import { useEffect, useRef } from "react";

interface Props {
  bins: number[];
  color: string;
  width?: number;
  height?: number;
}

export function Sparkline({ bins, color, width = 70, height = 20 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const n = bins.length;
    if (!n) return;
    let max = 0;
    for (const b of bins) if (b > max) max = b;
    if (max <= 0) return;

    const bw = width / n;
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const h = (bins[i] / max) * (height - 1);
      ctx.fillRect(i * bw, height - h, Math.max(1, bw - 0.5), h);
    }
  }, [bins, color, width, height]);

  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}
