import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comunicacao, Crianca } from "../lib/database.types";
import { todayInSaoPaulo } from "../hooks/useProfessionalDashboard";
import { ProfessionalDashboard } from "./ProfessionalDashboard";

const service = vi.hoisted(() => ({
  listProfessionalPatients: vi.fn(),
  fetchPatientEvents: vi.fn(),
  redeemInvitation: vi.fn(),
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("../lib/professional", () => ({
  ...service,
  ProfessionalError: class ProfessionalError extends Error {},
}));
vi.mock("../lib/patientReport", () => ({ downloadPatientReport: download }));

const patients: Crianca[] = [
  {
    id: "patient-a",
    usuario_id: "guardian-a",
    nome: "Ana fictícia",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "patient-b",
    usuario_id: "guardian-b",
    nome: "Bruno fictício",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];
function events(patientId = "patient-a", count = 1): Comunicacao[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${patientId}-${index}`,
    usuario_id: "guardian",
    crianca_id: patientId,
    pictograma_id: "agua",
    rotulo: `Água ${index + 1}`,
    categoria: "Necessidades",
    created_at: `${todayInSaoPaulo()}T12:00:00-03:00`,
  }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => {
    resolve = ok;
  });
  return { promise, resolve };
}
async function loaded() {
  await screen.findByRole("heading", { name: "Ana fictícia" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Exportar PDF" })).toBeEnabled(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  service.listProfessionalPatients.mockResolvedValue(patients);
  service.fetchPatientEvents.mockImplementation(async (id: string) =>
    events(id),
  );
  service.redeemInvitation.mockResolvedValue(undefined);
  download.mockResolvedValue(undefined);
});

describe("ProfessionalDashboard", () => {
  it("accepts exactly six digits without losing leading zeroes and clears a successful invitation", async () => {
    render(<ProfessionalDashboard userId="professional-a" preview={false} />);
    await loaded();
    const code = screen.getByRole("textbox", { name: "Código do convite" });
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("maxlength", "6");
    expect(
      screen.getByRole("button", { name: "Vincular paciente" }),
    ).toBeDisabled();
    fireEvent.change(code, { target: { value: "001234" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular paciente" }));
    await screen.findByText("Paciente vinculado. A lista foi atualizada.");
    expect(service.redeemInvitation).toHaveBeenCalledExactlyOnceWith("001234");
    expect(code).toHaveValue("");
    expect(service.listProfessionalPatients).toHaveBeenCalledTimes(2);
  });

  it("paginates the on-screen table while exporting every event from the selected period", async () => {
    service.fetchPatientEvents.mockResolvedValue(events("patient-a", 22));
    render(<ProfessionalDashboard userId="professional-a" preview={false} />);
    await loaded();
    const table = screen.getByRole("table", {
      name: "Comunicações de Ana fictícia",
    });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Exportar PDF" }));
    await screen.findByText("Relatório PDF exportado.");
    expect(service.fetchPatientEvents).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: { id: "patient-a", nome: "Ana fictícia" },
        events: expect.arrayContaining(events("patient-a", 22)),
      }),
      { signal: expect.any(AbortSignal) },
    );
    expect(download.mock.calls[0][0].events).toHaveLength(22);
  });

  it("aborts a pending export when dates change and never downloads the old period", async () => {
    const pending = deferred<Comunicacao[]>();
    render(<ProfessionalDashboard userId="professional-a" preview={false} />);
    await loaded();
    service.fetchPatientEvents.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Exportar PDF" }));
    await screen.findByRole("button", { name: "Preparando PDF…" });
    const signal = service.fetchPatientEvents.mock.calls[1][2] as AbortSignal;
    fireEvent.change(screen.getByLabelText("Data inicial"), {
      target: { value: todayInSaoPaulo() },
    });
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(events()));
    expect(download).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Relatório PDF exportado."),
    ).not.toBeInTheDocument();
  });

  it("propagates cancellation to PDF creation when the selected patient changes", async () => {
    const pending = deferred<void>();
    download.mockReturnValueOnce(pending.promise);
    render(<ProfessionalDashboard userId="professional-a" preview={false} />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Exportar PDF" }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    const signal = download.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Bruno fictício" }));
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve());
    expect(
      screen.queryByText("Relatório PDF exportado."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Bruno fictício" }),
    ).toBeInTheDocument();
  });

  it("blocks export when the history cannot be loaded without exposing diagnostics", async () => {
    service.fetchPatientEvents.mockRejectedValueOnce(
      new Error("private_sql_diagnostic"),
    );
    render(<ProfessionalDashboard userId="professional-a" preview={false} />);
    await screen.findByRole("heading", { name: "Ana fictícia" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar",
    );
    expect(screen.getByRole("button", { name: "Exportar PDF" })).toBeDisabled();
    expect(screen.queryByText(/private_sql/)).not.toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it("does not query or export an invalid calendar range", async () => {
    render(<ProfessionalDashboard userId="professional-a" preview={false} />);
    await loaded();
    const before = service.fetchPatientEvents.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Data inicial"), {
      target: { value: "2019-01-01" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("2020");
    expect(screen.getByRole("button", { name: "Exportar PDF" })).toBeDisabled();
    expect(service.fetchPatientEvents).toHaveBeenCalledTimes(before);
  });

  it("offers fictitious preview patients and a PDF without database access", async () => {
    render(<ProfessionalDashboard userId={null} preview />);
    await screen.findByRole("heading", { name: "Ana (demonstração)" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Exportar PDF" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("textbox", { name: "Código do convite" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Vincular paciente" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Exportar PDF" }));
    await screen.findByText("Relatório PDF exportado.");
    expect(download.mock.calls[0][0].events).toHaveLength(2);
    expect(service.listProfessionalPatients).not.toHaveBeenCalled();
    expect(service.fetchPatientEvents).not.toHaveBeenCalled();
    expect(service.redeemInvitation).not.toHaveBeenCalled();
  });
});
