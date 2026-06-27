// Persistence of per-signature layouts ("recent views") and a recent-files
// list, in localStorage. Keyed by the dataset's column signature so reopening a
// CSV with the same columns restores the previous layout.

import type { Annotation, AxisSide, Chart } from "./store";

const LAYOUT_PREFIX = "logviewer.layout.v1.";
const RECENT_KEY = "logviewer.recent.v1";
const MAX_RECENT = 12;

export interface SavedSeries {
  name: string;
  visible: boolean;
  color: string;
  chartId: string;
  axis: AxisSide;
}

export interface SavedLayout {
  version: 1;
  charts: Chart[];
  series: SavedSeries[];
  annotations: Annotation[];
}

export interface RecentEntry {
  signature: string;
  name: string;
  at: number;
}

export function saveLayout(signature: string, layout: SavedLayout): void {
  try {
    localStorage.setItem(LAYOUT_PREFIX + signature, JSON.stringify(layout));
  } catch {
    // Quota or unavailable: non-fatal.
  }
}

export function loadLayout(signature: string): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_PREFIX + signature);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedLayout;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function rememberRecent(signature: string, name: string): void {
  try {
    const list = listRecent().filter((e) => e.signature !== signature);
    list.unshift({ signature, name, at: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

export function listRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentEntry[]) : [];
  } catch {
    return [];
  }
}
