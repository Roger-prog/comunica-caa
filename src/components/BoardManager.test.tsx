import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomSymbol, PatientBoard } from "../lib/patientBoardModel";
import { DEFAULT_BOARD_SETTINGS } from "../lib/patientBoardModel";
import { BoardManager } from "./BoardManager";

const actions = vi.hoisted(() => ({
  search: vi.fn(), saveSymbol: vi.fn(), saveSettings: vi.fn(), deleteSymbol: vi.fn(),
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Adicionar aos favoritos" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar símbolo" }));
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
    expect(actions.search).toHaveBeenLastCalledWith("gato", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(actions.saveSymbol).toHaveBeenCalledWith("patient-1", null, expect.objectContaining({
      label: "Meu gato", speechText: "Quero ver meu gato", arasaacId: 123,
    }));
    expect(actions.saveSettings).toHaveBeenCalledWith("patient-1", expect.objectContaining({ favorites: [symbol.id] }), 0);
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
});
