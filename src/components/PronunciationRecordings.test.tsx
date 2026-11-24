import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteRecording, fetchRecordingAudio, getRecordingSettings, listRecordingNotes, listRecordings,
  loadRecordingAccess, saveRecording, saveRecordingNote, type Recording,
} from "../lib/pronunciation";
import { PronunciationRecordings } from "./PronunciationRecordings";

vi.mock("../lib/pronunciation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/pronunciation")>();
  return {
    ...original,
    deleteRecording: vi.fn(),
    fetchRecordingAudio: vi.fn(),
    getRecordingSettings: vi.fn(),
    listRecordingNotes: vi.fn(),
    listRecordings: vi.fn(),
    loadRecordingAccess: vi.fn(),
    saveRecording: vi.fn(),
    saveRecordingNote: vi.fn(),
  };
});

class TestRecorder {
  static isTypeSupported = () => true;
  readonly mimeType = "audio/webm;codecs=opus";
  state = "inactive";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;

  constructor(readonly stream: MediaStream) {}

  start() { this.state = "recording"; }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["synthetic-test-clip"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const owner = { can_read: true, can_record: true, can_manage: true, retention_days: 90 };
const professional = { can_read: true, can_record: false, can_manage: false, retention_days: 90 };
const record: Recording = {
  id: "recording-1", created_at: "2026-11-05T15:00:00Z", expires_at: "2027-02-03T15:00:00Z",
  practice: "Água", can_delete: true, can_observe: false,
};
let getUserMedia: ReturnType<typeof vi.fn>;
let trackStop: ReturnType<typeof vi.fn>;
let stream: MediaStream;
let revoke: (url: string) => void;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getRecordingSettings).mockResolvedValue(owner);
  vi.mocked(loadRecordingAccess).mockResolvedValue([]);
  vi.mocked(listRecordings).mockResolvedValue({ items: [], hasOlder: false });
  trackStop = vi.fn();
  stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
  getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal("MediaRecorder", TestRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL() { return "blob:synthetic-clip"; }
    static revokeObjectURL(url: string) { revoke(url); }
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("voice recordings", () => {
  it("requires the guardian's choice before recording, plays the draft, and saves it for this patient", async () => {
    const { container } = render(<PronunciationRecordings patientId="patient-1" />);
    const start = await screen.findByRole("button", { name: "Gravar pronúncia" });
    expect(start).toBeDisabled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(start).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "Palavra ou frase para praticar" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Autorizo gravar e salvar/ }));
    fireEvent.click(start);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(await screen.findByText("Gravando.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Parar gravação" }));
    expect(await screen.findByText("Gravação finalizada.")).toBeInTheDocument();
    expect(trackStop).toHaveBeenCalledOnce();
    const preview = container.querySelector("audio");
    expect(preview).toHaveAttribute("aria-label", "Prévia da gravação de pronúncia");
    fireEvent.play(preview!);
    expect(screen.getByText("Reproduzindo.")).toBeInTheDocument();
    vi.mocked(listRecordings).mockResolvedValue({ items: [record], hasOlder: false });
    fireEvent.click(screen.getByRole("button", { name: "Salvar gravação" }));
    expect(await screen.findByText("Gravação salva.")).toBeInTheDocument();
    expect(saveRecording).toHaveBeenCalledWith("patient-1", expect.objectContaining({ practice: "Gravação de pronúncia", audio: expect.any(Blob) }), true);
    expect(await screen.findByText("Água")).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith("blob:synthetic-clip");
  });

  it("recovers from a microphone denial and allows a local draft to be repeated or discarded", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    render(<PronunciationRecordings preview />);
    expect(screen.getByText("Grave uma palavra para escutar e analisar a pronúncia. O áudio fica neste dispositivo até você sair desta tela.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gravar pronúncia" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Erro no microfone");
    expect(screen.getByRole("button", { name: "Gravar pronúncia" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Gravar pronúncia" }));
    fireEvent.click(await screen.findByRole("button", { name: "Parar gravação" }));
    fireEvent.click(screen.getByRole("button", { name: "Gravar novamente" }));
    fireEvent.click(await screen.findByRole("button", { name: "Parar gravação" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar áudio" }));
    expect(screen.getByText("Gravação descartada.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar gravação" })).not.toBeInTheDocument();
    expect(saveRecording).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledTimes(2);
  });

  it("releases even a microphone granted after the patient view is closed", async () => {
    let grant!: (value: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const { unmount } = render(<PronunciationRecordings preview />);
    fireEvent.click(screen.getByRole("button", { name: "Gravar pronúncia" }));
    await screen.findByText("Aguardando permissão do microfone…");
    unmount();
    await act(async () => grant(stream));
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it("stops capture when the browser moves the page to the background", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    render(<PronunciationRecordings preview />);
    fireEvent.click(screen.getByRole("button", { name: "Gravar pronúncia" }));
    await screen.findByText("Gravando.");
    hidden.mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByText("Gravação finalizada.")).toBeInTheDocument();
    expect(trackStop).toHaveBeenCalledOnce();
  });

  it("lets an authorized professional load audio on demand and save a manual observation", async () => {
    vi.mocked(getRecordingSettings).mockResolvedValue(professional);
    vi.mocked(listRecordings).mockResolvedValue({ items: [{ ...record, can_delete: false, can_observe: true }], hasOlder: false });
    vi.mocked(fetchRecordingAudio).mockResolvedValue(new Blob(["synthetic"], { type: "audio/webm" }));
    vi.mocked(listRecordingNotes).mockResolvedValueOnce([]).mockResolvedValue([{
      id: "note-1", author_name: "Profissional", updated_at: record.created_at, own: true,
      observation: "Observação de teste",
    }]);
    const { container } = render(<PronunciationRecordings patientId="patient-1" />);
    expect(await screen.findByText("05/11/2026, 12:00")).toBeInTheDocument();
    expect(fetchRecordingAudio).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Gravar pronúncia" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir gravação" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir áudio e observações" }));
    expect(fetchRecordingAudio).toHaveBeenCalledWith(record.id, expect.any(AbortSignal));
    const observation = await screen.findByRole("textbox", { name: "Sua observação profissional" });
    await waitFor(() => expect(container.querySelector("audio")).toHaveAttribute("src", "blob:synthetic-clip"));
    fireEvent.change(observation, { target: { value: "Observação de teste" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar observação" }));
    expect(saveRecordingNote).toHaveBeenCalledWith(record.id, "Observação de teste");
    await waitFor(() => expect(screen.getByText("Observação de teste", { selector: "p" })).toBeInTheDocument());
  });

  it("requires a separate decision before deleting a saved recording", async () => {
    vi.mocked(listRecordings).mockResolvedValueOnce({ items: [record], hasOlder: false }).mockResolvedValue({ items: [], hasOlder: false });
    render(<PronunciationRecordings patientId="patient-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Excluir gravação" }));
    expect(deleteRecording).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: "Confirmar exclusão da gravação" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar exclusão" }));
    expect(deleteRecording).toHaveBeenCalledWith(record.id);
    expect(await screen.findByText("Gravação excluída.")).toBeInTheDocument();
    expect(await screen.findByText("Nenhuma gravação neste perfil.")).toBeInTheDocument();
  });
});
