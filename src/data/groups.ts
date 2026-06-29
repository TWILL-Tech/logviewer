// Automatic series grouping and coloring. Channels are grouped by name family
// (the token before the first underscore); each family gets a base hue and each
// exact name gets a shade within that hue, both derived from a hash of the name.
// Because the color is a pure function of the name (+ theme), the same signal
// always renders in the same color regardless of which other channels are in
// the file or what order they appear in.

import type { ChannelMeta } from "../worker/types";

export interface SeriesStyle {
  group: string;
  color: string;
}

/** Family key for a channel name: token before first underscore, else whole. */
export function groupOf(name: string): string {
  const us = name.indexOf("_");
  const base = us > 0 ? name.slice(0, us) : name;
  return base.toLowerCase();
}

// FNV-1a 32-bit string hash. Stable across runs/platforms and well-distributed
// so similar names (e.g. "motor_a"/"motor_b") land far apart.
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Distinct, reasonably colorblind-friendly base hues (degrees).
const HUES = [210, 25, 145, 285, 50, 0, 175, 320, 95, 255, 35, 190];

/**
 * Assign a stable group + color to each plottable channel. Deterministic and
 * name-driven: the same channel name always yields the same color, independent
 * of the rest of the file.
 *
 * `isDark` shifts the lightness band: dark mode needs brighter traces (dark
 * colors vanish against the dark background), while light mode keeps the
 * darker, more-saturated end that reads well on a light background.
 */
export function assignStyles(
  channels: ChannelMeta[],
  isDark = true,
): Map<number, SeriesStyle> {
  const plottable = channels.filter((c) => c.kind !== "time");

  // Theme-aware lightness band: shade each name within ±amp around center.
  const center = isDark ? 62 : 46;
  const amp = isDark ? 12 : 14;
  const lo = isDark ? 48 : 28;
  const hi = isDark ? 78 : 66;

  const styles = new Map<number, SeriesStyle>();
  for (const c of plottable) {
    const g = groupOf(c.name);
    // Hue from the family hash (related signals share a hue family); shade from
    // the full-name hash (members of a family get distinct, stable lightness).
    const hue = HUES[hashStr(g) % HUES.length];
    const frac = hashStr(c.name) / 0xffffffff; // 0..1, stable per name
    const light = center + (frac - 0.5) * 2 * amp;
    const sat = c.kind === "bitfield" || c.kind === "enum" ? 45 : 65;
    styles.set(c.id, { group: g, color: `hsl(${hue} ${sat}% ${clamp(light, lo, hi)}%)` });
  }
  return styles;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
