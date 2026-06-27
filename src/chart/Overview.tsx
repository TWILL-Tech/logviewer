// Full-extent timeline strip. Shows every visible series decimated over the
// whole dataset; a drag-select brush sets the main viewport, and the current
// viewport is reflected back as the selection box. Two-way binding is guarded by
// a flag to avoid update loops.

import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import { dataClient } from "../data/client";
import { buildChartData } from "./buildData";
import { useStore } from "../state/store";
import type { ChannelSlice } from "../worker/types";

const OVERVIEW_HEIGHT = 84;

export function Overview() {
  const containerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const structureRef = useRef("");
  const reqToken = useRef(0);
  const programmatic = useRef(false);

  const series = useStore((s) => s.series);
  const view = useStore((s) => s.view);
  const fullExtent = useStore((s) => s.fullExtent);

  const configs = useMemo(() => series.filter((s) => s.visible), [series]);
  const configSig = useMemo(
    () => configs.map((c) => `${c.key}:${c.color}`).join(","),
    [configs],
  );

  // Build/refresh the overview data over the full extent.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const el = containerRef.current;
      if (!el || !fullExtent || !configs.length) {
        uplotRef.current?.destroy();
        uplotRef.current = null;
        structureRef.current = "";
        return;
      }
      const token = ++reqToken.current;
      const w = el.clientWidth || 800;

      const byDs = new Map<number, number[]>();
      for (const c of configs) {
        const arr = byDs.get(c.datasetId) ?? [];
        arr.push(c.channelId);
        byDs.set(c.datasetId, arr);
      }
      const all: ChannelSlice[] = [];
      for (const [dsId, ids] of byDs) {
        const slices = await dataClient.query({
          datasetId: dsId,
          channelIds: ids,
          xMin: fullExtent.xMin,
          xMax: fullExtent.xMax,
          pixelWidth: Math.max(50, w),
        });
        all.push(...slices);
      }
      if (cancelled || token !== reqToken.current) return;

      // Flatten every series onto the left scale for a compact overview.
      const flat = configs.map((c) => ({ ...c, axis: "left" as const }));
      const model = buildChartData(all, flat);

      if (!uplotRef.current || model.structureKey !== structureRef.current) {
        rebuild(model, w);
      } else {
        uplotRef.current.setData(model.data);
        reflectView();
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configSig, fullExtent?.xMin, fullExtent?.xMax]);

  // Reflect the current viewport as the selection box.
  useEffect(() => {
    reflectView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.xMin, view?.xMax, fullExtent?.xMin, fullExtent?.xMax]);

  // Resize.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (uplotRef.current) {
        uplotRef.current.setSize({ width: el.clientWidth, height: OVERVIEW_HEIGHT });
        reflectView();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, []);

  function reflectView() {
    const u = uplotRef.current;
    if (!u || !fullExtent) return;
    const v = view ?? fullExtent;
    const left = u.valToPos(v.xMin, "x");
    const right = u.valToPos(v.xMax, "x");
    programmatic.current = true;
    u.setSelect(
      { left, width: Math.max(1, right - left), top: 0, height: u.over.clientHeight },
      false,
    );
    programmatic.current = false;
  }

  function rebuild(model: ReturnType<typeof buildChartData>, w: number) {
    uplotRef.current?.destroy();
    structureRef.current = model.structureKey;
    const setView = useStore.getState().setView;
    const getFull = () => useStore.getState().fullExtent;

    const opts: uPlot.Options = {
      width: w,
      height: OVERVIEW_HEIGHT,
      scales: {
        x: {
          time: false,
          range: () => {
            const f = getFull();
            return f ? [f.xMin, f.xMax] : [0, 1];
          },
        },
        y: { auto: true },
        yR: { auto: true },
      },
      axes: [
        { show: false },
        { show: false, scale: "y" },
      ],
      series: model.series,
      bands: model.bands,
      legend: { show: false },
      // Pure brush: select without zooming the overview's own scale.
      cursor: { drag: { x: true, y: false, setScale: false }, points: { show: false } },
      hooks: {
        setSelect: [
          (u: uPlot) => {
            if (programmatic.current) return;
            const sel = u.select;
            if (sel.width < 2) return; // ignore clicks
            const xMin = u.posToVal(sel.left, "x");
            const xMax = u.posToVal(sel.left + sel.width, "x");
            setView({ xMin, xMax });
          },
        ],
      },
    };
    const u = new uPlot(opts, model.data, containerRef.current!);
    uplotRef.current = u;
    reflectView();
  }

  return <div ref={containerRef} className="lv-overview" style={{ height: OVERVIEW_HEIGHT }} />;
}
