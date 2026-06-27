// Stacked charts sharing one X viewport + cursor sync, with the overview strip
// on top. Charts can be added, removed, and have series moved between them
// (split/stack) via the series table.

import { Overview } from "../chart/Overview";
import { Chart } from "../chart/Chart";
import { useStore } from "../state/store";

const SYNC_KEY = "lv-sync";

export function ChartGrid() {
  const charts = useStore((s) => s.charts);
  const removeChart = useStore((s) => s.removeChart);
  const fullExtent = useStore((s) => s.fullExtent);

  if (!fullExtent) {
    return (
      <div className="lv-empty">
        <div>
          <h2>Drop a CSV log to begin</h2>
          <p>Drag &amp; drop a file anywhere, or use “Open” in the toolbar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lv-charts">
      <Overview />
      {charts.map((c) => (
        <div className="lv-chart-panel" key={c.id}>
          <div className="lv-chart-head">
            <span className="lv-chart-title">{c.title}</span>
            {charts.length > 1 && (
              <button
                className="lv-chart-close"
                title="Remove chart (series move to first chart)"
                onClick={() => removeChart(c.id)}
              >
                ×
              </button>
            )}
          </div>
          <div className="lv-chart-body">
            <Chart chartId={c.id} syncKey={SYNC_KEY} height={180} />
          </div>
        </div>
      ))}
    </div>
  );
}
