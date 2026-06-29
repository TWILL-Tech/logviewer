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

type ChartModel = ReturnType<typeof buildChartData>;
type Range = [number, number];

const Y_ANIM_MS = 200;
const HIGHLIGHT_WIDTH_MUL = 2.4;

/** Min/max of every series on a given scale, padded; null if no data. */
function computeExtent(model: ChartModel, scaleKey: string): Range | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < model.series.length; i++) {
    if (model.series[i].scale !== scaleKey) continue;
    const arr = model.data[i] as ArrayLike<number | null> | undefined;
    if (!arr) continue;
    for (let j = 0; j < arr.length; j++) {
      const v = arr[j];
      if (v == null || Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return null;
  if (min === max) {
    const d = Math.abs(min) * 0.05 || 1;
    return [min - d, max + d];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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

  // Y-range control (lock + animation). dispY/dispYR are the currently shown
  // ranges that the scale range fns return; we tween them toward targets.
  const dispY = useRef<Range | null>(null);
  const dispYR = useRef<Range | null>(null);
  const lockedY = useRef<Range | null>(null);
  const lockedYR = useRef<Range | null>(null);
  const lockYRef = useRef(false);
  const yAnim = useRef(0);
  const yFallback = useRef(0);
  const modelRef = useRef<ChartModel | null>(null);
  const primaryIdxRef = useRef<Record<string, number>>({});

  // Series-highlight state. We emphasize a series by re-drawing it thicker and
  // on top (an overlay), leaving the others untouched. Two sources feed it:
  // hovering a row in the table (pinned) and the cursor nearing a trace on the
  // chart (hover); the pinned one wins when both are set.
  const hlPinnedIdx = useRef<number | null>(null);
  const hlHoverIdx = useRef<number | null>(null);

  const series = useStore((s) => s.series);
  const datasets = useStore((s) => s.datasets);
  const view = useStore((s) => s.view);
  const fullExtent = useStore((s) => s.fullExtent);
  const annotations = useStore((s) => s.annotations);
  const lockY = useStore((s) => s.lockY);

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

  // Lock Y: capture the current ranges when locking; re-autorange when unlocking.
  useEffect(() => {
    lockYRef.current = lockY;
    if (lockY) {
      lockedY.current = dispY.current;
      lockedYR.current = dispYR.current;
    } else {
      lockedY.current = null;
      lockedYR.current = null;
      if (modelRef.current) applyY(modelRef.current, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockY]);

  // Highlight the series hovered in the table (transient store subscription so
  // this doesn't re-render or re-query the chart).
  useEffect(() => {
    let last: string | null = useStore.getState().highlightKey;
    applyHighlight(last);
    return useStore.subscribe((st) => {
      if (st.highlightKey === last) return;
      last = st.highlightKey;
      applyHighlight(last);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Teardown.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafId.current);
      cancelAnimationFrame(yAnim.current);
      clearTimeout(timeoutId.current);
      clearTimeout(yFallback.current);
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, []);

  // Compute Y targets for the model and move the displayed ranges toward them.
  function applyY(model: ChartModel, animate: boolean) {
    modelRef.current = model;
    primaryIdxRef.current = model.primaryIndexByKey;
    const targetY = lockYRef.current ? lockedY.current : computeExtent(model, "y");
    const targetYR = lockYRef.current ? lockedYR.current : computeExtent(model, "yR");
    animateYTo(targetY, targetYR, animate && !lockYRef.current);
  }

  // Push the current displayed ranges to uPlot. setScale (unlike redraw)
  // actually recomputes the scale and repaints.
  function pushY() {
    const u = uplotRef.current;
    if (!u) return;
    if (dispY.current) u.setScale("y", { min: dispY.current[0], max: dispY.current[1] });
    if (dispYR.current) u.setScale("yR", { min: dispYR.current[0], max: dispYR.current[1] });
  }

  function settleY(targetY: Range | null, targetYR: Range | null) {
    cancelAnimationFrame(yAnim.current);
    clearTimeout(yFallback.current);
    if (targetY) dispY.current = targetY;
    if (targetYR) dispYR.current = targetYR;
    pushY();
  }

  function animateYTo(targetY: Range | null, targetYR: Range | null, animate: boolean) {
    cancelAnimationFrame(yAnim.current);
    clearTimeout(yFallback.current);
    const startY = dispY.current;
    const startYR = dispYR.current;
    if (!animate || (!startY && !startYR)) {
      settleY(targetY, targetYR);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / Y_ANIM_MS);
      const e = 1 - Math.pow(1 - k, 3); // ease-out cubic
      if (targetY) dispY.current = startY ? [lerp(startY[0], targetY[0], e), lerp(startY[1], targetY[1], e)] : targetY;
      if (targetYR) dispYR.current = startYR ? [lerp(startYR[0], targetYR[0], e), lerp(startYR[1], targetYR[1], e)] : targetYR;
      pushY();
      if (k < 1) yAnim.current = requestAnimationFrame(step);
    };
    yAnim.current = requestAnimationFrame(step);
    // Guarantee the final range even if rAF is throttled (hidden/background tab).
    yFallback.current = window.setTimeout(() => settleY(targetY, targetYR), Y_ANIM_MS + 80);
  }

  // The series index to emphasize: a pinned (table-hover) selection wins over
  // the cursor-proximity hover.
  function effectiveHlIdx(): number | null {
    return hlPinnedIdx.current ?? hlHoverIdx.current;
  }

  // Table-row hover sets the pinned highlight.
  function applyHighlight(key: string | null) {
    const next = key != null ? primaryIdxRef.current[key] ?? null : null;
    if (next === hlPinnedIdx.current) return;
    hlPinnedIdx.current = next;
    uplotRef.current?.redraw();
  }

  // Cursor proximity (from the tooltip plugin) sets the hover highlight.
  function setHoverHighlight(idx: number | null) {
    if (idx === hlHoverIdx.current) return;
    hlHoverIdx.current = idx;
    uplotRef.current?.redraw();
  }

  // Re-draw the emphasized series thicker and on top of everything else.
  function drawHighlight(u: uPlot) {
    const idx = effectiveHlIdx();
    if (idx == null) return;
    const s = u.series[idx];
    if (!s || s.show === false) return;
    const xs = u.data[0];
    const ys = u.data[idx] as ArrayLike<number | null> | undefined;
    if (!ys) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = s.scale || "y";
    const baseW = typeof s.width === "number" ? s.width : 1.25;
    const ctx = u.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
    ctx.clip();
    ctx.lineWidth = baseW * HIGHLIGHT_WIDTH_MUL * dpr;
    // uPlot wraps series.stroke into a function internally, so read the color we
    // stashed on the series (tipColor) instead.
    const tip = s as { tipColor?: string };
    ctx.strokeStyle = tip.tipColor || (s as { _stroke?: string })._stroke || "#888";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < xs.length; i++) {
      const yv = ys[i];
      if (yv == null || Number.isNaN(yv)) {
        pen = false;
        continue;
      }
      const px = u.valToPos(xs[i] as number, "x", true);
      const py = u.valToPos(yv, scale, true);
      if (!pen) {
        ctx.moveTo(px, py);
        pen = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

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
      applyY(model, false); // pan/zoom: snap Y instantly (no animation)
    }
  }

  function rebuild(model: ChartModel, w: number, h: number) {
    uplotRef.current?.destroy();
    structureRef.current = model.structureKey;

    // Seed displayed Y on the very first build so the first frame is correct.
    // On later rebuilds dispY holds the previous range, so we animate from it.
    if (!dispY.current) dispY.current = lockYRef.current ? lockedY.current : computeExtent(model, "y");
    if (!dispYR.current) dispYR.current = lockYRef.current ? lockedYR.current : computeExtent(model, "yR");

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
        // We control Y ourselves via setScale (for lock + animation); auto:false
        // so setData doesn't re-autorange behind our back.
        y: { auto: false },
        yR: { auto: false },
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
      plugins: [
        tooltipPlugin(timeName, setHoverHighlight),
        annotationPlugin(() => annRef.current),
        { hooks: { draw: drawHighlight } },
      ],
    };

    const u = new uPlot(opts, model.data, containerRef.current!);
    uplotRef.current = u;

    // Animate Y to the new target (skipped/instant when locked), then restore
    // any active highlight onto the fresh instance.
    applyY(model, true);
    hlHoverIdx.current = null;
    hlPinnedIdx.current = null;
    applyHighlight(useStore.getState().highlightKey);

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
