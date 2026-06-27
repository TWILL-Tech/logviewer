// Per-channel summary statistics + histogram, computed once at parse time.

import type { ChannelStats } from "./types";

const HIST_BINS = 24;

/**
 * Compute stats over a typed array (Float32 or Int32). NaN values are counted
 * and excluded from min/max/mean/std.
 */
export function computeStats(data: ArrayLike<number>): ChannelStats {
  const n = data.length;
  let nanCount = 0;
  let min = Infinity;
  let max = -Infinity;

  // Welford's algorithm for a numerically stable mean/variance.
  let count = 0;
  let mean = 0;
  let m2 = 0;

  // Distinct counting, capped to avoid pathological memory on continuous data.
  const distinctCap = 1024;
  const seen = new Set<number>();
  let distinctCapped = false;

  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (Number.isNaN(v)) {
      nanCount++;
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
    count++;
    const delta = v - mean;
    mean += delta / count;
    m2 += delta * (v - mean);

    if (!distinctCapped) {
      seen.add(v);
      if (seen.size > distinctCap) distinctCapped = true;
    }
  }

  if (count === 0) {
    min = NaN;
    max = NaN;
    mean = NaN;
  }
  const std = count > 1 ? Math.sqrt(m2 / (count - 1)) : 0;
  const cv = Math.abs(mean) > 1e-12 ? std / Math.abs(mean) : NaN;

  // Build the histogram in a second pass now that min/max are known.
  const bins = new Array(HIST_BINS).fill(0);
  if (count > 0 && max > min) {
    const scale = HIST_BINS / (max - min);
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (Number.isNaN(v)) continue;
      let b = ((v - min) * scale) | 0;
      if (b >= HIST_BINS) b = HIST_BINS - 1;
      if (b < 0) b = 0;
      bins[b]++;
    }
  } else if (count > 0) {
    // All values equal: pile into the middle bin so the sparkline shows a spike.
    bins[HIST_BINS >> 1] = count;
  }

  return {
    count,
    nanCount,
    min,
    max,
    mean,
    std,
    cv,
    distinct: distinctCapped ? distinctCap : seen.size,
    distinctCapped,
    histogram: { bins, min, max },
  };
}
