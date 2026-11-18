import type { LocalNeuralVoice } from "./localNeuralVoices";

export type LocalNeuralRequest =
  | { id: number; kind: "synthesize"; voice: LocalNeuralVoice; text: string; rate: number }
  | { id: number; kind: "cancel" };
export type LocalNeuralResponse =
  | { id: number; kind: "audio"; blob: Blob }
  | { id: number; kind: "failed"; stage: "model" | "inference" };

type Pending = {
  complete: (value: Blob) => void;
  fail: (error: unknown) => void;
};

let worker: Worker | undefined;
let nextId = 0;
// Holds only requests currently in flight. Text travels to the worker, never to fetch.
const pending = new Map<number, Pending>();

function getWorker() {
  if (worker) return worker;
  if (typeof Worker !== "function" || typeof WebAssembly !== "object") {
    throw new Error("local_neural_unsupported");
  }
  const created = new Worker(new URL("./localNeural.worker.ts", import.meta.url), { type: "module" });
  worker = created;
  created.onmessage = ({ data }: MessageEvent<LocalNeuralResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    if (data.kind === "failed") request.fail(new Error(`local_neural_${data.stage}`));
    else request.complete(data.blob);
  };
  function disconnected(event: Event) {
    event.preventDefault();
    if (worker !== created) return;
    created.terminate();
    worker = undefined;
    for (const request of pending.values()) request.fail(new Error("local_neural_worker"));
  }
  created.addEventListener("error", disconnected);
  created.addEventListener("messageerror", disconnected);
  return created;
}

function run(request: Extract<LocalNeuralRequest, { kind: "synthesize" }>, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const current = getWorker();
  return new Promise((resolve, reject) => {
    const finish = () => {
      pending.delete(request.id);
      signal.removeEventListener("abort", cancel);
    };
    function cancel() {
      finish();
      current.postMessage({ id: request.id, kind: "cancel" } satisfies LocalNeuralRequest);
      reject(new DOMException("Síntese cancelada.", "AbortError"));
    }
    pending.set(request.id, {
      complete(blob) { finish(); resolve(blob); },
      fail(error) { finish(); reject(error); },
    });
    signal.addEventListener("abort", cancel, { once: true });
    try {
      current.postMessage(request);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

export async function synthesizeLocalNeural(
  text: string, voice: LocalNeuralVoice, rate: number, signal: AbortSignal,
): Promise<Blob> {
  const blob = await run({ id: ++nextId, kind: "synthesize", text, voice, rate }, signal);
  if (!blob || blob.type !== "audio/wav" || blob.size <= 44) throw new Error("local_neural_audio");
  return blob;
}
