// Series picker + statistics table. Each row shows visibility, color, name,
// per-channel stats, a histogram sparkline, and axis/chart assignment. Sortable
// and filterable so useless (constant/dead) channels are easy to spot and cull.

import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import type { ChannelMeta } from "../worker/types";
import { Sparkline } from "./Sparkline";
import { fmtNum } from "../util/format";
import { hslToHex } from "../util/color";

type SortKey = "name" | "mean" | "std" | "min" | "max" | "cv" | "distinct";

interface Row {
  key: string;
  meta: ChannelMeta;
  visible: boolean;
  color: string;
  axis: "left" | "right";
  chartId: string;
  datasetId: number;
  constant: boolean;
}

export function SeriesTable() {
  const series = useStore((s) => s.series);
  const datasets = useStore((s) => s.datasets);
  const charts = useStore((s) => s.charts);
  const toggleVisible = useStore((s) => s.toggleVisible);
  const setVisibleBulk = useStore((s) => s.setVisibleBulk);
  const setColor = useStore((s) => s.setColor);
  const setAxis = useStore((s) => s.setAxis);
  const moveToChart = useStore((s) => s.moveToChart);
  const setHighlight = useStore((s) => s.setHighlight);

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [asc, setAsc] = useState(true);

  const metaById = useMemo(() => {
    const m = new Map<string, ChannelMeta>();
    for (const ds of datasets)
      for (const c of ds.channels) m.set(`${ds.datasetId}:${c.id}`, c);
    return m;
  }, [datasets]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    for (const s of series) {
      const meta = metaById.get(s.key);
      if (!meta) continue;
      const constant = meta.stats.distinct <= 1 || (meta.stats.cv < 0.005 && meta.kind === "float");
      list.push({
        key: s.key,
        meta,
        visible: s.visible,
        color: s.color,
        axis: s.axis,
        chartId: s.chartId,
        datasetId: s.datasetId,
        constant,
      });
    }
    const f = filter.trim().toLowerCase();
    const filtered = f ? list.filter((r) => r.meta.name.toLowerCase().includes(f)) : list;
    const dir = asc ? 1 : -1;
    filtered.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sort === "name") {
        av = a.meta.name;
        bv = b.meta.name;
        return av < bv ? -dir : av > bv ? dir : 0;
      }
      av = a.meta.stats[sort];
      bv = b.meta.stats[sort];
      if (Number.isNaN(av as number)) av = -Infinity;
      if (Number.isNaN(bv as number)) bv = -Infinity;
      return ((av as number) - (bv as number)) * dir;
    });
    return filtered;
  }, [series, metaById, filter, sort, asc]);

  const allKeys = useMemo(() => rows.map((r) => r.key), [rows]);

  const setSortKey = (k: SortKey) => {
    if (k === sort) setAsc(!asc);
    else {
      setSort(k);
      setAsc(true);
    }
  };

  const header = (k: SortKey, label: string) => (
    <th onClick={() => setSortKey(k)} className="lv-sortable">
      {label}
      {sort === k ? (asc ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="lv-series">
      <div className="lv-series-toolbar">
        <input
          className="lv-filter"
          placeholder="Filter series…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button onClick={() => setVisibleBulk(allKeys, true)}>Show all</button>
        <button onClick={() => setVisibleBulk(allKeys, false)}>Hide all</button>
        <button
          title="Hide channels that are constant / dead"
          onClick={() =>
            setVisibleBulk(
              rows.filter((r) => r.constant).map((r) => r.key),
              false,
            )
          }
        >
          Hide constant
        </button>
      </div>
      <div className="lv-series-scroll">
        <table className="lv-table">
          <thead>
            <tr>
              <th></th>
              <th></th>
              {header("name", "Series")}
              <th>Kind</th>
              {header("mean", "Mean")}
              {header("std", "Std")}
              {header("min", "Min")}
              {header("max", "Max")}
              {header("cv", "CV")}
              {header("distinct", "Distinct")}
              <th>Dist.</th>
              <th>Axis</th>
              <th>Chart</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={r.constant ? "lv-row-const" : ""}
                onMouseEnter={() => setHighlight(r.key)}
                onMouseLeave={() => setHighlight(null)}
              >
                <td>
                  <input
                    type="checkbox"
                    checked={r.visible}
                    onChange={() => toggleVisible(r.key)}
                  />
                </td>
                <td>
                  <label className="lv-swatch" style={{ background: r.color }}>
                    <input
                      type="color"
                      value={r.color.startsWith("#") ? r.color : hslToHex(r.color)}
                      onChange={(e) => setColor(r.key, e.target.value)}
                    />
                  </label>
                </td>
                <td className="lv-name" title={r.meta.name}>
                  {r.meta.name}
                </td>
                <td className="lv-kind">{r.meta.kind}</td>
                <td className="lv-num">{fmtNum(r.meta.stats.mean, r.meta.integral)}</td>
                <td className="lv-num">{fmtNum(r.meta.stats.std)}</td>
                <td className="lv-num">{fmtNum(r.meta.stats.min, r.meta.integral)}</td>
                <td className="lv-num">{fmtNum(r.meta.stats.max, r.meta.integral)}</td>
                <td className="lv-num">{Number.isNaN(r.meta.stats.cv) ? "—" : fmtNum(r.meta.stats.cv)}</td>
                <td className="lv-num">
                  {r.meta.stats.distinct}
                  {r.meta.stats.distinctCapped ? "+" : ""}
                </td>
                <td>
                  <Sparkline bins={r.meta.stats.histogram.bins} color={r.color} />
                </td>
                <td>
                  <button
                    className="lv-axis-btn"
                    onClick={() => setAxis(r.key, r.axis === "left" ? "right" : "left")}
                    title="Toggle axis side"
                  >
                    {r.axis === "left" ? "L" : "R"}
                  </button>
                </td>
                <td>
                  <select
                    value={r.chartId}
                    onChange={(e) => moveToChart(r.key, e.target.value)}
                  >
                    {charts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
