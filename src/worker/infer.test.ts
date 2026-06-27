import { expect, test } from "bun:test";
import { inferKind, isTimeColumn } from "./infer";

const f = (arr: number[]) => Float64Array.from(arr);

test("detects time column by name + monotonicity", () => {
  expect(isTimeColumn("msec", f([0, 1, 2, 3, 4]))).toBe(true);
  expect(isTimeColumn("accel_x", f([0, 1, 2]))).toBe(false);
  expect(isTimeColumn("msec", f([5, 1, 9, 2]))).toBe(false); // not monotonic
});

test("float for continuous values", () => {
  expect(inferKind("accel_x", f([0.1, -0.3, 0.25, 1.7]))).toBe("float");
});

test("bitfield by name", () => {
  expect(inferKind("axis_error", f([0, 0, 1, 0, 256]))).toBe("bitfield");
  expect(inferKind("flags", f([0, 2, 6, 0]))).toBe("bitfield");
});

test("enum for small-cardinality integers", () => {
  expect(inferKind("mode", f([0, 1, 2, 1, 0, 2]))).toBe("enum");
  expect(inferKind("axis_state", f([1, 1, 8, 8, 1]))).toBe("enum");
});

test("counter for monotonic integer sequence", () => {
  const seq = f(Array.from({ length: 100 }, (_, i) => i));
  expect(inferKind("seq", seq)).toBe("counter");
});

test("high-cardinality integers treated as float", () => {
  const noisy = f(Array.from({ length: 200 }, (_, i) => ((i * 7919) % 5000) - 2500));
  expect(inferKind("raw_count", noisy)).toBe("float");
});
