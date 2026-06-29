// Custom crosshair tooltip plugin for uPlot. Shows the X value and, for each
// visible series, its value where the crosshair intersects it (the y-intercept).
// Also detects the series nearest the cursor: its row is marked, and its index
// is reported via onNearest so the chart can emphasize that trace — making it
// easy to tell which line you're pointing at.

import type uPlot from "uplot";
import { fmtNum, fmtX } from "../util/format";

export interface TipSeries {
  tip?: boolean; // include in tooltip
  tipLabel?: string;
  tipColor?: string;
  integral?: boolean;
}

// How close (px) the cursor must be to a trace to count as "nearest".
const NEAR_PX = 24;

export function tooltipPlugin(
  timeName: string,
  onNearest?: (seriesIdx: number | null) => void,
): uPlot.Plugin {
  let el: HTMLDivElement;
  let lastNear: number | null = null;

  const report = (idx: number | null) => {
    if (idx === lastNear) return;
    lastNear = idx;
    onNearest?.(idx);
  };

  return {
    hooks: {
      init: (u: uPlot) => {
        el = document.createElement("div");
        el.className = "lv-tooltip";
        el.style.display = "none";
        u.over.appendChild(el);
      },
      setCursor: (u: uPlot) => {
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || top == null || left < 0 || top < 0) {
          el.style.display = "none";
          report(null);
          return;
        }
        const xs = u.data[0];
        const x = xs[idx];
        if (x == null) {
          el.style.display = "none";
          report(null);
          return;
        }

        // Find the tip series whose value at the cursor is closest (in pixels)
        // to the cursor's Y position.
        let nearIdx: number | null = null;
        let nearDist = NEAR_PX;
        for (let i = 1; i < u.series.length; i++) {
          const s = u.series[i] as uPlot.Series & TipSeries;
          if (!s.tip) continue;
          const v = u.data[i]?.[idx];
          if (v == null || Number.isNaN(v as number)) continue;
          const py = u.valToPos(v as number, s.scale || "y");
          const d = Math.abs(py - top);
          if (d < nearDist) {
            nearDist = d;
            nearIdx = i;
          }
        }

        let html = `<div class="lv-tip-x">${fmtX(x as number, timeName)}</div>`;
        for (let i = 1; i < u.series.length; i++) {
          const s = u.series[i] as uPlot.Series & TipSeries;
          if (!s.tip) continue;
          const v = u.data[i]?.[idx];
          const near = i === nearIdx ? " lv-tip-near" : "";
          html +=
            `<div class="lv-tip-row${near}">` +
            `<span class="lv-tip-swatch" style="background:${s.tipColor}"></span>` +
            `<span class="lv-tip-name">${escapeHtml(s.tipLabel ?? "")}</span>` +
            `<span class="lv-tip-val">${fmtNum(v as number, s.integral)}</span>` +
            `</div>`;
        }
        el.innerHTML = html;
        el.style.display = "block";
        report(nearIdx);

        // Position within the plotting area, flipping near the right/bottom edge.
        const ow = u.over.clientWidth;
        const oh = u.over.clientHeight;
        const tw = el.offsetWidth;
        const th = el.offsetHeight;
        let lx = left + 14;
        let ty = top + 14;
        if (lx + tw > ow) lx = left - tw - 14;
        if (ty + th > oh) ty = oh - th - 4;
        if (ty < 0) ty = 0;
        el.style.left = `${lx}px`;
        el.style.top = `${ty}px`;
      },
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
