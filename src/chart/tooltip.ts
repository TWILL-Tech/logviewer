// Custom crosshair tooltip plugin for uPlot. Shows the X value and, for each
// visible series, its value where the crosshair intersects it (the y-intercept).
// Band-helper series are tagged so they don't appear as duplicate rows.

import type uPlot from "uplot";
import { fmtNum, fmtX } from "../util/format";

export interface TipSeries {
  tip?: boolean; // include in tooltip
  tipLabel?: string;
  tipColor?: string;
  integral?: boolean;
}

export function tooltipPlugin(timeName: string): uPlot.Plugin {
  let el: HTMLDivElement;

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
          return;
        }
        const xs = u.data[0];
        const x = xs[idx];
        if (x == null) {
          el.style.display = "none";
          return;
        }

        let html = `<div class="lv-tip-x">${fmtX(x as number, timeName)}</div>`;
        for (let i = 1; i < u.series.length; i++) {
          const s = u.series[i] as uPlot.Series & TipSeries;
          if (!s.tip) continue;
          const v = u.data[i]?.[idx];
          html +=
            `<div class="lv-tip-row">` +
            `<span class="lv-tip-swatch" style="background:${s.tipColor}"></span>` +
            `<span class="lv-tip-name">${escapeHtml(s.tipLabel ?? "")}</span>` +
            `<span class="lv-tip-val">${fmtNum(v as number, s.integral)}</span>` +
            `</div>`;
        }
        el.innerHTML = html;
        el.style.display = "block";

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
