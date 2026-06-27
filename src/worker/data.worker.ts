// Worker entry point: routes requests to the dataStore and posts results back.
// Bulk arrays are transferred (zero-copy) rather than cloned.

import {
  parseDataset,
  queryViewport,
  exportCsv,
  freeDataset,
} from "./dataStore";
import type { WorkerRequest, WorkerResponse } from "./types";

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "parse": {
        const meta = parseDataset(msg.datasetId, msg.name, msg.bytes);
        post({ type: "parsed", reqId: msg.reqId, meta });
        break;
      }
      case "query": {
        const { slices, transfer } = queryViewport(msg.query);
        post({ type: "queried", reqId: msg.reqId, slices }, transfer);
        break;
      }
      case "export": {
        const csv = exportCsv(msg.datasetId, msg.channelIds, msg.xMin, msg.xMax);
        post({ type: "exported", reqId: msg.reqId, csv });
        break;
      }
      case "free": {
        freeDataset(msg.datasetId);
        post({ type: "freed", reqId: msg.reqId });
        break;
      }
    }
  } catch (err) {
    post({
      type: "error",
      reqId: msg.reqId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  if (transfer && transfer.length) {
    (self as unknown as Worker).postMessage(msg, transfer);
  } else {
    (self as unknown as Worker).postMessage(msg);
  }
}
