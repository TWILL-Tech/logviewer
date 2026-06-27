// Small number/format helpers shared by the chart, tooltip and stats table.

/** Format a value compactly for tooltips/tables. */
export function fmtNum(v: number | undefined | null, integral = false): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (integral) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3);
  // Adaptive precision: more decimals for small magnitudes.
  const decimals = a >= 100 ? 2 : a >= 1 ? 3 : 4;
  return v.toFixed(decimals);
}

/** Format an X (time) value, with a unit hint from the column name. */
export function fmtX(v: number, timeName: string): string {
  const n = timeName.toLowerCase();
  if (n.includes("msec") || n === "ms") return `${fmtNum(v)} ms`;
  if (n.includes("usec") || n.includes("micro")) return `${fmtNum(v)} µs`;
  if (n.includes("nano") || n === "ns") return `${fmtNum(v)} ns`;
  if (n.includes("sec") || n === "t" || n === "time") return `${fmtNum(v)} s`;
  return fmtNum(v);
}

/** Short SI-ish formatting for axis ticks. */
export function fmtTick(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a < 1e-3 || a >= 1e6) return v.toExponential(1);
  if (a >= 1000) return (v / 1000).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return Number(v.toPrecision(4)).toString();
}
