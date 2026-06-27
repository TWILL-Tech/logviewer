// Platform abstraction so the app runs both as a Tauri desktop app (native file
// I/O, dialogs, multi-window, OS drag-drop by path) and as a plain web app in a
// browser (HTML5 drag-drop File objects, download links). The rest of the app
// imports only from here.

export interface LoadedFile {
  name: string;
  bytes: ArrayBuffer;
}

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---- Lazy Tauri API loading (kept out of the web bundle's critical path) ----

async function tauri() {
  const core = await import("@tauri-apps/api/core");
  const webview = await import("@tauri-apps/api/webview");
  const webviewWindow = await import("@tauri-apps/api/webviewWindow");
  const dialog = await import("@tauri-apps/plugin-dialog");
  return { core, webview, webviewWindow, dialog };
}

/** Open one or more CSV files via a native/browser picker. */
export async function pickFiles(): Promise<LoadedFile[]> {
  if (isTauri) {
    const { core, dialog } = await tauri();
    const selected = await dialog.open({
      multiple: true,
      filters: [{ name: "CSV", extensions: ["csv", "txt", "log"] }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    return Promise.all(paths.map((p) => readPath(p, core)));
  }
  // Browser: synthesize a file input.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,.log";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(fileToLoaded)));
    };
    input.click();
  });
}

/** Read a file from an absolute path (Tauri only). */
export async function readPath(
  path: string,
  core?: Awaited<ReturnType<typeof tauri>>["core"],
): Promise<LoadedFile> {
  const c = core ?? (await tauri()).core;
  // read_file returns raw bytes as an ArrayBuffer via tauri::ipc::Response.
  const bytes = await c.invoke<ArrayBuffer>("read_file", { path });
  const name = path.split(/[\\/]/).pop() ?? path;
  return { name, bytes };
}

export async function fileToLoaded(file: File): Promise<LoadedFile> {
  return { name: file.name, bytes: await file.arrayBuffer() };
}

/** Save text to a user-chosen location. Returns the path/handle name or null. */
export async function saveText(
  suggestedName: string,
  contents: string,
): Promise<string | null> {
  if (isTauri) {
    const { core, dialog } = await tauri();
    const path = await dialog.save({
      defaultPath: suggestedName,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return null;
    await core.invoke("write_file", { path, contents });
    return path;
  }
  downloadBlob(new Blob([contents], { type: "text/csv" }), suggestedName);
  return suggestedName;
}

/** Save binary (PNG) to a user-chosen location. */
export async function saveBytes(
  suggestedName: string,
  bytes: Uint8Array,
): Promise<string | null> {
  if (isTauri) {
    const { core, dialog } = await tauri();
    const path = await dialog.save({
      defaultPath: suggestedName,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!path) return null;
    await core.invoke("write_bytes", { path, contents: Array.from(bytes) });
    return path;
  }
  downloadBlob(new Blob([bytes as BlobPart], { type: "image/png" }), suggestedName);
  return suggestedName;
}

/** Subscribe to OS file drops (Tauri) — returns an unlisten function. */
export async function onFileDrop(
  handler: (files: LoadedFile[]) => void,
  onHover?: (hovering: boolean) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { core, webview } = await tauri();
  const w = webview.getCurrentWebview();
  const unlisten = await w.onDragDropEvent(async (event) => {
    const p = event.payload;
    if (p.type === "enter" || p.type === "over") onHover?.(true);
    else if (p.type === "leave") onHover?.(false);
    else if (p.type === "drop") {
      onHover?.(false);
      const files = await Promise.all(p.paths.map((path) => readPath(path, core)));
      handler(files);
    }
  });
  return unlisten;
}

/** Open a duplicate app window (Tauri) or a new browser tab. */
export async function spawnWindow(): Promise<void> {
  if (isTauri) {
    const { webviewWindow } = await tauri();
    const label = `chart-${Date.now()}`;
    new webviewWindow.WebviewWindow(label, {
      url: "index.html",
      title: "LogViewer",
      width: 1200,
      height: 800,
      dragDropEnabled: true,
    });
    return;
  }
  window.open(window.location.href, "_blank");
}

/** Copy a PNG blob to the clipboard. Returns true on success. */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
