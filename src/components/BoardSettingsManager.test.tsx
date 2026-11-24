import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOARD_SETTINGS, normalizeBoardSettings, type CustomSymbol, type PatientBoard } from "../lib/patientBoardModel";
import { BoardSettingsManager } from "./BoardSettingsManager";

const actions = vi.hoisted(() => ({ save: vi.fn(), speak: vi.fn() }));
vi.mock("../lib/patientBoard", () => ({ saveBoardSettings: actions.save }));
vi.mock("../hooks/useSpeech", () => ({
  useSpeech: () => ({
    supported: true, speaking: false, error: null, needsPlaybackGesture: false,
    speak: actions.speak, stop: vi.fn(), retryPlayback: vi.fn(),
  }),
}));

const custom: CustomSymbol = {
  id: "custom-1", crianca_id: "patient-1", created_by: "professional-1",
  label: "Meu cachorro", speech_text: "Quero ver meu cachorro", categories: ["animais"],
  arasaac_id: 42, image_path: null, source: "arasaac", hidden: false, version: 1,
  created_at: "2026-11-16T10:00:00Z", updated_at: "2026-11-16T10:00:00Z",
};
const board: PatientBoard = {
  settings: { ...DEFAULT_BOARD_SETTINGS, homeSymbols: ["agua", "mais"], pageSize: 13 },
  settingsVersion: 3,
  symbols: [custom],
  overrides: [],
};

function switchSection(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function previewOrder() {
  return within(screen.getByRole("region", { name: "Prévia do Início" }))
    .getAllByRole("listitem").map((item) => item.textContent);
}

describe("Preferências da prancha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.save.mockImplementation(async (_id, settings, version) => ({
      settings, version: version + 1,
    }));
  });

  it("separates the four sections and previews the draft voice before saving", async () => {
    const changed = vi.fn();
    render(<BoardSettingsManager data={board} patientId="patient-1" onChange={changed} />);
    expect(screen.getByRole("button", { name: "Aparência" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Cartões por página" })).toHaveValue("13");
    expect(screen.queryByRole("combobox", { name: "Voz da prancha" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Cartões por página" }), { target: { value: "17" } });

    switchSection("Voz");
    fireEvent.change(screen.getByRole("combobox", { name: "Voz da prancha" }), { target: { value: "pt-BR-AntonioNeural" } });
    fireEvent.change(screen.getByRole("slider", { name: /^Velocidade da voz/ }), { target: { value: "1.2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Ouvir o símbolo ao adicioná-lo à frase" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Limite de símbolos por frase" }), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Ouvir prévia da voz" }));
    expect(actions.speak).toHaveBeenCalledWith("Olá", { voiceURI: "pt-BR-AntonioNeural", rate: 1.2, offlineOnly: true });
    expect(actions.save).not.toHaveBeenCalled();

    switchSection("Organização");
    expect(screen.getByRole("combobox", { name: "Categoria a editar" })).toBeVisible();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    switchSection("Favoritos e Início");
    expect(screen.getByRole("region", { name: "Prévia do Início" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Preferências da prancha salvas.");
    expect(actions.save).toHaveBeenCalledWith("patient-1", expect.objectContaining({
      pageSize: 17, voiceURI: "pt-BR-AntonioNeural", rate: 1.2, speakOnSelect: false, maxSentenceSymbols: 60,
    }), 3);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("saves and reloads a stable per-patient local voice choice", async () => {
    const changed = vi.fn();
    const { unmount } = render(<BoardSettingsManager data={board} patientId="patient-1" onChange={changed} />);
    switchSection("Voz");
    fireEvent.change(screen.getByRole("combobox", { name: "Voz da prancha" }), { target: { value: "local-pt-BR" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const settings = normalizeBoardSettings(JSON.parse(JSON.stringify(actions.save.mock.lastCall?.[1])));
    unmount();
    render(<BoardSettingsManager data={{ ...board, settings }} patientId="patient-1" onChange={vi.fn()} />);
    switchSection("Voz");
    expect(screen.getByRole("combobox", { name: "Voz da prancha" })).toHaveValue("local-pt-BR");
  });

  it("saves a chosen ARASAAC category image and allows restoring the default", async () => {
    const lookup = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([
      { id: 7114, labels: ["Gato"] },
    ])));
    try {
      render(<BoardSettingsManager data={board} patientId="patient-1" onChange={vi.fn()} />);
      switchSection("Organização");
      fireEvent.change(screen.getByRole("combobox", { name: "Categoria a editar" }), { target: { value: "animais" } });
      fireEvent.click(screen.getByText("Imagem da categoria"));
      const search = screen.getByRole("searchbox", { name: "Pesquisar pictograma do ARASAAC" });
      fireEvent.change(search, { target: { value: "gato" } });
      fireEvent.keyDown(search, { key: "Enter" });
      fireEvent.click(await screen.findByRole("button", { name: "Gato, pictograma 7114" }));
      fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
      expect(await screen.findByText("Preferências da prancha salvas.")).toBeVisible();
      expect(actions.save).toHaveBeenLastCalledWith("patient-1", expect.objectContaining({ categoryImages: { animais: 7114 } }), 3);
      expect(normalizeBoardSettings({}).categoryImages).toEqual({});
      expect(normalizeBoardSettings({ categoryImages: { animais: 7114, "<invalid>": 3, pessoas: -1 } }).categoryImages)
        .toEqual({ animais: 7114 });

      fireEvent.click(screen.getByRole("button", { name: "Restaurar imagem padrão" }));
      fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
      await waitFor(() => expect(actions.save).toHaveBeenLastCalledWith("patient-1", expect.objectContaining({ categoryImages: {} }), 4));
      expect(await screen.findByText("Preferências da prancha salvas.")).toBeVisible();
    } finally {
      lookup.mockRestore();
    }
  });

  it("pins a custom symbol separately from favorites and saves the previewed order", async () => {
    render(<BoardSettingsManager data={board} patientId="patient-1" onChange={vi.fn()} />);
    switchSection("Favoritos e Início");
    expect(previewOrder()).toEqual(["Água", "Mais"]);
    const pin = screen.getByRole("checkbox", { name: "Mostrar Meu cachorro no Início" });
    const favorite = screen.getByRole("checkbox", { name: "Marcar Meu cachorro como favorito" });
    fireEvent.click(pin);
    expect(favorite).not.toBeChecked();
    fireEvent.change(screen.getByRole("combobox", { name: "Mover símbolo do Início" }), { target: { value: custom.id } });
    fireEvent.click(screen.getByRole("button", { name: "Subir símbolo no Início" }));
    expect(previewOrder()).toEqual(["Água", "Meu cachorro", "Mais"]);
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith("patient-1", expect.objectContaining({
      homeSymbols: ["agua", custom.id, "mais"], favorites: [],
    }), 3));
  });

  it("asks for confirmation before restoring the default home without changing favorites", async () => {
    const customized = { ...board, settings: { ...board.settings, favorites: [custom.id] } };
    render(<BoardSettingsManager data={customized} patientId="patient-1" onChange={vi.fn()} />);
    switchSection("Favoritos e Início");
    const reset = screen.getByRole("button", { name: "Restaurar Início padrão" });
    fireEvent.click(reset);
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(reset).toHaveFocus();
    expect(previewOrder()).toEqual(["Água", "Mais"]);
    fireEvent.click(reset);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar restauração" }));
    expect(previewOrder().length).toBeGreaterThan(2);
    expect(actions.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith("patient-1", expect.objectContaining({
      homeSymbols: null, favorites: [custom.id],
    }), 3));
  });

  it("rejects an unfinished quick phrase and saves it after the two fields are filled", async () => {
    const hidden = vi.fn();
    render(<BoardSettingsManager data={board} patientId="patient-1" onChange={vi.fn()} onShowHiddenSymbols={hidden} />);
    switchSection("Organização");
    fireEvent.click(screen.getByRole("button", { name: "Símbolos ocultos (0)" }));
    expect(hidden).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Frases rápidas" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar frase rápida" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar frases rápidas na prancha" }));
    switchSection("Aparência");
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Preencha o rótulo e o texto falado da frase rápida.");
    expect(actions.save).not.toHaveBeenCalled();

    const phraseLabel = screen.getByRole("textbox", { name: "Rótulo da frase rápida" });
    expect(phraseLabel).toHaveFocus();
    fireEvent.change(phraseLabel, { target: { value: "Minha pausa" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Texto falado da frase rápida" }), { target: { value: "Gostaria de fazer uma pausa." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith("patient-1", expect.objectContaining({
      quickPhrasesEnabled: false,
      quickPhrases: [...DEFAULT_BOARD_SETTINGS.quickPhrases,
        { id: expect.any(String), label: "Minha pausa", text: "Gostaria de fazer uma pausa." }],
    }), 3));
  });

  it("uses the newer preferences on reload and protects a concurrent update from draft overwrite", async () => {
    const changed = vi.fn();
    const { rerender } = render(<BoardSettingsManager data={board} patientId="patient-1" onChange={changed} />);
    const rowCount = screen.getByRole("combobox", { name: "Cartões por linha" });
    fireEvent.change(rowCount, { target: { value: "5" } });
    const newer = { ...board, settingsVersion: 4, settings: { ...board.settings, columns: 6 } };
    rerender(<BoardSettingsManager data={newer} patientId="patient-1" onChange={changed} />);
    expect(rowCount).toHaveValue("5");
    expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Carregar versão atual" }));
    expect(rowCount).toHaveValue("6");
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith("patient-1", expect.objectContaining({ columns: 6 }), 4));
  });
});
