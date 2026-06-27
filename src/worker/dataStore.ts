// Owns all parsed datasets inside the worker: raw columnar arrays, per-channel
// metadata/stats, and decimation pyramids. The main thread holds only metadata
// and asks for viewport slices on demand.

import { parseCsv } from "./parse";
import { inferKind, isIntegral, isTimeColumn, monotonicFraction } from "./infer";
import { computeStats } from "./stats";
import { buildPyramid, querySlice, type ChannelData } from "./pyramid";
import type {
  ChannelMeta,
  ChannelSlice,
  DatasetMeta,
  ViewportQuery,
} from "./types";

interface StoredChannel {
  meta: ChannelMeta;
  data: ChannelData;
}

interface StoredDataset {
  meta: DatasetMeta;
  x: Float64Array;
  channels: Map<number, StoredChannel>;
}

const datasets = new Map<number, StoredDataset>();

export function parseDataset(
  datasetId: number,
  name: string,
  bytes: ArrayBuffer,
): DatasetMeta {
  const text = new TextDecoder().decode(bytes);
  const raw = parseCsv(text);
  const { names, columns, rowCount } = raw;

  // --- Pick the time/X column ---
  let timeIdx = -1;
  for (let i = 0; i < names.length; i++) {
    if (isTimeColumn(names[i], columns[i])) {
      timeIdx = i;
      break;
    }
  }
  if (timeIdx === -1 && columns.length > 0 && monotonicFraction(columns[0]) > 0.95) {
    timeIdx = 0;
  }

  let xRaw: Float64Array;
  let timeChannelId: number;
  if (timeIdx >= 0) {
    xRaw = columns[timeIdx];
    timeChannelId = timeIdx;
  } else {
    // No usable time column: synthesize a sample index.
    xRaw = new Float64Array(rowCount);
    for (let i = 0; i < rowCount; i++) xRaw[i] = i;
    timeChannelId = names.length; // id beyond real columns
  }

  const channels = new Map<number, StoredChannel>();
  const channelMetas: ChannelMeta[] = [];

  // Time channel meta (kept for naming/formatting; not plotted as a series).
  {
    const timeName = timeIdx >= 0 ? names[timeIdx] : "index";
    const stats = computeStats(xRaw);
    const meta: ChannelMeta = {
      id: timeChannelId,
      name: timeName,
      kind: "time",
      integral: false,
      stats,
    };
    channelMetas.push(meta);
    channels.set(timeChannelId, {
      meta,
      data: { x: xRaw, values: xRaw as unknown as Float32Array, integral: false, levels: [] },
    });
  }

  // Value channels.
  for (let i = 0; i < names.length; i++) {
    if (i === timeIdx) continue;
    const col = columns[i];
    const kind = inferKind(names[i], col);
    const integral = isIntegral(kind);

    let values: Float32Array | Int32Array;
    if (integral) {
      const arr = new Int32Array(rowCount);
      for (let r = 0; r < rowCount; r++) arr[r] = Math.round(col[r]);
      values = arr;
    } else {
      const arr = new Float32Array(rowCount);
      for (let r = 0; r < rowCount; r++) arr[r] = col[r];
      values = arr;
    }

    const stats = computeStats(values);
    const levels = buildPyramid(xRaw, values, integral);
    const meta: ChannelMeta = { id: i, name: names[i], kind, integral, stats };
    channelMetas.push(meta);
    channels.set(i, { meta, data: { x: xRaw, values, integral, levels } });
  }

  const signature = signatureOf(names.filter((_, i) => i !== timeIdx));
  const meta: DatasetMeta = {
    datasetId,
    name,
    rowCount,
    timeChannelId,
    channels: channelMetas,
    signature,
  };
  datasets.set(datasetId, { meta, x: xRaw, channels });
  return meta;
}

export function queryViewport(q: ViewportQuery): {
  slices: ChannelSlice[];
  transfer: Transferable[];
} {
  const ds = datasets.get(q.datasetId);
  if (!ds) throw new Error(`Unknown dataset ${q.datasetId}`);
  const slices: ChannelSlice[] = [];
  const transfer: Transferable[] = [];

  for (const id of q.channelIds) {
    const ch = ds.channels.get(id);
    if (!ch || ch.meta.kind === "time") continue;
    const r = querySlice(ch.data, q.xMin, q.xMax, q.pixelWidth);
    const slice: ChannelSlice = {
      datasetId: q.datasetId,
      channelId: id,
      decimated: r.decimated,
      x: r.x,
      min: r.min,
      max: r.max,
      avg: r.avg,
      values: r.values,
    };
    slices.push(slice);
    transfer.push(r.x.buffer as ArrayBuffer);
    if (r.min) transfer.push(r.min.buffer as ArrayBuffer);
    if (r.max) transfer.push(r.max.buffer as ArrayBuffer);
    if (r.avg) transfer.push(r.avg.buffer as ArrayBuffer);
    if (r.values) transfer.push(r.values.buffer as ArrayBuffer);
  }
  return { slices, transfer };
}

/** Build a CSV string for the rows within [xMin, xMax] over the given channels. */
export function exportCsv(
  datasetId: number,
  channelIds: number[],
  xMin: number,
  xMax: number,
): string {
  const ds = datasets.get(datasetId);
  if (!ds) throw new Error(`Unknown dataset ${datasetId}`);
  const x = ds.x;

  // Row range.
  let lo = 0;
  while (lo < x.length && x[lo] < xMin) lo++;
  let hi = x.length;
  while (hi > lo && x[hi - 1] > xMax) hi--;

  const timeId = ds.meta.timeChannelId;
  const timeName = ds.channels.get(timeId)?.meta.name ?? "time";
  const cols = channelIds
    .map((id) => ds.channels.get(id))
    .filter((c): c is StoredChannel => !!c && c.meta.kind !== "time");

  const header = [timeName, ...cols.map((c) => c.meta.name)].join(",");
  const lines: string[] = [header];
  for (let r = lo; r < hi; r++) {
    const fields: string[] = [fmt(x[r], false)];
    for (const c of cols) fields.push(fmt(c.data.values[r], c.meta.integral));
    lines.push(fields.join(","));
  }
  return lines.join("\n");
}

export function freeDataset(datasetId: number): void {
  datasets.delete(datasetId);
}

function fmt(v: number, integral: boolean): string {
  if (Number.isNaN(v)) return "";
  return integral ? String(v) : String(v);
}

/** FNV-1a hash of the sorted, normalized column-name set. */
function signatureOf(names: string[]): string {
  const norm = names.map((n) => n.toLowerCase().trim()).sort().join("");
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
