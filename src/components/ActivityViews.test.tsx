import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { activityInPeriod, dailyActivity, recentActivityPeriod, summarizeActivity, todayInSaoPaulo } from "../lib/activityEvents";
import type { Comunicacao } from "../lib/database.types";
import { Evolution, History } from "./ActivityViews";

const { fetchEvents, fetchHistory } = vi.hoisted(() => ({ fetchEvents: vi.fn(), fetchHistory: vi.fn() }));
vi.mock("../lib/professional", () => ({
  fetchGuardianPatientEvents: fetchEvents,
  ProfessionalError: class extends Error {},
}));
vi.mock("../lib/history", () => ({ fetchHistoryPage: fetchHistory }));

function dateInPeriod(daysAgo = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}

function event(
  id: string,
  overrides: Partial<Comunicacao> = {},
): Comunicacao {
  return {
    id,
    usuario_id: "guardian",
    crianca_id: "patient",
    pictograma_id: "agua",
    rotulo: "Água",
    categoria: "Necessidades",
    event_type: "symbol_selection",
    symbol_source: "catalog",
    arasaac_id: null,
    created_at: dateInPeriod(),
    ...overrides,
  };
}

const customSelection = () => event("custom", {
  pictograma_id: "custom-photo",
  rotulo: "Água",
  categoria: "Alimentos",
  symbol_source: "custom",
});

const playedMessage = () => event("message", {
  pictograma_id: null,
  rotulo: "Eu quero beber água",
  categoria: null,
  event_type: "message_playback",
  symbol_source: null,
});

describe("History", () => {
  it("uses ARASAAC art for known historical symbols and filters full message text by type", () => {
    const { container } = render(<History events={[event("official"), customSelection(), playedMessage()]} loading={false} onBoard={vi.fn()} />);
    const list = screen.getByRole("region", { name: "Registros de comunicação" });
    expect(container.querySelector('img[src^="/api/arasaac-image?id="]')).toBeInTheDocument();
    expect(within(list).getByText(/Personalizado/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de evento" }), { target: { value: "message_playback" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no histórico" }), { target: { value: "beber agua" } });
    expect(within(list).getByText("Eu quero beber água")).toBeInTheDocument();
    expect(within(list).queryByText("Água")).not.toBeInTheDocument();
  });

  it("retains labels for previous records and deleted custom symbols while a public snapshot stays visible", () => {
    const previous = event("legacy", {
      event_type: "legacy_symbol",
      symbol_source: null,
      pictograma_id: "removed-legacy",
      rotulo: "Símbolo anterior",
    });
    const withPublicImage = event("archived-image", {
      pictograma_id: "removed-custom",
      symbol_source: "custom",
      rotulo: "Imagem escolhida",
      arasaac_id: 2372,
    });
    const { container } = render(<History events={[previous, customSelection(), withPublicImage]} loading={false} onBoard={vi.fn()} />);
    expect(screen.getByText("Símbolo anterior")).toBeInTheDocument();
    expect(screen.getByText(/Registro anterior/)).toBeInTheDocument();
    expect(screen.getByText("Imagem escolhida")).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/arasaac-image?id=2372");
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de evento" }), { target: { value: "symbol_selection" } });
    expect(screen.queryByText("Símbolo anterior")).not.toBeInTheDocument();
  });

  it("applies search, type, periods, and pagination to the selected patient query", async () => {
    const recent = event("recent");
    fetchHistory.mockClear().mockResolvedValue({ events: [], hasOlder: false });
    render(<History events={[]} loading={false} onBoard={vi.fn()} patientId="patient-a" />);
    await waitFor(() => expect(fetchHistory).toHaveBeenLastCalledWith(
      "patient-a", null, "all", "", undefined, expect.any(AbortSignal),
    ));

    const period = screen.getByRole("combobox", { name: "Período do histórico" });
    for (const days of [1, 7, 30, 90]) {
      fireEvent.change(period, { target: { value: String(days) } });
      await waitFor(() => expect(fetchHistory).toHaveBeenLastCalledWith(
        "patient-a", recentActivityPeriod(days), "all", "", undefined, expect.any(AbortSignal),
      ));
    }

    fireEvent.change(period, { target: { value: "custom" } });
    const today = todayInSaoPaulo();
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: today } });
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2020-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("A data inicial deve ser anterior");
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: today } });
    fireEvent.change(screen.getByRole("combobox", { name: "Tipo de evento" }), { target: { value: "symbol_selection" } });
    fetchHistory.mockImplementation((_patient, _dates, _type, _search, cursor) => Promise.resolve(
      cursor ? { events: [event("older", { rotulo: "Suco vermelho" })], hasOlder: false }
        : { events: [recent], hasOlder: true },
    ));
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar no histórico" }), { target: { value: "suco" } });
    fireEvent.click(await screen.findByRole("button", { name: "Carregar registros anteriores" }));
    expect(screen.getByRole("button", { name: "Carregar registros anteriores" })).toBeDisabled();
    expect(await screen.findByText("Suco vermelho")).toBeInTheDocument();
    expect(fetchHistory).toHaveBeenLastCalledWith(
      "patient-a", { from: today, to: today }, "symbol_selection", "suco", recent, expect.any(AbortSignal),
    );
    expect(screen.queryByRole("button", { name: "Carregar registros anteriores" })).not.toBeInTheDocument();
  });
});

describe("Evolution", () => {
  it("counts confirmed selections, full messages, and different IDs when labels match", () => {
    const rows = [
      event("official"),
      customSelection(),
      playedMessage(),
      event("previous", { created_at: dateInPeriod(14) }),
      event("legacy", { event_type: "legacy_symbol", symbol_source: null }),
    ];
    render(<Evolution events={rows} onBoard={vi.fn()} />);
    expect(screen.getByText("Seleções de símbolos").closest("div")).toHaveTextContent("2");
    expect(screen.getByText("Mensagens reproduzidas").closest("div")).toHaveTextContent("1");
    expect(screen.getByText("Símbolos diferentes utilizados").closest("div")).toHaveTextContent("2");
    expect(screen.getByRole("heading", { name: "Uso da prancha por dia" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Período" }), { target: { value: "30" } });
    expect(screen.getByText("Seleções de símbolos").closest("div")).toHaveTextContent("3");
  });

  it("loads the full authenticated range, cancels an old patient request and validates custom periods", async () => {
    let resolveFirst!: (events: Comunicacao[]) => void;
    const first = new Promise<Comunicacao[]>((resolve) => { resolveFirst = resolve; });
    const full = Array.from({ length: 515 }, (_, index) => event(`other-${index}`, { crianca_id: "patient-b" }));
    const recent = [event("recent")];
    fetchEvents.mockClear().mockReturnValueOnce(first).mockResolvedValue(full);
    const onBoard = vi.fn();
    const { rerender } = render(<Evolution patientId="patient-a" events={recent} onBoard={onBoard} />);
    const signal = fetchEvents.mock.calls[0][2] as AbortSignal;
    rerender(<Evolution patientId="patient-b" events={recent} onBoard={onBoard} />);
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByText("Seleções de símbolos").closest("div")).toHaveTextContent("515"));
    await act(async () => resolveFirst([event("old-patient", { rotulo: "Registro de outro paciente" })]));
    expect(screen.queryByText("Registro de outro paciente")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Período" }), { target: { value: "custom" } });
    const today = todayInSaoPaulo();
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: today } });
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("patient-b", { from: today, to: today }, expect.any(AbortSignal)));
    const beforeInvalidRange = fetchEvents.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2020-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("A data inicial deve ser anterior");
    expect(fetchEvents).toHaveBeenCalledTimes(beforeInvalidRange);
  });

  it("groups São Paulo dates at midnight without omitting zero-activity days", () => {
    const period = { from: "2026-11-01", to: "2026-11-03" };
    const rows = [
      event("outside", { created_at: "2026-11-01T02:59:59Z" }),
      event("selection", { created_at: "2026-11-01T03:00:00Z" }),
      { ...playedMessage(), created_at: "2026-11-04T02:59:59Z" },
    ];
    const { byDay } = summarizeActivity(activityInPeriod(rows, period));
    expect(dailyActivity(period, byDay)).toEqual([
      { day: "2026-11-01", selections: 1, messages: 0 },
      { day: "2026-11-02", selections: 0, messages: 0 },
      { day: "2026-11-03", selections: 0, messages: 1 },
    ]);
  });
});
