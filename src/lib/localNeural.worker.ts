import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import createPiperPhonemize from "@diffusionstudio/piper-wasm/build/piper_phonemize.js";
import phonemeDataUrl from "../../node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data?url";
import phonemeWasmUrl from "../../node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url";
import runtimeModuleUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url";
import runtimeWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url";
import { isLocalNeuralVoice, type LocalNeuralVoice } from "./localNeuralVoices";
import type { LocalNeuralRequest, LocalNeuralResponse } from "./localNeuralProvider";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LocalNeuralRequest>) => void) | null;
  postMessage(message: LocalNeuralResponse): void;
};

const MODEL_REVISION = "d5de91c972ba5a13cea0e77a63fda1623faac2c1";
const MODEL_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/" + MODEL_REVISION + "/pt/pt_BR";
const MODEL_PATHS: Record<LocalNeuralVoice, string> = {
  "pt_BR-faber-medium": "faber/medium/pt_BR-faber-medium.onnx",
  "pt_BR-edresson-low": "edresson/low/pt_BR-edresson-low.onnx",
};

type PiperConfig = {
  audio: { sample_rate: number };
  espeak: { voice: "pt-br" };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: 1;
  num_symbols: number;
  phoneme_id_map: Record<string, number[]>;
};
type VoiceSession = { voice: LocalNeuralVoice; session: InferenceSession; config: PiperConfig };

env.wasm.numThreads = 1;
env.wasm.wasmPaths = { mjs: runtimeModuleUrl, wasm: runtimeWasmUrl };

let voiceSession: VoiceSession | undefined;
let phonemizer: Awaited<ReturnType<typeof createPiperPhonemize>> | undefined;
let phonemeOutput: string[] = [];

// Cache only public model files. Patient text and generated audio never enter Cache Storage.
async function modelFile(path: string): Promise<Response> {
  const url = MODEL_BASE + "/" + path;
  const cache = await globalThis.caches?.open("comunica-piper-models-v1").catch(() => null);
  const stored = await cache?.match(url).catch(() => undefined);
  if (stored) return stored;
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("piper_model_download");
  if (cache) void cache.put(url, response.clone()).catch(() => {});
  return response;
}

async function getVoice(voice: LocalNeuralVoice): Promise<VoiceSession> {
  if (voiceSession?.voice === voice) return voiceSession;
  if (voiceSession) {
    const old = voiceSession;
    voiceSession = undefined;
    await old.session.release();
  }
  const path = MODEL_PATHS[voice];
  const [weights, description] = await Promise.all([modelFile(path), modelFile(path + ".json")]);
  const config = await description.json() as PiperConfig;
  if (config.espeak?.voice !== "pt-br" || config.num_speakers !== 1 || !config.phoneme_id_map ||
      ![16_000, 22_050].includes(config.audio?.sample_rate) ||
      ![config.inference?.noise_scale, config.inference?.length_scale, config.inference?.noise_w].every(Number.isFinite)) {
    throw new Error("piper_model_config");
  }
  const session = await InferenceSession.create(await weights.arrayBuffer(), { executionProviders: ["wasm"] });
  voiceSession = { voice, session, config };
  return voiceSession;
}

async function getPhonemizer() {
  phonemizer ??= await createPiperPhonemize({
    locateFile: (name) => name.endsWith(".data") ? phonemeDataUrl : phonemeWasmUrl,
    print: (output) => { phonemeOutput.push(output); },
    // Diagnostics from the phonemizer may include input text.
    printErr: () => {},
  });
  return phonemizer;
}

function toWave(frames: Float32Array[], sampleRate: number): Blob {
  const sampleCount = frames.reduce((size, frame) => size + frame.length, 0);
  if (sampleCount === 0 || sampleCount > sampleRate * 60) throw new Error("piper_audio_length");
  const bytes = new ArrayBuffer(44 + 2 * sampleCount);
  const view = new DataView(bytes);
  view.setUint32(0, 0x52494646);
  view.setUint32(4, bytes.byteLength - 8, true);
  view.setUint32(8, 0x57415645);
  view.setUint32(12, 0x666d7420);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461);
  view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const frame of frames) {
    for (const sample of frame) {
      view.setInt16(offset, Math.max(-32_768, Math.min(32_767, Math.round(sample * 32_768))), true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: "audio/wav" });
}

async function generate({ session, config }: VoiceSession, text: string, rate: number, cancelled: () => boolean) {
  const message = text.trim();
  if (!message || Array.from(message).length > 500 || !Number.isFinite(rate) || rate < 0.5 || rate > 1.5) {
    throw new Error("piper_input");
  }
  const module = await getPhonemizer();
  const output: string[] = [];
  phonemeOutput = output;
  try {
    module.callMain(["-l", config.espeak.voice, "--input", JSON.stringify([{ text: message }]), "--espeak_data", "/espeak-ng-data"]);
  } finally {
    phonemeOutput = [];
  }
  if (!output.length) throw new Error("piper_phonemes");
  const frames: Float32Array[] = [];
  for (const line of output) {
    if (cancelled()) return;
    const { phonemes } = JSON.parse(line) as { phonemes: string[] };
    if (!Array.isArray(phonemes) || !phonemes.length || phonemes.length > 2_000) throw new Error("piper_phonemes");
    const map = config.phoneme_id_map;
    const padding = map["_"];
    // Models can have different alphabets. Piper omits IPA marks the trained
    // model lacks and places a padding token after each recognized phoneme.
    const tokens = [...map["^"], ...padding];
    for (const phoneme of phonemes) {
      if (Object.hasOwn(map, phoneme)) tokens.push(...map[phoneme], ...padding);
    }
    tokens.push(...map["$"]);
    if (!tokens.every((id) => Number.isInteger(id) && id >= 0 && id < config.num_symbols)) {
      throw new Error("piper_tokens");
    }
    const { output: audio } = await session.run({
      input: new Tensor("int64", BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]),
      input_lengths: new Tensor("int64", BigInt64Array.of(BigInt(tokens.length)), [1]),
      scales: new Tensor("float32", Float32Array.of(
        config.inference.noise_scale, config.inference.length_scale / rate, config.inference.noise_w,
      ), [3]),
    });
    if (!(audio.data instanceof Float32Array)) throw new Error("piper_audio");
    frames.push(audio.data);
  }
  if (!cancelled()) return toWave(frames, config.audio.sample_rate);
}

type Job = Exclude<LocalNeuralRequest, { kind: "cancel" }>;
const queued = new Map<number, Job>();
let active: { id: number; cancelled: boolean } | undefined;

async function processNext() {
  if (active) return;
  const job = queued.values().next().value;
  if (!job) return;
  queued.delete(job.id);
  const running = { id: job.id, cancelled: false };
  active = running;
  let stage: "model" | "inference" = "model";
  try {
    const [voice] = await Promise.all([getVoice(job.voice), getPhonemizer()]);
    if (running.cancelled) return;
    stage = "inference";
    const blob = await generate(voice, job.text, job.rate, () => running.cancelled);
    if (blob && !running.cancelled) scope.postMessage({ id: job.id, kind: "audio", blob });
  } catch {
    if (!running.cancelled) scope.postMessage({ id: job.id, kind: "failed", stage });
  } finally {
    active = undefined;
    void processNext();
  }
}

scope.onmessage = ({ data: request }) => {
  if (request.kind === "cancel") {
    queued.delete(request.id);
    if (active?.id === request.id) active.cancelled = true;
  } else if (isLocalNeuralVoice(request.voice)) {
    queued.set(request.id, request);
    void processNext();
  }
};
