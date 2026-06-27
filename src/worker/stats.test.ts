import { expect, test } from "bun:test";
import { computeStats } from "./stats";

test("basic stats", () => {
  const s = computeStats([1, 2, 3, 4, 5]);
  expect(s.min).toBe(1);
  expect(s.max).toBe(5);
  expect(s.mean).toBeCloseTo(3);
  expect(s.std).toBeCloseTo(Math.sqrt(2.5));
  expect(s.distinct).toBe(5);
  expect(s.count).toBe(5);
});

test("ignores NaN", () => {
  const s = computeStats([1, NaN, 3]);
  expect(s.count).toBe(2);
  expect(s.nanCount).toBe(1);
  expect(s.mean).toBeCloseTo(2);
});

test("constant series: cv NaN-or-zero, distinct 1", () => {
  const s = computeStats([7, 7, 7, 7]);
  expect(s.distinct).toBe(1);
  expect(s.std).toBe(0);
  // histogram piles into one bin
  const total = s.histogram.bins.reduce((a, b) => a + b, 0);
  expect(total).toBe(4);
});

test("histogram bins sum to count", () => {
  const data = Array.from({ length: 1000 }, (_, i) => Math.sin(i));
  const s = computeStats(data);
  const total = s.histogram.bins.reduce((a, b) => a + b, 0);
  expect(total).toBe(1000);
});
