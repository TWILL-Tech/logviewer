// Annotation rendering: vertical markers and shaded ranges drawn over the plot.
// Reads from a ref so annotations can change without rebuilding the uPlot.

import type uPlot from "uplot";
import type { Annotation } from "../state/store";

export function annotationPlugin(getAnns: () => Annotation[]): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const anns = getAnns();
        if (!anns.length) return;
        const ctx = u.ctx;
        const { left, top, width, height } = u.bbox;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        for (const a of anns) {
          const x0 = u.valToPos(a.x, "x", true);
          if (a.x1 != null) {
            const x1 = u.valToPos(a.x1, "x", true);
            ctx.fillStyle = withAlpha(a.color, 0.12);
            ctx.fillRect(Math.min(x0, x1), top, Math.abs(x1 - x0), height);
          }
          ctx.strokeStyle = a.color;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x0, top);
          ctx.lineTo(x0, top + height);
          ctx.stroke();
          ctx.setLineDash([]);
          if (a.label) {
            ctx.fillStyle = a.color;
            ctx.font = "11px system-ui, sans-serif";
            ctx.textBaseline = "top";
            ctx.fillText(a.label, x0 + 3, top + 3);
          }
        }
        ctx.restore();
      },
    },
  };
}

function withAlpha(color: string, alpha: number): string {
  return color.includes("hsl") ? color.replace(")", ` / ${alpha})`) : color;
}
