// Multi-resolution min/max/avg "mip pyramid" for fluid pan/zoom.
//
// Each level halves the resolution of the one below; every bucket records the
// min, max and (for non-integral channels) avg of the raw samples it covers.
// Rendering min+max as a band guarantees that even a single-sample spike stays
// visible when zoomed out — unlike shape-preserving decimators (LTTB) which
// deliberately drop outliers.
//
// Buckets are defined over sample *index* (not time), so non-uniform sampling is
// handled by carrying each bucket's representative x. Queries map an x-range to
// an index range by binary search, then pick the level whose bucket size is
// about one pixel.

export interface PyramidLevel {
  /** Raw samples per bucket (2, 4, 8, ...). */
  bucketSize: number;
  len: number;
  x: Float64Array; // bucket representative x (midpoint sample's time)
  min: Float32Array;
  max: Float32Array;
  avg?: Float32Array; // omitted for integral channels
}

export interface ChannelData {
  x: Float64Array; // shared time axis (raw)
  values: Float32Array | Int32Array; // raw samples
  integral: boolean;
  levels: PyramidLevel[];
}

const FACTOR = 2;
/** Stop building levels once a level has <= this many buckets. */
const MIN_BUCKETS = 2;

/** Build the pyramid for one channel over the shared time axis `x`. */
export function buildPyramid(
  x: Float64Array,
  values: Float32Array | Int32Array,
  integral: boolean,
): PyramidLevel[] {
  const n = values.length;
  const levels: PyramidLevel[] = [];
  let bucketSize = FACTOR;
  while (true) {
    const len = Math.ceil(n / bucketSize);
    if (len < MIN_BUCKETS) break;
    levels.push(buildLevel(x, values, bucketSize, len, integral));
    if (len <= MIN_BUCKETS) break;
    bucketSize *= FACTOR;
  }
  return levels;
}

function buildLevel(
  x: Float64Array,
  values: Float32Array | Int32Array,
  bucketSize: number,
  len: number,
  integral: boolean,
): PyramidLevel {
  const bx = new Float64Array(len);
  const bmin = new Float32Array(len);
  const bmax = new Float32Array(len);
  const bavg = integral ? undefined : new Float32Array(len);
  const n = values.length;

  for (let b = 0; b < len; b++) {
    const start = b * bucketSize;
    const end = Math.min(start + bucketSize, n);
    let mn = Infinity;
    let mx = -Infinity;
    let sum = 0;
    let cnt = 0;
    for (let i = start; i < end; i++) {
      const v = values[i];
      if (Number.isNaN(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sum += v;
      cnt++;
    }
    if (cnt === 0) {
      bmin[b] = NaN;
      bmax[b] = NaN;
      if (bavg) bavg[b] = NaN;
    } else {
      bmin[b] = mn;
      bmax[b] = mx;
      if (bavg) bavg[b] = sum / cnt;
    }
    // Representative x: the midpoint sample of the bucket.
    bx[b] = x[Math.min(start + (bucketSize >> 1), n - 1)];
  }

  return { bucketSize, len, x: bx, min: bmin, max: bmax, avg: bavg };
}

/** First index i where arr[i] >= target (lower bound), in [0, arr.length]. */
export function lowerBound(arr: Float64Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Last index i where arr[i] <= target, +1 (upper bound), in [0, arr.length]. */
export function upperBound(arr: Float64Array, target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface QueryResult {
  decimated: boolean;
  x: Float64Array;
  min?: Float32Array;
  max?: Float32Array;
  avg?: Float32Array;
  values?: Float32Array;
}

/**
 * Query a viewport. Returns a raw slice when few enough samples are in view,
 * otherwise the pyramid level whose bucket size is ~1 pixel. All returned
 * arrays are fresh copies (safe to transfer).
 */
export function querySlice(
  data: ChannelData,
  xMin: number,
  xMax: number,
  pixelWidth: number,
): QueryResult {
  const { x } = data;
  // Pad by one sample on each side so the line reaches the plot edges.
  let lo = lowerBound(x, xMin);
  let hi = upperBound(x, xMax);
  if (lo > 0) lo--;
  if (hi < x.length) hi++;
  const rawCount = hi - lo;
  const targetPoints = Math.max(1, Math.floor(pixelWidth)) * 2;

  if (rawCount <= targetPoints || data.levels.length === 0) {
    return {
      decimated: false,
      x: x.slice(lo, hi),
      values: data.values.slice(lo, hi) as Float32Array,
    };
  }

  // Choose level: bucketSize ~= rawCount / targetPoints.
  const desiredBucket = rawCount / targetPoints;
  let level = data.levels[0];
  for (let i = 0; i < data.levels.length; i++) {
    if (data.levels[i].bucketSize <= desiredBucket) level = data.levels[i];
    else break;
  }

  const blo = lowerBound(level.x, xMin);
  let bhi = upperBound(level.x, xMax);
  const bloPad = blo > 0 ? blo - 1 : 0;
  if (bhi < level.len) bhi++;

  return {
    decimated: true,
    x: level.x.slice(bloPad, bhi),
    min: level.min.slice(bloPad, bhi),
    max: level.max.slice(bloPad, bhi),
    avg: level.avg ? level.avg.slice(bloPad, bhi) : undefined,
  };
}
