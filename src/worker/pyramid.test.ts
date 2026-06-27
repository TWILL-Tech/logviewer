import { expect, test } from "bun:test";
import { buildPyramid, querySlice, lowerBound, upperBound } from "./pyramid";

function ramp(n: number): { x: Float64Array; v: Float32Array } {
  const x = new Float64Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i;
    v[i] = Math.sin(i / 50);
  }
  return { x, v };
}

test("lowerBound / upperBound", () => {
  const a = Float64Array.from([0, 1, 2, 3, 4]);
  expect(lowerBound(a, 2)).toBe(2);
  expect(upperBound(a, 2)).toBe(3);
  expect(lowerBound(a, -1)).toBe(0);
  expect(upperBound(a, 99)).toBe(5);
});

test("spike survives decimation (min/max peak-detect)", () => {
  const n = 60000;
  const { x } = ramp(n);
  const v = new Float32Array(n); // all zeros
  v[12345] = 999; // single-sample spike

  const levels = buildPyramid(x, v, false);
  // Zoom way out: 800px viewport over the whole range -> heavily decimated.
  const r = querySlice({ x, values: v, integral: false, levels }, 0, n - 1, 800);
  expect(r.decimated).toBe(true);
  let peak = -Infinity;
  for (const m of r.max!) if (m > peak) peak = m;
  expect(peak).toBe(999); // spike preserved in the max band
});

test("returns raw data when few samples are in view", () => {
  const n = 60000;
  const { x, v } = ramp(n);
  const levels = buildPyramid(x, v, false);
  // Tiny window -> fewer than pixelWidth*2 samples -> raw.
  const r = querySlice({ x, values: v, integral: false, levels }, 100, 150, 800);
  expect(r.decimated).toBe(false);
  expect(r.values).toBeDefined();
});

test("integral channels have no avg", () => {
  const n = 10000;
  const x = new Float64Array(n);
  const v = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i;
    v[i] = i % 4;
  }
  const levels = buildPyramid(x, v, true);
  expect(levels[0].avg).toBeUndefined();
  const r = querySlice({ x, values: v, integral: true, levels }, 0, n - 1, 200);
  expect(r.avg).toBeUndefined();
  expect(r.min).toBeDefined();
  expect(r.max).toBeDefined();
});

test("decimated point count is near the pixel target", () => {
  const n = 100000;
  const { x, v } = ramp(n);
  const levels = buildPyramid(x, v, false);
  const r = querySlice({ x, values: v, integral: false, levels }, 0, n - 1, 1000);
  expect(r.decimated).toBe(true);
  // Should be within a small multiple of the pixel width.
  expect(r.x.length).toBeLessThan(1000 * 4);
  expect(r.x.length).toBeGreaterThan(200);
});
