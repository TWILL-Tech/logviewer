// App shell: toolbar, side panel (series table + annotations), and the chart
// grid. Handles drag-and-drop for both Tauri (OS paths) and the browser.

import { useEffect, useRef, useState } from "react";
import { Toolbar } from "./ui/Toolbar";
import { SeriesTable } from "./ui/SeriesTable";
import { ChartGrid } from "./ui/ChartGrid";
import { useStore } from "./state/store";
import { loadFiles } from "./data/load";
import { fmtNum } from "./util/format";
import {
  isTauri,
  onFileDrop,
  fileToLoaded,
} from "./platform/platform";

export default function App() {
  const chartsRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const annotations = useStore((s) => s.annotations);
  const removeAnnotation = useStore((s) => s.removeAnnotation);
  const hasData = useStore((s) => s.fullExtent != null);

  // Tauri OS drag-drop (paths).
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    onFileDrop(
      (files) => loadFiles(files),
      (h) => setHovering(h),
    ).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  // Browser drag-drop (File objects). No-op under Tauri (OS handles it).
  const onDrop = async (e: React.DragEvent) => {
    if (isTauri) return;
    e.preventDefault();
    setHovering(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) await loadFiles(await Promise.all(files.map(fileToLoaded)));
  };
  const onDragOver = (e: React.DragEvent) => {
    if (isTauri) return;
    e.preventDefault();
    setHovering(true);
  };
  const onDragLeave = () => {
    if (isTauri) return;
    setHovering(false);
  };

  return (
    <div
      className="lv-app"
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <Toolbar chartsRef={chartsRef} />
      <div className="lv-main">
        {hasData && (
          <aside className="lv-side">
            <SeriesTable />
            {annotations.length > 0 && (
              <div className="lv-annotations">
                <div className="lv-annotations-head">Annotations</div>
                <ul>
                  {annotations.map((a) => (
                    <li key={a.id}>
                      <span className="lv-swatch" style={{ background: a.color }} />
                      <span>{a.label || fmtNum(a.x)}</span>
                      <button onClick={() => removeAnnotation(a.id)}>×</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
        <main className="lv-content" ref={chartsRef}>
          <ChartGrid />
        </main>
      </div>
      {hovering && (
        <div className="lv-drop-overlay">
          <div>Drop CSV to load</div>
        </div>
      )}
    </div>
  );
}
