// Wheel-zoom + drag-pan for a uPlot instance. uPlot has no native pan; we drive
// a shared X viewport (in the store) instead of uPlot's own scale state, so all
// charts and the overview stay in sync.

import type uPlot from "uplot";
import type { Extent } from "../state/store";

export interface ZoomPanOpts {
  getExtent: () => Extent | null; // full data extent (clamp bounds)
  getView: () => Extent | null; // current view (null = full)
  onView: (view: Extent | null) => void;
  onReset: () => void;
}

export function attachZoomPan(u: uPlot, opts: ZoomPanOpts): () => void {
  const over = u.over;

  const curView = (): Extent => {
    const v = opts.getView();
    if (v) return v;
    const e = opts.getExtent();
    return e ?? { xMin: 0, xMax: 1 };
  };

  const clampSpanMin = (): number => {
    const e = opts.getExtent();
    if (!e) return 1e-9;
    return Math.max((e.xMax - e.xMin) / 1e7, 1e-12);
  };

  const clampView = (xMin: number, xMax: number): Extent => {
    const e = opts.getExtent();
    let lo = xMin;
    let hi = xMax;
    const minSpan = clampSpanMin();
    if (hi - lo < minSpan) {
      const mid = (lo + hi) / 2;
      lo = mid - minSpan / 2;
      hi = mid + minSpan / 2;
    }
    if (e) {
      if (lo < e.xMin) {
        hi += e.xMin - lo;
        lo = e.xMin;
      }
      if (hi > e.xMax) {
        lo -= hi - e.xMax;
        hi = e.xMax;
      }
      lo = Math.max(lo, e.xMin);
      hi = Math.min(hi, e.xMax);
    }
    return { xMin: lo, xMax: hi };
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = over.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const { xMin, xMax } = curView();
    const pivot = xMin + frac * (xMax - xMin);
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const nMin = pivot - (pivot - xMin) * factor;
    const nMax = pivot + (xMax - pivot) * factor;
    opts.onView(clampView(nMin, nMax));
  };

  // Panning state.
  let panning = false;
  let startClientX = 0;
  let startView: Extent = { xMin: 0, xMax: 1 };

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    panning = true;
    startClientX = e.clientX;
    startView = curView();
    over.style.cursor = "grabbing";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const onMove = (e: MouseEvent) => {
    if (!panning) return;
    const dx = e.clientX - startClientX;
    const valPerPx = (startView.xMax - startView.xMin) / over.clientWidth;
    const shift = -dx * valPerPx;
    opts.onView(clampView(startView.xMin + shift, startView.xMax + shift));
  };
  const onUp = () => {
    panning = false;
    over.style.cursor = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  const onDblClick = () => opts.onReset();

  over.addEventListener("wheel", onWheel, { passive: false });
  over.addEventListener("mousedown", onDown);
  over.addEventListener("dblclick", onDblClick);

  return () => {
    over.removeEventListener("wheel", onWheel);
    over.removeEventListener("mousedown", onDown);
    over.removeEventListener("dblclick", onDblClick);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
}
