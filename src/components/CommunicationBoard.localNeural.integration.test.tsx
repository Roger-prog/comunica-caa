import { useMemo } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunicationBoard } from "./CommunicationBoard";
import { useSpeech } from "../hooks/useSpeech";
import { applyPatientBoard } from "../lib/boardPresentation";
import { DEFAULT_BOARD_SETTINGS, normalizeBoardSettings, type CustomSymbol } from "../lib/patientBoardModel";

const faber = "pt_BR-faber-medium";
const edresson = "pt_BR-edresson-low";
const photoText = "Quero falar com a minha mãe.";
const quickText = "Por favor, faça uma pausa.";
const local = vi.hoisted(() => ({
  synthesize: vi.fn<(text: string, voice: string, rate: number, signal: AbortSignal) => Promise<Blob>>(),
}));

// The application hook, engine, WAV playback and saved-board mapping are real.
// Only the worker inference boundary is simulated. Browser smoke covers the model.
vi.mock("../lib/localNeuralProvider", () => ({ synthesizeLocalNeural: local.synthesize }));
vi.mock("../lib/supabase", () => ({ supabase: null, configurationError: null }));

const parentId = "parent-fixture";
const therapistId = "therapist-fixture";
const patientId = "patient-fixture";
const photoId = "family-photo";
const personalWaterId = "personal-water";
const now = "2026-01-01T00:00:00.000Z";
const savedSymbols: CustomSymbol[] = [
  {
    id: photoId, crianca_id: patientId, label: "Mamãe", speech_text: photoText,
    source: "personalizado", image_path: patientId + "/photo.webp", arasaac_id: null,
    categories: ["pessoas"], hidden: false, version: 1, created_by: parentId,
    created_at: now, updated_at: now,
  },
  {
    id: personalWaterId, crianca_id: patientId, label: "Água teste", speech_text: "Água",
    source: "arasaac", image_path: null, arasaac_id: 2248,
    categories: ["necessidades"], hidden: false, version: 1, created_by: therapistId,
    created_at: now, updated_at: now,
  },
];

const onPlayback = vi.fn<(text: string) => void>();
const onSelect = vi.fn();
const nativeSpeech = new EventTarget();
const nativeSpeak = vi.fn();
const getVoices = vi.fn(() => [{
  voiceURI: "br-fixture", name: "Voz do dispositivo", lang: "pt-BR", localService: true, default: true,
}]);
Object.assign(nativeSpeech, { speak: nativeSpeak, getVoices, cancel: vi.fn() });

class SyntheticUtterance extends EventTarget {
  voice: SpeechSynthesisVoice | null = null;
  constructor(public text: string) { super(); }
}

let audios: StubAudio[] = [];
class StubAudio {
  src = "";
  playbackRate = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  constructor() {
    audios.push(this);
  }
}

// A one-sample PCM WAV lets the test identify the actual object passed for play.
const neuralWav = new Blob([Uint8Array.from([
  82, 73, 70, 70, 38, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
  16, 0, 0, 0, 1, 0, 1, 0, 128, 62, 0, 0, 0, 125, 0, 0,
  2, 0, 16, 0, 100, 97, 116, 97, 2, 0, 0, 0, 0, 0,
])], { type: "audio/wav" });
const createUrl = vi.fn<(blob: Blob | MediaSource) => string>();
const http = vi.fn(() => Promise.reject(new Error("Unexpected request during local speech")));

function settingsFor(voiceURI: string, rate: number) {
  return normalizeBoardSettings({
    ...DEFAULT_BOARD_SETTINGS, voiceURI, rate,
    homeSymbols: ["agua", personalWaterId, photoId],
    quickPhrases: [{ id: "pausa-fixture", label: "Teste de pausa", text: quickText }],
  });
}

function BoardFixture({ voiceURI, rate, scope = patientId }: { voiceURI: string; rate: number; scope?: string }) {
  const settings = useMemo(() => settingsFor(voiceURI, rate), [voiceURI, rate]);
  const speech = useSpeech(undefined, scope);
  const catalog = useMemo(
    () => applyPatientBoard({ settings, settingsVersion: 1, symbols: savedSymbols, overrides: [] }),
    [settings],
  );
  return <CommunicationBoard key={scope} settings={settings} catalog={catalog} speech={speech}
    voiceURI={settings.voiceURI} rate={settings.rate} largeCards={false} onPlayback={onPlayback} onSelect={onSelect} />;
}

function clickButton(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function countPlaybacks() {
  return audios.reduce((sum, audio) => sum + audio.play.mock.calls.length, 0);
}

async function playButton(name: string) {
  const previous = countPlaybacks();
  clickButton(name);
  await waitFor(() => expect(countPlaybacks()).toBe(previous + 1));
  expect(audios.at(-1)?.playbackRate).toBe(1);
  expect(createUrl).toHaveBeenLastCalledWith(neuralWav);
}

beforeEach(() => {
  vi.clearAllMocks();
  audios = [];
  local.synthesize.mockReset().mockResolvedValue(neuralWav);
  createUrl.mockReset().mockReturnValue("blob:local-neural-test");
  const BaseURL = URL;
  vi.stubGlobal("URL", class extends BaseURL {
    static createObjectURL = createUrl;
    static revokeObjectURL = vi.fn();
  });
  vi.stubGlobal("fetch", http);
  vi.stubGlobal("Audio", StubAudio);
  vi.stubGlobal("speechSynthesis", nativeSpeech);
  vi.stubGlobal("SpeechSynthesisUtterance", SyntheticUtterance);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommunicationBoard with local neural synthesis", () => {
  it("uses the same selected local voice for the catalog, both custom sources and sentences", async () => {
    render(<BoardFixture voiceURI={faber} rate={0.8} />);

    await playButton("Falar Água");
    await playButton("Falar Água teste");
    await playButton("Falar Mamãe");
    await playButton("Ouvir frase");

    clickButton("Categorias");
    clickButton("Frases rápidas");
    await playButton("Ouvir: Teste de pausa");

    const utterances = local.synthesize.mock.calls.map(([text, voice, rate]) => [text, voice, rate]);
    expect(utterances).toEqual(expect.arrayContaining([
      ["Água", faber, 0.8],
      [photoText, faber, 0.8],
      ["Água Água " + photoText, faber, 0.8],
      [quickText, faber, 0.8],
    ]));
    expect(utterances.every(([, voice, rate]) => voice === faber && rate === 0.8)).toBe(true);
    expect(onPlayback.mock.calls).toEqual([["Água Água " + photoText], [quickText]]);
    expect(nativeSpeak).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });

  it("applies the rehydrated voice and rate across a patient switch and a fresh mount", async () => {
    const first = render(<BoardFixture voiceURI="" rate={1} />);
    await playButton("Falar Mamãe");
    expect(local.synthesize).toHaveBeenLastCalledWith(photoText, faber, 1, expect.any(AbortSignal));

    first.rerender(<BoardFixture voiceURI={edresson} rate={1.3} scope="second-patient" />);
    await playButton("Falar Água");
    await playButton("Falar Mamãe");
    await playButton("Ouvir frase");
    expect(local.synthesize.mock.calls.map(([text, voice, rate]) => [text, voice, rate])).toEqual(expect.arrayContaining([
      ["Água", edresson, 1.3],
      [photoText, edresson, 1.3],
      ["Água " + photoText, edresson, 1.3],
    ]));

    first.unmount();
    render(<BoardFixture voiceURI={edresson} rate={1.3} scope="second-patient" />);
    await playButton("Falar Mamãe");
    expect(local.synthesize).toHaveBeenLastCalledWith(photoText, edresson, 1.3, expect.any(AbortSignal));
    expect(nativeSpeak).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });

  it("blocks playback of a generated result once the selected patient changes", async () => {
    let completeOld!: (audio: Blob) => void;
    local.synthesize.mockImplementationOnce(() => new Promise((resolve) => { completeOld = resolve; }));
    const view = render(<BoardFixture voiceURI={faber} rate={0.8} />);
    clickButton("Falar Mamãe");
    await waitFor(() => expect(local.synthesize).toHaveBeenCalledWith(photoText, faber, 0.8, expect.any(AbortSignal)));
    const oldRequest = local.synthesize.mock.calls.find(([text]) => text === photoText)!;

    view.rerender(<BoardFixture voiceURI={edresson} rate={1.2} scope="second-patient" />);
    expect(oldRequest[3].aborted).toBe(true);
    await act(async () => completeOld(neuralWav));
    expect(countPlaybacks()).toBe(0);
    await playButton("Falar Mamãe");
    expect(local.synthesize).toHaveBeenLastCalledWith(photoText, edresson, 1.2, expect.any(AbortSignal));
    expect(http).not.toHaveBeenCalled();
  });

  it("offers retry after local inference fails without invoking a browser voice", async () => {
    local.synthesize.mockImplementationOnce(async () => {
      throw new Error("Internal diagnostic with untrusted patient text");
    });
    render(<BoardFixture voiceURI={edresson} rate={1.1} />);
    clickButton("Categorias");
    clickButton("Frases rápidas");
    clickButton("Ouvir: Teste de pausa");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/voz neural/i);
    expect(alert).not.toHaveTextContent("Internal diagnostic");
    expect(nativeSpeak).not.toHaveBeenCalled();
    expect(onPlayback).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /tentar.*novamente/i }));
    await waitFor(() => expect(onPlayback).toHaveBeenCalledExactlyOnceWith(quickText));
    expect(local.synthesize.mock.calls.map(([text, voice, rate]) => [text, voice, rate])).toEqual([
      [quickText, edresson, 1.1], [quickText, edresson, 1.1],
    ]);
    expect(nativeSpeak).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });
});
