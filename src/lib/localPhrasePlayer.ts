export interface LocalPhraseClip {
  key: string;
  blob: Blob;
}

interface PCMClip {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

interface ClipEntry {
  promise: Promise<PCMClip>;
  pcm?: PCMClip;
}

interface DecodeJob {
  clip: LocalPhraseClip;
  entry: ClipEntry;
  resolve: (pcm: PCMClip) => void;
  reject: (error: unknown) => void;
}

interface DecoderState {
  context: AudioContext | null;
  active: number;
  queue: DecodeJob[];
}

const MAX_CLIPS = 64;
const MAX_PCM_BYTES = 16 * 1024 * 1024;
const MAX_PHRASES = 16;
const MAX_PHRASE_BYTES = 8 * 1024 * 1024;
const MAX_WAV_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_SEGMENTS = 12;
const GAP_SECONDS = 0.025;

function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("local_audio_read_failed"));
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error("local_audio_read_failed"));
    reader.readAsArrayBuffer(blob);
  });
}

function trim(buffer: AudioBuffer): PCMClip {
  if (!buffer.length || !buffer.numberOfChannels || buffer.numberOfChannels > 2 ||
      !Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0 ||
      buffer.length / buffer.sampleRate > 10) {
    throw new Error("invalid_local_audio");
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const audible = (index: number) => channels.some((channel) => Math.abs(channel[index]) >= 0.002);
  let start = 0;
  let end = buffer.length;
  while (start < end && !audible(start)) start++;
  while (end > start && !audible(end - 1)) end--;
  if (start === end) throw new Error("silent_local_audio");
  start = Math.max(0, start - Math.round(buffer.sampleRate * 0.012));
  end = Math.min(buffer.length, end + Math.round(buffer.sampleRate * 0.035));
  const samples = new Float32Array(end - start);
  for (let frame = start; frame < end; frame++) {
    let sum = 0;
    for (const channel of channels) sum += channel[frame];
    samples[frame - start] = sum / channels.length;
  }
  return { samples, sampleRate: buffer.sampleRate };
}

function wave(clips: readonly PCMClip[]): Blob {
  const sampleRate = clips[0].sampleRate;
  if (clips.some((clip) => clip.sampleRate !== sampleRate)) throw new Error("local_audio_rate_mismatch");
  const gap = Math.round(sampleRate * GAP_SECONDS);
  const frames = clips.reduce((sum, clip) => sum + clip.samples.length, 0) + gap * (clips.length - 1);
  const length = 44 + frames * 2;
  if (frames / sampleRate > 30 || length > MAX_WAV_BYTES) throw new Error("local_phrase_too_large");
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  let offset = 44;
  for (let index = 0; index < clips.length; index++) {
    for (const sample of clips[index].samples) {
      const bounded = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
      view.setInt16(offset, Math.round(bounded * (bounded < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
    if (index < clips.length - 1) offset += gap * 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Decodes public vocabulary and assembles bounded, session-local WAV phrases. */
export function createLocalPhraseCache() {
  const Context = typeof window === "undefined" ? undefined :
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const supported = Boolean(Context && typeof Blob === "function");
  let state: DecoderState = { context: null, active: 0, queue: [] };
  let pcmBytes = 0;
  let phraseBytes = 0;
  const decoded = new Map<string, ClipEntry>();
  const phrases = new Map<string, Blob>();
  const building = new Map<string, Promise<Blob>>();

  function valid(clips: readonly LocalPhraseClip[]) {
    return clips.length > 0 && clips.length <= MAX_SEGMENTS && clips.every((clip) =>
      typeof clip.key === "string" && clip.key.length > 0 && clip.key.length <= 2048 &&
      clip.blob.size > 0 && clip.blob.size <= MAX_INPUT_BYTES);
  }

  const signature = (clips: readonly LocalPhraseClip[]) => JSON.stringify(clips.map((clip) => clip.key));

  function discardDecoded(key: string) {
    const entry = decoded.get(key);
    if (entry?.pcm) pcmBytes -= entry.pcm.samples.byteLength;
    decoded.delete(key);
  }

  function pump(owner: DecoderState) {
    if (owner !== state) return;
    while (owner.active < 2 && owner.queue.length) {
      const job = owner.queue.shift()!;
      owner.active++;
      void (async () => {
        try {
          if (!Context) throw new Error("local_audio_unsupported");
          if (!owner.context) {
            try { owner.context = new Context({ sampleRate: 24000 }); }
            catch { owner.context = new Context(); }
          }
          const pcm = trim(await owner.context.decodeAudioData(await bytesOf(job.clip.blob)));
          if (owner !== state) throw new Error("local_audio_canceled");
          if (decoded.get(job.clip.key) === job.entry) {
            job.entry.pcm = pcm;
            pcmBytes += pcm.samples.byteLength;
            while (pcmBytes > MAX_PCM_BYTES) {
              const oldest = [...decoded].find(([, entry]) => entry.pcm);
              if (!oldest) break;
              discardDecoded(oldest[0]);
            }
          }
          job.resolve(pcm);
        } catch (error) {
          if (decoded.get(job.clip.key) === job.entry) discardDecoded(job.clip.key);
          job.reject(error);
        } finally {
          owner.active--;
          pump(owner);
        }
      })();
    }
  }

  function decode(clip: LocalPhraseClip): Promise<PCMClip> {
    const existing = decoded.get(clip.key);
    if (existing) {
      decoded.delete(clip.key);
      decoded.set(clip.key, existing);
      return existing.promise;
    }
    if (decoded.size >= MAX_CLIPS) {
      const oldest = [...decoded].find(([, entry]) => entry.pcm);
      if (!oldest) return Promise.reject(new Error("local_audio_busy"));
      discardDecoded(oldest[0]);
    }
    let resolve!: DecodeJob["resolve"];
    let reject!: DecodeJob["reject"];
    const entry: ClipEntry = { promise: new Promise((ok, fail) => { resolve = ok; reject = fail; }) };
    decoded.set(clip.key, entry);
    state.queue.push({ clip, entry, resolve, reject });
    pump(state);
    return entry.promise;
  }

  function get(clips: readonly LocalPhraseClip[]): Blob | undefined {
    if (!valid(clips)) return;
    const key = signature(clips);
    const existing = phrases.get(key);
    if (!existing) return;
    phrases.delete(key);
    phrases.set(key, existing);
    return existing;
  }

  function prepare(clips: readonly LocalPhraseClip[]): Promise<Blob> {
    if (!supported || !valid(clips)) return Promise.reject(new Error("invalid_local_phrase"));
    const existing = get(clips);
    if (existing) return Promise.resolve(existing);
    const key = signature(clips);
    const pending = building.get(key);
    if (pending) return pending;
    if (building.size >= MAX_CLIPS) return Promise.reject(new Error("local_audio_busy"));
    const owner = state;
    const result = Promise.all(clips.map(decode)).then((buffers) => {
      if (owner !== state) throw new Error("local_audio_canceled");
      const blob = wave(buffers);
      phrases.set(key, blob);
      phraseBytes += blob.size;
      while (phrases.size > MAX_PHRASES || phraseBytes > MAX_PHRASE_BYTES) {
        const oldest = phrases.keys().next().value!;
        phraseBytes -= phrases.get(oldest)!.size;
        phrases.delete(oldest);
      }
      return blob;
    }).finally(() => {
      if (building.get(key) === result) building.delete(key);
    });
    building.set(key, result);
    return result;
  }

  function clear() {
    const previous = state;
    state = { context: null, active: 0, queue: [] };
    for (const job of previous.queue.splice(0)) job.reject(new Error("local_audio_canceled"));
    if (previous.context) {
      try { void previous.context.close().catch(() => {}); } catch { /* Already closed. */ }
    }
    decoded.clear();
    phrases.clear();
    building.clear();
    pcmBytes = 0;
    phraseBytes = 0;
  }

  return { supported, get, prepare, clear };
}
