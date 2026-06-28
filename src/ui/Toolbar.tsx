// Top toolbar: open files, add chart, reset zoom, snapshot, crop/export CSV,
// duplicate window, and a recent-views list.

import { useState } from "react";
import { useStore } from "../state/store";
import { dataClient } from "../data/client";
import { loadFiles } from "../data/load";
import { pickFiles, saveText, spawnWindow } from "../platform/platform";
import { copySnapshot, saveSnapshot } from "../chart/snapshot";
import { listRecent } from "../state/recent";

interface Props {
  chartsRef: React.RefObject<HTMLDivElement | null>;
}

export function Toolbar({ chartsRef }: Props) {
  const addChart = useStore((s) => s.addChart);
  const resetView = useStore((s) => s.resetView);
  const lockY = useStore((s) => s.lockY);
  const setLockY = useStore((s) => s.setLockY);
  const datasets = useStore((s) => s.datasets);
  const series = useStore((s) => s.series);
  const view = useStore((s) => s.view);
  const fullExtent = useStore((s) => s.fullExtent);
  const [status, setStatus] = useState("");

  const onOpen = async () => {
    const files = await pickFiles();
    if (files.length) await loadFiles(files, setStatus);
  };

  const onExport = async () => {
    if (!fullExtent) return;
    const v = view ?? fullExtent;
    // Pick the dataset with the most visible series.
    const byDs = new Map<number, number[]>();
    for (const s of series) {
      if (!s.visible) continue;
      const arr = byDs.get(s.datasetId) ?? [];
      arr.push(s.channelId);
      byDs.set(s.datasetId, arr);
    }
    if (!byDs.size) {
      setStatus("No visible series to export");
      return;
    }
    let best = -1;
    let bestIds: number[] = [];
    for (const [ds, ids] of byDs) if (ids.length > bestIds.length) { best = ds; bestIds = ids; }
    const dsMeta = datasets.find((d) => d.datasetId === best);
    setStatus("Building CSV…");
    const csv = await dataClient.exportCsv(best, bestIds, v.xMin, v.xMax);
    const base = (dsMeta?.name ?? "export").replace(/\.[^.]+$/, "");
    const saved = await saveText(`${base}_crop.csv`, csv);
    setStatus(saved ? `Exported ${saved}` : "Export cancelled");
  };

  const onCopyImg = async () => {
    if (!chartsRef.current) return;
    setStatus("Copying snapshot…");
    const ok = await copySnapshot(chartsRef.current);
    setStatus(ok ? "Snapshot copied to clipboard" : "Clipboard copy failed (try Save)");
  };

  const onSaveImg = async () => {
    if (!chartsRef.current) return;
    setStatus("Rendering snapshot…");
    const saved = await saveSnapshot(chartsRef.current, "logviewer-snapshot.png");
    setStatus(saved ? `Saved ${saved}` : "Snapshot cancelled");
  };

  const recent = listRecent();

  return (
    <div className="lv-toolbar">
      <strong className="lv-brand">LogViewer</strong>
      <button onClick={onOpen}>Open…</button>
      <button onClick={addChart} disabled={!fullExtent}>+ Chart</button>
      <button onClick={resetView} disabled={!fullExtent}>Reset zoom</button>
      <button
        onClick={() => setLockY(!lockY)}
        disabled={!fullExtent}
        className={lockY ? "lv-toggle-on" : ""}
        title="Lock the Y axes so hiding/showing series doesn't rescale them"
      >
        {lockY ? "🔒 Y locked" : "🔓 Lock Y"}
      </button>
      <span className="lv-sep" />
      <button onClick={onCopyImg} disabled={!fullExtent}>Copy image</button>
      <button onClick={onSaveImg} disabled={!fullExtent}>Save image</button>
      <button onClick={onExport} disabled={!fullExtent}>Crop → CSV</button>
      <span className="lv-sep" />
      <button onClick={() => spawnWindow()}>Duplicate window</button>
      {recent.length > 0 && (
        <details className="lv-recent">
          <summary>Recent ({recent.length})</summary>
          <ul>
            {recent.map((r) => (
              <li key={r.signature} title={`signature ${r.signature}`}>
                {r.name}
              </li>
            ))}
          </ul>
        </details>
      )}
      <span className="lv-status">{status}</span>
    </div>
  );
}
