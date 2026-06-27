// Channel-kind inference. Looks at a column's name and value distribution to
// classify it. The kind decides storage dtype, whether averaging is meaningful
// in the decimation pyramid, and how values are formatted in the UI.

import type { ChannelKind } from "./types";

const TIME_NAME = /^(t|ts|time|times|timestamp|msec|ms|millis|usec|us|micros|sec|secs|seconds|nanos|ns)$/i;
const BITFIELD_NAME = /(flag|error|fault|status|mask|bits|state_bits)/i;
const ENUM_NAME = /(mode|state|axis_state|phase|step|status)/i;

/** Is the candidate column a plausible time/X axis? */
export function isTimeColumn(name: string, col: Float64Array): boolean {
  if (TIME_NAME.test(name)) return monotonicFraction(col) > 0.95;
  return false;
}

/** Fraction of consecutive samples that are non-decreasing (NaN-skipping). */
export function monotonicFraction(col: Float64Array): number {
  let prev = NaN;
  let ok = 0;
  let cmp = 0;
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    if (Number.isNaN(v)) continue;
    if (!Number.isNaN(prev)) {
      cmp++;
      if (v >= prev) ok++;
    }
    prev = v;
  }
  return cmp === 0 ? 0 : ok / cmp;
}

/** Are (essentially) all finite values integers? */
function allIntegers(col: Float64Array): boolean {
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    if (Number.isNaN(v)) continue;
    if (!Number.isInteger(v)) return false;
  }
  return true;
}

/** Count distinct values up to a cap (returns cap+1 sentinel when exceeded). */
function distinctUpTo(col: Float64Array, cap: number): number {
  const seen = new Set<number>();
  for (let i = 0; i < col.length; i++) {
    const v = col[i];
    if (Number.isNaN(v)) continue;
    seen.add(v);
    if (seen.size > cap) return cap + 1;
  }
  return seen.size;
}

/**
 * Classify a non-time column. Order matters: name-based bitfield/enum hints win
 * for integer columns, then counter (monotonic), then small-cardinality enum,
 * then float.
 */
export function inferKind(name: string, col: Float64Array): ChannelKind {
  if (!allIntegers(col)) return "float";

  // Integer-valued from here on.
  if (BITFIELD_NAME.test(name)) return "bitfield";

  const distinct = distinctUpTo(col, 64);
  if (ENUM_NAME.test(name) && distinct <= 64) return "enum";

  if (monotonicFraction(col) > 0.98 && distinct > 8) return "counter";

  if (distinct <= 32) return "enum";

  // Integer-valued but high-cardinality and not monotonic: treat as a normal
  // continuous signal (e.g. raw sensor counts).
  return "float";
}

/** Storage class for a kind: integral kinds avoid averaging. */
export function isIntegral(kind: ChannelKind): boolean {
  return kind === "enum" || kind === "counter" || kind === "bitfield";
}
