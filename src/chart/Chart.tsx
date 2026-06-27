// One uPlot chart bound to the shared X viewport and the store's series config.
// Queries the worker for decimated/raw slices on every view/size/series change,
// rebuilds the uPlot only when the series structure changes, otherwise setData.

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { dataClient } from "../data/client";
import { buildChartData } from "./buildData";
import { tooltipPlugin } from "./tooltip";
import { annotationPlugin } from "./annotations";
import { attachZoomPan } from "./interactions";
import { fmtTick } from "../util/format";
import { useStore, type Extent } from "../state/store";
import type { ChannelSlice } from "../worker/types";

interface Props {
  chartId: string;
  syncKey: string;
  height: number;
}

// Chart colors are pulled from CSS variables so they follow the system theme.
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) =>
    cs.getPropertyValue(name).trim() || fallback;
  return {
    axis: get("--axis", "#9aa4b2"),
    grid: get("--grid", "rgba(148,163,184,0.10)"),
    tick: get("--tick", "rgba(148,163,184,0.25)"),
  };
}

export function Chart({ chartId, syncKey, height }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const structureRef = useRef<string>("");
  const reqToken = useRef(0);
  const rafId = useRef(0);
  const timeoutId = useRef(0);
  const sizeRef = useRef({ w: 600, h: height });

  // Live refs for closures inside uPlot options.
  const viewRef = useRef<Extent | null>(null);
  const fullRef = useRef<Extent | null>(null);
  const annRef = useRef(useStore.getState().annotations);

  const series = useStore((s) => s.series);
  const datasets = useStore((s) => s.datasets);
  const view = useStore((s) => s.view);
  const fullExtent = useStore((s) => s.fullExtent);
  const annotations = useStore((s) => s.annotations);

  const configs = useMemo(
    () => series.filter((s) => s.chartId === chartId && s.visible),
    [series, chartId],
  );

  const effectiveView = view ?? fullExtent;
  viewRef.current = effectiveView;
  fullRef.current = fullExtent;
  annRef.current = annotations;

  const timeName = useMemo(() => {
    const ds = datasets[0];
    if (!ds) return "x";
    return ds.channels.find((c) => c.id === ds.timeChannelId)?.name ?? "x";
  }, [datasets]);

  // Signature that should trigger a data refresh.
  const configSig = useMemo(
    () => configs.map((c) => `${c.key}:${c.color}:${c.axis}`).join(","),
    [configs],
  );

  // ResizeObserver -> remember size and resize uPlot.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      if (uplotRef.current) uplotRef.current.setSize({ width: w, height: h });
      scheduleRefresh();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw on annotation change (no structure rebuild).
  useEffect(() => {
    uplotRef.current?.redraw();
  }, [annotations]);

  // Rebuild with fresh theme colors when the system light/dark preference flips.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      structureRef.current = ""; // force a full rebuild so axis colors update
      scheduleRefresh();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh data when view / series / time axis change.
  useEffect(() => {
    scheduleRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveView?.xMin, effectiveView?.xMax, configSig, timeName]);

  // Teardown.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafId.current);
      clearTimeout(timeoutId.current);
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, []);

  function scheduleRefresh() {
    // rAF gives smooth coalescing while visible; a timer fallback guarantees the
    // refresh still fires if rAF is throttled (e.g. a hidden/background window).
    cancelAnimationFrame(rafId.current);
    clearTimeout(timeoutId.current);
    rafId.current = requestAnimationFrame(runRefresh);
    timeoutId.current = window.setTimeout(runRefresh, 200);
  }

  function runRefresh() {
    cancelAnimationFrame(rafId.current);
    clearTimeout(timeoutId.current);
    void refresh();
  }

  async function refresh() {
    const v = viewRef.current;
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth || sizeRef.current.w;
    const h = el.clientHeight || height;

    if (!configs.length || !v) {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
        structureRef.current = "";
      }
      return;
    }

    const token = ++reqToken.current;

    // Group requested channels by dataset.
    const byDs = new Map<number, number[]>();
    for (const c of configs) {
      const arr = byDs.get(c.datasetId) ?? [];
      arr.push(c.channelId);
      byDs.set(c.datasetId, arr);
    }

    const all: ChannelSlice[] = [];
    try {
      for (const [dsId, ids] of byDs) {
        const slices = await dataClient.query({
          datasetId: dsId,
          channelIds: ids,
          xMin: v.xMin,
          xMax: v.xMax,
          pixelWidth: Math.max(50, w),
        });
        all.push(...slices);
      }
    } catch (err) {
      // A failed query must not leave the chart silently stale.
      console.error("[LogViewer] viewport query failed:", err);
      return;
    }
    if (token !== reqToken.current) return; // stale

    const model = buildChartData(all, configs);

    if (!uplotRef.current || model.structureKey !== structureRef.current) {
      rebuild(model, w, h);
    } else {
      uplotRef.current.setData(model.data);
    }
  }

  function rebuild(model: ReturnType<typeof buildChartData>, w: number, h: number) {
    uplotRef.current?.destroy();
    structureRef.current = model.structureKey;

    const tc = themeColors();
    const grid = { stroke: tc.grid, width: 1 };
    const tick = { stroke: tc.tick, width: 1 };
    const font = "11px system-ui, sans-serif";

    const axes: uPlot.Axis[] = [
      {
        stroke: tc.axis,
        grid,
        ticks: tick,
        values: (_u, splits) => splits.map(fmtTick),
        font,
      },
    ];
    if (model.usesLeft) {
      axes.push({
        scale: "y",
        stroke: tc.axis,
        grid,
        ticks: tick,
        size: 60,
        values: (_u, splits) => splits.map(fmtTick),
        font,
      });
    }
    if (model.usesRight) {
      axes.push({
        scale: "yR",
        side: 1,
        stroke: tc.axis,
        grid: { show: false },
        ticks: tick,
        size: 60,
        values: (_u, splits) => splits.map(fmtTick),
        font,
      });
    }

    const opts: uPlot.Options = {
      width: w,
      height: h,
      scales: {
        x: {
          time: false,
          range: (_u, dMin, dMax) => {
            const vv = viewRef.current;
            return vv ? [vv.xMin, vv.xMax] : [dMin, dMax];
          },
        },
        y: { auto: true },
        yR: { auto: true },
      },
      axes,
      series: model.series,
      bands: model.bands,
      cursor: {
        sync: { key: syncKey },
        drag: { x: false, y: false },
        points: { size: 6 },
      },
      legend: { show: false },
      plugins: [tooltipPlugin(timeName), annotationPlugin(() => annRef.current)],
    };

    const u = new uPlot(opts, model.data, containerRef.current!);
    uplotRef.current = u;

    // Wheel-zoom + drag-pan driving the shared viewport.
    attachZoomPan(u, {
      getExtent: () => fullRef.current,
      getView: () => viewRef.current,
      onView: (nv) => useStore.getState().setView(nv),
      onReset: () => useStore.getState().resetView(),
    });

    // Shift+click adds an annotation marker.
    u.over.addEventListener("click", (e: MouseEvent) => {
      if (!e.shiftKey) return;
      const rect = u.over.getBoundingClientRect();
      const xVal = u.posToVal(e.clientX - rect.left, "x");
      useStore.getState().addAnnotation({ x: xVal, label: "", color: "hsl(320 80% 60%)" });
    });
  }

  return <div ref={containerRef} className="lv-chart" style={{ height: "100%", minHeight: height }} />;
}
