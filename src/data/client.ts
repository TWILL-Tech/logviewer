// Main-thread handle to the data worker. Promise-based request/response keyed by
// an incrementing request id.

import type {
  ChannelSlice,
  DatasetMeta,
  ViewportQuery,
  WorkerRequest,
  WorkerResponse,
} from "../worker/types";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

// Omit that distributes over the request union so per-variant fields survive.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

class DataClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextReqId = 1;
  private nextDatasetId = 1;

  constructor() {
    this.worker = new Worker(
      new URL("../worker/data.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      this.pending.delete(msg.reqId);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
  }

  private send<T>(req: DistributiveOmit<WorkerRequest, "reqId">, transfer?: Transferable[]): Promise<T> {
    const reqId = this.nextReqId++;
    const full = { ...req, reqId } as WorkerRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
      if (transfer && transfer.length) this.worker.postMessage(full, transfer);
      else this.worker.postMessage(full);
    });
  }

  async parse(name: string, bytes: ArrayBuffer): Promise<DatasetMeta> {
    const datasetId = this.nextDatasetId++;
    const res = await this.send<{ meta: DatasetMeta }>(
      { type: "parse", datasetId, name, bytes },
      [bytes],
    );
    return res.meta;
  }

  async query(query: ViewportQuery): Promise<ChannelSlice[]> {
    const res = await this.send<{ slices: ChannelSlice[] }>({ type: "query", query });
    return res.slices;
  }

  async exportCsv(
    datasetId: number,
    channelIds: number[],
    xMin: number,
    xMax: number,
  ): Promise<string> {
    const res = await this.send<{ csv: string }>({
      type: "export",
      datasetId,
      channelIds,
      xMin,
      xMax,
    });
    return res.csv;
  }

  async free(datasetId: number): Promise<void> {
    await this.send({ type: "free", datasetId });
  }
}

// A single shared worker is plenty; parsing is one-time and queries are light.
export const dataClient = new DataClient();
