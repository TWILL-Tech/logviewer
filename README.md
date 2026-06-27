# LogViewer

A high-performance, standalone time-series **CSV log viewer**. Built for the
balance-robot telemetry logs (1 kHz, ~20 mixed columns) but works with any
numeric CSV. Primary workflow: keep it open, **drag-and-drop a CSV**, explore.

Runs as a **Tauri desktop app** (native windows, file dialogs, file
associations) and also as a plain web app in a browser for fast iteration.

## Features

- **Fluid pan/zoom** at scale (60s @ 1kHz × 10–30 columns ≈ 1.8M points).
- **Automatic decimation** — a min/max/avg pyramid renders a min/max *band* +
  avg line when zoomed out (so single-sample spikes are never lost), and the
  raw signal when zoomed in.
- **Overview timeline** strip with a brush that drives the main viewport.
- **Automatic series generation** — grouping + coloring by name family, with
  per-column **kind inference** (`float` / `enum` / `counter` / `bitfield`).
- **Multiple Y scales** (left/right), with a magnitude-based default split so
  large-range signals don't squash small ones; **split/stack** into multiple
  charts; **duplicate windows**.
- **Series table** with stats (min/max/mean/std/CV/distinct) + a **histogram
  sparkline** per row, sortable/filterable, one-click "hide constant".
- **Cursor tooltip** with the X value and every series' value at the crosshair,
  synced across charts.
- **Remembers layouts** keyed by the file's column signature — reopening a
  similar CSV restores your last view (visible series, colors, axes, charts).
- **Crop → CSV** export of the current viewport, **PNG snapshot** (clipboard +
  file), and **annotations** (shift-click to add a marker).

## Architecture

```
src/worker/    Data layer (runs in a Web Worker, off the UI thread)
  parse.ts       Hand-rolled CSV -> columnar typed arrays
  infer.ts       Channel-kind inference
  stats.ts       Per-channel stats + histogram
  pyramid.ts     min/max/avg decimation pyramid + viewport query  (perf core)
  dataStore.ts   Owns datasets; serves viewport slices (zero-copy transfer)
src/data/      Main-thread client, grouping/coloring, file loading
src/chart/     uPlot wiring: Chart, Overview, tooltip, zoom/pan, annotations, snapshot
src/ui/        Toolbar, SeriesTable, Sparkline, ChartGrid
src/state/     Zustand store + localStorage layout persistence
src-tauri/     Rust: file read/write, dialogs, multi-window
```

**Why this shape:** all bulk numeric data lives in the Web Worker and only
small viewport slices are transferred (zero-copy) to the main thread, keeping
the UI fluid. Tauri's IPC is used only for file I/O (the slow path on Windows),
never for the hot path. The decimation uses min/max peak-detect (not LTTB) so
transient spikes and error bits always remain visible when zoomed out.

## Development

Requires [Bun](https://bun.sh) and (for the desktop build) the Rust toolchain.

```bash
bun install

# Web dev (fast iteration in a browser at http://localhost:1420)
bun run dev

# Desktop app (Tauri)
bun run app          # dev
bun run app:build    # production binary

# Tests + typecheck
bun test
bun run build        # tsc --noEmit + vite build

# Generate a sample 60k-row CSV for testing -> sample/odrive_sample.csv
bun run scripts/gen-sample.ts
```

## Notes

- StrictMode is intentionally omitted (`src/main.tsx`): its dev double-invoke
  conflicts with uPlot's imperative create/destroy lifecycle.
- The browser build supports drag-drop and download-based export; native file
  dialogs / OS file-drop-by-path / multi-window require the Tauri build.
