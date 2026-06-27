// Turn worker viewport slices into a uPlot data table + series/band definitions.
//
// Decimated float channels render as a min/max band with an avg line; decimated
// integral channels render as a min/max envelope (no average); raw channels
// render as a single line. Series from one dataset share an identical x grid
// (same raw axis + viewport => same buckets), so the common case is a fast
// pass-through; mixed datasets fall back to a sorted-union merge.

import type uPlot from "uplot";
import type { ChannelSlice } from "../worker/types";
import type { Series } from "../state/store";
import type { TipSeries } from "./tooltip";

export interface ChartModel {
  data: uPlot.AlignedData;
  series: (uPlot.Series & TipSeries)[];
  bands: uPlot.Band[];
  /** Scale keys actually used (for axis creation). */
  usesLeft: boolean;
  usesRight: boolean;
  /** Changes only when the uPlot structure must be rebuilt. */
  structureKey: string;
}

const TRANSPARENT = "rgba(0,0,0,0)";

function scaleKey(axis: "left" | "right"): string {
  return axis === "right" ? "yR" : "y";
}

function fill(color: string, alpha: number): string {
  // Colors are `hsl(h s% l%)`; append an alpha component.
  return color.replace(")", ` / ${alpha})`);
}

/** True if all slices share the same x grid (length + endpoints). */
function sameGrid(slices: ChannelSlice[]): boolean {
  if (slices.length <= 1) return true;
  const a = slices[0].x;
  for (let i = 1; i < slices.length; i++) {
    const b = slices[i].x;
    if (b.length !== a.length) return false;
    if (a.length && (b[0] !== a[0] || b[a.length - 1] !== a[a.length - 1])) return false;
  }
  return true;
}

export function buildChartData(
  slices: ChannelSlice[],
  configs: Series[],
): ChartModel {
  // Pair each config with its slice (visible + present only).
  const pairs: { cfg: Series; slice: ChannelSlice }[] = [];
  for (const cfg of configs) {
    const slice = slices.find(
      (s) =>
        s.channelId === cfg.channelId &&
        (s.datasetId == null || s.datasetId === cfg.datasetId),
    );
    if (slice) pairs.push({ cfg, slice });
  }

  // Shared x grid.
  const fast = sameGrid(pairs.map((p) => p.slice));
  let xArr: Float64Array | number[];
  let indexOf: ((sliceIdx: number, j: number) => number) | null = null;

  if (fast) {
    xArr = pairs.length ? pairs[0].slice.x : new Float64Array(0);
  } else {
    const set = new Set<number>();
    for (const p of pairs) for (let j = 0; j < p.slice.x.length; j++) set.add(p.slice.x[j]);
    const union = Float64Array.from(set).sort();
    const pos = new Map<number, number>();
    for (let i = 0; i < union.length; i++) pos.set(union[i], i);
    xArr = union;
    indexOf = (si, j) => pos.get(pairs[si].slice.x[j])!;
  }
  const xLen = xArr.length;

  const data: uPlot.AlignedData = [xArr as unknown as number[]];
  const series: (uPlot.Series & TipSeries)[] = [
    { label: "x" }, // x placeholder
  ];
  const bands: uPlot.Band[] = [];
  let usesLeft = false;
  let usesRight = false;
  const structureParts: string[] = [];

  const scatter = (si: number, src: Float32Array | undefined): (number | null)[] | Float32Array | undefined => {
    if (!src) return undefined;
    if (fast) return src;
    const out: (number | null)[] = new Array(xLen).fill(null);
    const s = pairs[si].slice;
    for (let j = 0; j < s.x.length; j++) out[indexOf!(si, j)] = src[j];
    return out;
  };

  pairs.forEach((p, si) => {
    const { cfg, slice } = p;
    const sc = scaleKey(cfg.axis);
    if (cfg.axis === "right") usesRight = true;
    else usesLeft = true;

    if (!slice.decimated && slice.values) {
      data.push(scatter(si, slice.values) as number[]);
      series.push({
        label: cfg.name,
        scale: sc,
        stroke: cfg.color,
        width: 1.25,
        points: { show: false },
        tip: true,
        tipLabel: cfg.name,
        tipColor: cfg.color,
        integral: cfg.kind !== "float",
      });
      structureParts.push(`${cfg.key}|raw|${cfg.axis}`);
    } else if (slice.decimated && slice.avg) {
      // float: min/max band (hidden strokes) + avg line.
      const maxIdx = data.length;
      data.push(scatter(si, slice.max) as number[]);
      series.push({ label: `${cfg.name}.max`, scale: sc, stroke: TRANSPARENT, width: 0, points: { show: false } });
      const minIdx = data.length;
      data.push(scatter(si, slice.min) as number[]);
      series.push({ label: `${cfg.name}.min`, scale: sc, stroke: TRANSPARENT, width: 0, points: { show: false } });
      bands.push({ series: [maxIdx, minIdx], fill: fill(cfg.color, 0.18) });
      data.push(scatter(si, slice.avg) as number[]);
      series.push({
        label: cfg.name,
        scale: sc,
        stroke: cfg.color,
        width: 1.25,
        points: { show: false },
        tip: true,
        tipLabel: cfg.name,
        tipColor: cfg.color,
        integral: false,
      });
      structureParts.push(`${cfg.key}|favg|${cfg.axis}`);
    } else if (slice.decimated) {
      // integral: min/max envelope, max as the labeled line.
      const maxIdx = data.length;
      data.push(scatter(si, slice.max) as number[]);
      series.push({
        label: cfg.name,
        scale: sc,
        stroke: cfg.color,
        width: 1,
        points: { show: false },
        tip: true,
        tipLabel: cfg.name,
        tipColor: cfg.color,
        integral: true,
      });
      const minIdx = data.length;
      data.push(scatter(si, slice.min) as number[]);
      series.push({ label: `${cfg.name}.min`, scale: sc, stroke: cfg.color, width: 1, points: { show: false }, dash: [2, 3] } as uPlot.Series);
      bands.push({ series: [maxIdx, minIdx], fill: fill(cfg.color, 0.16) });
      structureParts.push(`${cfg.key}|fenv|${cfg.axis}`);
    }
  });

  return {
    data,
    series,
    bands,
    usesLeft,
    usesRight,
    structureKey: structureParts.join(";"),
  };
}
