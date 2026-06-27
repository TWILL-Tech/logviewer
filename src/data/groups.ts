// Automatic series grouping and coloring. Channels are grouped by name family
// (the token before the first underscore), each group gets a distinct base hue,
// and members are shaded within that hue so related signals read as a set.

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

// Distinct, reasonably colorblind-friendly base hues (degrees).
const HUES = [210, 25, 145, 285, 50, 0, 175, 320, 95, 255, 35, 190];

/**
 * Assign a stable group + color to each plottable channel. Deterministic: the
 * same column set always yields the same colors, so reopening a similar file
 * looks identical.
 */
export function assignStyles(channels: ChannelMeta[]): Map<number, SeriesStyle> {
  const plottable = channels.filter((c) => c.kind !== "time");

  // Stable group ordering by first appearance for hue assignment.
  const groupHue = new Map<string, number>();
  const groupMembers = new Map<string, number[]>();
  for (const c of plottable) {
    const g = groupOf(c.name);
    if (!groupHue.has(g)) groupHue.set(g, HUES[groupHue.size % HUES.length]);
    const arr = groupMembers.get(g) ?? [];
    arr.push(c.id);
    groupMembers.set(g, arr);
  }

  const styles = new Map<number, SeriesStyle>();
  for (const c of plottable) {
    const g = groupOf(c.name);
    const hue = groupHue.get(g)!;
    const members = groupMembers.get(g)!;
    const idx = members.indexOf(c.id);
    // Vary lightness within a group across a readable band.
    const span = members.length > 1 ? members.length - 1 : 1;
    const light = 45 + (idx / span) * 28 - 14; // ~31%..59%
    const sat = c.kind === "bitfield" || c.kind === "enum" ? 45 : 65;
    styles.set(c.id, { group: g, color: `hsl(${hue} ${sat}% ${clamp(light, 28, 66)}%)` });
  }
  return styles;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
