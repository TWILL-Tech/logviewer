// Shared types for the data layer. Kept dependency-free so they can be imported
// from both the worker and the main thread.

/**
 * How a column behaves, inferred at parse time. Drives storage dtype, whether
 * an average makes sense in the decimation pyramid, stats, tooltip formatting,
 * and CSV export precision.
 */
export type ChannelKind =
  | "time" // the X axis (monotonic-ish timestamp column)
  | "float" // continuous real-valued signal
  | "enum" // small set of discrete integer states (mode, axis_state)
  | "counter" // integer that mostly increases (seq)
  | "bitfield"; // integer flags (flags, *_error)

/** Per-channel summary statistics, computed once in the worker. */
export interface ChannelStats {
  count: number;
  nanCount: number;
  min: number;
  max: number;
  mean: number;
  std: number;
  /** Coefficient of variation, std/|mean|; NaN when mean ~ 0. */
  cv: number;
  /** Number of distinct values (capped during counting for huge sets). */
  distinct: number;
  distinctCapped: boolean;
  /** Histogram for the sparkline: bin counts + range. */
  histogram: { bins: number[]; min: number; max: number };
}

/** Description of one parsed channel (no bulk data — that stays in the worker). */
export interface ChannelMeta {
  id: number;
  name: string;
  kind: ChannelKind;
  /** True for integer-valued kinds stored without averaging. */
  integral: boolean;
  stats: ChannelStats;
}

/** Result of parsing a file: metadata only; bulk arrays live in the worker. */
export interface DatasetMeta {
  datasetId: number;
  name: string;
  rowCount: number;
  /** Index of the channel used as the X axis. */
  timeChannelId: number;
  channels: ChannelMeta[];
  /** Stable hash of the sorted column-name set, for recent-view matching. */
  signature: string;
}

/** A decimated or raw slice for one channel over a viewport. */
export interface ChannelSlice {
  datasetId?: number;
  channelId: number;
  /** true => min/max/avg arrays (decimated); false => single `values` line. */
  decimated: boolean;
  /** X coordinates (bucket centers, or raw timestamps). */
  x: Float64Array;
  /** Present when decimated. */
  min?: Float32Array;
  max?: Float32Array;
  /** avg present only for non-integral (float) channels. */
  avg?: Float32Array;
  /** Present when not decimated (raw). */
  values?: Float32Array;
}

/** Query for a viewport's worth of data. */
export interface ViewportQuery {
  datasetId: number;
  channelIds: number[];
  /** Inclusive X range in time-column units. */
  xMin: number;
  xMax: number;
  /** Plot width in CSS pixels; sets the target resolution. */
  pixelWidth: number;
}

// ---- Worker message protocol ----

export type WorkerRequest =
  | { type: "parse"; reqId: number; datasetId: number; name: string; bytes: ArrayBuffer }
  | { type: "query"; reqId: number; query: ViewportQuery }
  | {
      type: "export";
      reqId: number;
      datasetId: number;
      channelIds: number[];
      xMin: number;
      xMax: number;
    }
  | { type: "free"; reqId: number; datasetId: number };

export type WorkerResponse =
  | { type: "parsed"; reqId: number; meta: DatasetMeta }
  | { type: "queried"; reqId: number; slices: ChannelSlice[] }
  | { type: "exported"; reqId: number; csv: string }
  | { type: "freed"; reqId: number }
  | { type: "error"; reqId: number; message: string };
