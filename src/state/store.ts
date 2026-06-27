// Central application state. Plain-serializable so layouts persist to
// localStorage, keyed by dataset column-signature for "recent views".

import { create } from "zustand";
import type { ChannelKind, DatasetMeta } from "../worker/types";
import { assignStyles } from "../data/groups";
import {
  loadLayout,
  saveLayout,
  rememberRecent,
  type SavedLayout,
} from "./recent";

export type AxisSide = "left" | "right";

export interface Series {
  key: string; // `${datasetId}:${channelId}`
  datasetId: number;
  channelId: number;
  name: string;
  kind: ChannelKind;
  color: string;
  visible: boolean;
  chartId: string;
  axis: AxisSide;
}

export interface Chart {
  id: string;
  title: string;
}

export interface Annotation {
  id: string;
  /** x (single marker) or [x0, x1] (range). */
  x: number;
  x1?: number;
  label: string;
  color: string;
}

export interface Extent {
  xMin: number;
  xMax: number;
}

interface AppState {
  datasets: DatasetMeta[];
  series: Series[];
  charts: Chart[];
  /** Current shared X viewport (null = full extent). */
  view: Extent | null;
  fullExtent: Extent | null;
  annotations: Annotation[];
  /** Signature of the most recently loaded dataset (for persistence keying). */
  signature: string | null;

  addDataset: (meta: DatasetMeta) => void;
  removeDataset: (datasetId: number) => void;
  toggleVisible: (key: string) => void;
  setVisibleBulk: (keys: string[], visible: boolean) => void;
  setColor: (key: string, color: string) => void;
  setAxis: (key: string, axis: AxisSide) => void;
  moveToChart: (key: string, chartId: string) => void;
  addChart: () => string;
  removeChart: (chartId: string) => void;
  setView: (view: Extent | null) => void;
  resetView: () => void;
  addAnnotation: (a: Omit<Annotation, "id">) => void;
  removeAnnotation: (id: string) => void;
}

const DEFAULT_CHART = "chart-0";

function defaultChart(): Chart {
  return { id: DEFAULT_CHART, title: "Chart 1" };
}

let chartSeq = 1;

export const useStore = create<AppState>((set) => ({
  datasets: [],
  series: [],
  charts: [defaultChart()],
  view: null,
  fullExtent: null,
  annotations: [],
  signature: null,

  addDataset: (meta) => {
    const styles = assignStyles(meta.channels);
    const saved = loadLayout(meta.signature);

    // Map saved per-channel config by channel name (robust to id changes).
    const savedByName = new Map(saved?.series.map((s) => [s.name, s]) ?? []);

    const plottable = meta.channels.filter((c) => c.kind !== "time");

    // Default axis assignment by magnitude so large-range signals don't squash
    // small ones on a shared scale: channels whose characteristic magnitude is
    // far above the median go on the right axis.
    const mag = (c: (typeof plottable)[number]) =>
      Math.max(Math.abs(c.stats.min || 0), Math.abs(c.stats.max || 0));
    const mags = plottable
      .map(mag)
      .filter((m) => m > 0)
      .sort((a, b) => a - b);
    const median = mags.length ? mags[mags.length >> 1] : 0;
    const rightThreshold = median * 20;
    const defaultAxis = (c: (typeof plottable)[number]): AxisSide =>
      median > 0 && mag(c) > rightThreshold ? "right" : "left";

    const newSeries: Series[] = plottable.map((c) => {
      const key = `${meta.datasetId}:${c.id}`;
      const style = styles.get(c.id);
      const sv = savedByName.get(c.name);
      // Default visibility: show non-constant float-ish channels; hide dead.
      const dead = c.stats.distinct <= 1;
      return {
        key,
        datasetId: meta.datasetId,
        channelId: c.id,
        name: c.name,
        kind: c.kind,
        color: sv?.color ?? style?.color ?? "hsl(210 65% 50%)",
        visible: sv ? sv.visible : !dead && c.kind !== "bitfield",
        chartId: sv?.chartId ?? DEFAULT_CHART,
        axis: sv?.axis ?? defaultAxis(c),
      };
    });

    const extent: Extent = {
      xMin: meta.channels.find((c) => c.id === meta.timeChannelId)?.stats.min ?? 0,
      xMax: meta.channels.find((c) => c.id === meta.timeChannelId)?.stats.max ?? 1,
    };

    set((st) => {
      // Merge charts from saved layout if present.
      const charts =
        saved?.charts && saved.charts.length ? saved.charts : st.charts;
      const merged = [...st.series.filter((s) => s.datasetId !== meta.datasetId), ...newSeries];
      const prevExt = st.fullExtent;
      const fullExtent = prevExt
        ? { xMin: Math.min(prevExt.xMin, extent.xMin), xMax: Math.max(prevExt.xMax, extent.xMax) }
        : extent;
      return {
        datasets: [...st.datasets.filter((d) => d.datasetId !== meta.datasetId), meta],
        series: merged,
        charts,
        fullExtent,
        signature: meta.signature,
        annotations: saved?.annotations ?? st.annotations,
      };
    });
    rememberRecent(meta.signature, meta.name);
  },

  removeDataset: (datasetId) =>
    set((st) => ({
      datasets: st.datasets.filter((d) => d.datasetId !== datasetId),
      series: st.series.filter((s) => s.datasetId !== datasetId),
    })),

  toggleVisible: (key) =>
    set((st) => persist(st, {
      series: st.series.map((s) => (s.key === key ? { ...s, visible: !s.visible } : s)),
    })),

  setVisibleBulk: (keys, visible) =>
    set((st) => {
      const kset = new Set(keys);
      return persist(st, {
        series: st.series.map((s) => (kset.has(s.key) ? { ...s, visible } : s)),
      });
    }),

  setColor: (key, color) =>
    set((st) => persist(st, {
      series: st.series.map((s) => (s.key === key ? { ...s, color } : s)),
    })),

  setAxis: (key, axis) =>
    set((st) => persist(st, {
      series: st.series.map((s) => (s.key === key ? { ...s, axis } : s)),
    })),

  moveToChart: (key, chartId) =>
    set((st) => persist(st, {
      series: st.series.map((s) => (s.key === key ? { ...s, chartId } : s)),
    })),

  addChart: () => {
    const id = `chart-${chartSeq++}`;
    set((st) => persist(st, { charts: [...st.charts, { id, title: `Chart ${st.charts.length + 1}` }] }));
    return id;
  },

  removeChart: (chartId) =>
    set((st) => {
      if (st.charts.length <= 1) return st;
      const fallback = st.charts.find((c) => c.id !== chartId)!.id;
      return persist(st, {
        charts: st.charts.filter((c) => c.id !== chartId),
        series: st.series.map((s) => (s.chartId === chartId ? { ...s, chartId: fallback } : s)),
      });
    }),

  setView: (view) => set({ view }),
  resetView: () => set({ view: null }),

  addAnnotation: (a) =>
    set((st) => persist(st, {
      annotations: [...st.annotations, { ...a, id: `ann-${Date.now()}-${Math.round(performance.now())}` }],
    })),
  removeAnnotation: (id) =>
    set((st) => persist(st, { annotations: st.annotations.filter((x) => x.id !== id) })),
}));

/** Apply a partial update and persist the resulting layout for the signature. */
function persist(st: AppState, patch: Partial<AppState>): Partial<AppState> {
  const next = { ...st, ...patch };
  if (next.signature) {
    const layout: SavedLayout = {
      version: 1,
      charts: next.charts,
      series: next.series.map((s) => ({
        name: s.name,
        visible: s.visible,
        color: s.color,
        chartId: s.chartId,
        axis: s.axis,
      })),
      annotations: next.annotations,
    };
    saveLayout(next.signature, layout);
  }
  return patch;
}
