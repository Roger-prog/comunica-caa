import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomSymbol, PatientBoard } from "../lib/patientBoardModel";
import { DEFAULT_BOARD_SETTINGS } from "../lib/patientBoardModel";
import { BoardManager } from "./BoardManager";
import { DEFAULT_HOME_SYMBOL_IDS } from "../data/pictograms";

const actions = vi.hoisted(() => ({
  search: vi.fn(), saveSymbol: vi.fn(), saveSettings: vi.fn(), deleteSymbol: vi.fn(), saveOverride: vi.fn(),
}));

vi.mock("../lib/arasaac", () => ({
  getArasaacImageUrl: (id: number) => `/api/arasaac-image?id=${id}`,
  getArasaacPublicTerms: () => ["gato"],
  searchArasaac: actions.search,
}));

vi.mock("../lib/patientBoard", async (original) => ({
  ...await original<typeof import("../lib/patientBoard")>(),
  saveCustomSymbol: actions.saveSymbol,
  saveBoardSettings: actions.saveSettings,
  deleteCustomSymbol: actions.deleteSymbol,
  saveCatalogOverride: actions.saveOverride,
}));

const symbol: CustomSymbol = {
  id: "symbol-1", crianca_id: "patient-1", created_by: "guardian-1", label: "Meu gato",
  speech_text: "Quero ver meu gato", categories: ["animais"], arasaac_id: 123,
  image_path: null, source: "arasaac", hidden: false, version: 1,
  created_at: "2026-11-16T10:00:00Z", updated_at: "2026-11-16T10:00:00Z",
};
const empty: PatientBoard = { settings: DEFAULT_BOARD_SETTINGS, settingsVersion: 0, symbols: [], overrides: [] };

function openBoard(data: PatientBoard, canDeleteAny = false) {
  const updated = vi.fn();
  render(<BoardManager patientId="patient-1" patientName="Perfil de teste" userId="professional-1" canDeleteAny={canDeleteAny} data={data} onChange={updated} />);
  return updated;
}

describe("Gerenciador da prancha", () => {
  beforeEach(() => vi.resetAllMocks());

  it("pede escolha manual após uma falha do catálogo e mantém a legenda privada na criação", async () => {
    actions.search.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ id: 123, labels: ["gato"], imageUrl: "/api/arasaac-image?id=123" }]);
    actions.saveSymbol.mockResolvedValue({ symbol, cleanupPending: false });
    actions.saveSettings.mockResolvedValue({ version: 1 });
    const updated = openBoard(empty);
    fireEvent.click(screen.getByRole("button", { name: "Criar símbolo" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nome do símbolo" }), { target: { value: "Meu gato" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Frase falada" }), { target: { value: "Quero ver meu gato" } });
    fireEvent.click(screen.getByRole("button", { name: "Escolher pictograma ARASAAC" }));
    fireEvent.click(screen.getByRole("button", { name: "gato" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível consultar/i);
    fireEvent.click(screen.getByRole("button", { name: "gato" }));
    const choice = await screen.findByRole("button", { name: "gato, pictograma 123" });
    expect(choice).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(choice);
    expect(within(screen.getByRole("group", { name: "Prévia do símbolo" })).getByRole("img"))
      .toHaveAttribute("src", "/api/arasaac-image?id=123");
    fireEvent.change(screen.getByRole("combobox", { name: "Adicionar categoria" }), { target: { value: "animais" } });
    expect(within(screen.getByRole("list", { name: "Categorias selecionadas" })).getByText("Animais")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Adicionar aos favoritos" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar no Início" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar símbolo" }));
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
    expect(actions.search).toHaveBeenLastCalledWith("gato", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(actions.saveSymbol).toHaveBeenCalledWith("patient-1", null, expect.objectContaining({
      label: "Meu gato", speechText: "Quero ver meu gato", arasaacId: 123, categories: expect.arrayContaining(["animais"]),
    }));
    expect(actions.saveSettings).toHaveBeenCalledWith("patient-1", expect.objectContaining({
      favorites: [symbol.id],
      homeSymbols: [...DEFAULT_HOME_SYMBOL_IDS, symbol.id],
    }), 0);
    expect(screen.getByText("Símbolo criado.")).toBeInTheDocument();
  });

  it("permite ocultar símbolos compartilhados e impede que outro profissional os exclua", async () => {
    actions.saveSymbol.mockResolvedValue({ symbol: { ...symbol, hidden: true }, cleanupPending: false });
    const updated = openBoard({ ...empty, symbols: [symbol] });
    expect(screen.queryByRole("button", { name: "Excluir Meu gato" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar Meu gato" }));
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
    expect(actions.saveSymbol).toHaveBeenCalledWith("patient-1", symbol, expect.objectContaining({ hidden: true, arasaacId: 123 }));
  });

  it("pede confirmação antes de excluir e informa uma remoção de foto pendente", async () => {
    actions.deleteSymbol.mockResolvedValue({ cleanupPending: true });
    openBoard({ ...empty, symbols: [symbol] }, true);
    fireEvent.click(screen.getByRole("button", { name: "Excluir Meu gato" }));
    expect(actions.deleteSymbol).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: "Confirmar exclusão de Meu gato" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar exclusão" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Símbolo excluído. A remoção da foto ficou pendente.");
    expect(actions.deleteSymbol).toHaveBeenCalledExactlyOnceWith("patient-1", symbol);
  });

  it("separa palavras pendentes das associadas e salva apenas a troca de imagem do paciente", async () => {
    actions.search.mockResolvedValue([
      { id: 123, labels: ["Água"], imageUrl: "/api/arasaac-image?id=123" },
      { id: 456, labels: ["Copo de água"], imageUrl: "/api/arasaac-image?id=456" },
    ]);
    actions.saveOverride.mockResolvedValue(undefined);
    const updated = openBoard(empty);
    fireEvent.click(screen.getByRole("button", { name: "Revisar catálogo" }));
    const word = screen.getByRole("combobox", { name: "Palavra a revisar" });
    fireEvent.change(screen.getByRole("combobox", { name: "Situação do pictograma" }), { target: { value: "pending" } });
    expect(within(word).getByRole("option", { name: /A · Conectores · Aguardando revisão/ })).toBeInTheDocument();
    expect(within(word).queryByRole("option", { name: /^Água · Necessidades/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Situação do pictograma" }), { target: { value: "associated" } });
    expect(within(word).getByRole("option", { name: /^Água · Necessidades · Pictograma do catálogo geral/ })).toBeInTheDocument();
    fireEvent.change(word, { target: { value: "agua" } });
    const current = screen.getByRole("group", { name: "Imagem atual" });
    expect(within(current).getByRole("img")).toHaveAttribute("src", "/api/arasaac-image?id=2248");
    expect(screen.getByRole("button", { name: "Salvar nesta prancha" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "gato" }));
    expect(await screen.findByRole("button", { name: "Água, pictograma 123" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copo de água, pictograma 456" }));
    const preview = screen.getByRole("group", { name: "Prévia da nova imagem" });
    expect(within(preview).getByRole("img")).toHaveAttribute("src", "/api/arasaac-image?id=456");
    expect(within(preview).getByText("Água")).toBeInTheDocument();
    expect(screen.getByText("Necessidades", { selector: "dd" })).toBeInTheDocument();
    expect(actions.saveOverride).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Salvar nesta prancha" }));
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
    expect(actions.saveOverride).toHaveBeenCalledExactlyOnceWith("patient-1", "agua", 456);
    expect(screen.getByText("Pictograma atualizado nesta prancha.")).toHaveAttribute("role", "status");
  });

  it("permite criar pela revisão do catálogo e descarta o formulário ao trocar de paciente", () => {
    const board = (patientId: string, patientName: string) =>
      <BoardManager patientId={patientId} patientName={patientName} data={empty} userId="guardian-1" onChange={() => {}} />;
    const view = render(board("patient-1", "Perfil A"));
    fireEvent.click(screen.getByRole("button", { name: "Revisar catálogo" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar símbolo" }));
    const form = screen.getByRole("form", { name: "Criar símbolo" });
    fireEvent.change(within(form).getByRole("textbox", { name: "Nome do símbolo" }), { target: { value: "Símbolo do perfil A" } });
    view.rerender(board("patient-2", "Perfil B"));
    expect(screen.queryByRole("form", { name: "Criar símbolo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Criar símbolo" }));
    expect(screen.getByRole("textbox", { name: "Nome do símbolo" })).toHaveValue("");
    expect(screen.getByRole("form", { name: "Criar símbolo" })).toHaveTextContent("Perfil B");
  });
});
