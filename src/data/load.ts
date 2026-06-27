// Shared file-loading: parse in the worker then register the dataset in state.

import { dataClient } from "./client";
import { useStore } from "../state/store";
import type { LoadedFile } from "../platform/platform";

export async function loadFiles(
  files: LoadedFile[],
  onStatus?: (msg: string) => void,
): Promise<void> {
  for (const f of files) {
    onStatus?.(`Parsing ${f.name}…`);
    try {
      const meta = await dataClient.parse(f.name, f.bytes);
      useStore.getState().addDataset(meta);
      onStatus?.(
        `Loaded ${f.name}: ${meta.rowCount.toLocaleString()} rows, ${meta.channels.length - 1} channels`,
      );
    } catch (e) {
      onStatus?.(`Error parsing ${f.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
