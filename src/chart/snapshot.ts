// Snapshot the charts area to a PNG (composited DOM, so axes/legend/annotations
// are included) and either copy to clipboard or save to a file.

import { toBlob } from "html-to-image";
import { copyImageToClipboard, saveBytes } from "../platform/platform";

async function capture(el: HTMLElement): Promise<Blob | null> {
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() ||
    "#0d1117";
  return toBlob(el, {
    backgroundColor: bg,
    pixelRatio: window.devicePixelRatio || 1,
    // uPlot uses inline canvases; html-to-image handles them.
  });
}

export async function copySnapshot(el: HTMLElement): Promise<boolean> {
  const blob = await capture(el);
  if (!blob) return false;
  return copyImageToClipboard(blob);
}

export async function saveSnapshot(el: HTMLElement, name: string): Promise<string | null> {
  const blob = await capture(el);
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  return saveBytes(name, buf);
}
