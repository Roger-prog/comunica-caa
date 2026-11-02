import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comunicacao, Crianca } from "../lib/database.types";
import { ProfessionalError } from "../lib/professional";
import {
  todayInSaoPaulo,
  useProfessionalDashboard,
  validateReportPeriod,
} from "./useProfessionalDashboard";

const service = vi.hoisted(() => ({
  listProfessionalPatients: vi.fn(),
  fetchPatientEvents: vi.fn(),
  redeemInvitation: vi.fn(),
}));
vi.mock("../lib/professional", () => ({
  ...service,
  ProfessionalError: class ProfessionalError extends Error {},
}));

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
function event(patientId = "patient-a", label = "Água"): Comunicacao {
  return {
    id: `${patientId}-${label}`,
    usuario_id: "guardian",
    crianca_id: patientId,
    pictograma_id: "agua",
    rotulo: label,
    categoria: "Necessidades",
    created_at: `${todayInSaoPaulo()}T12:00:00-03:00`,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  service.listProfessionalPatients.mockResolvedValue(patients);
  service.fetchPatientEvents.mockImplementation(async (id: string) => [
    event(id),
  ]);
  service.redeemInvitation.mockResolvedValue(undefined);
});

describe("useProfessionalDashboard", () => {
  it("loads linked patients and only the selected patient's full period", async () => {
    const { result } = renderHook(() =>
      useProfessionalDashboard("professional-a", false),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.selectedPatient?.id).toBe("patient-a");
    expect(service.listProfessionalPatients).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
    expect(service.fetchPatientEvents).toHaveBeenCalledWith(
      "patient-a",
      result.current.period,
      expect.any(AbortSignal),
    );
    expect(
      (Date.parse(result.current.period.to) -
        Date.parse(result.current.period.from)) /
        86_400_000,
    ).toBe(29);
    expect(result.current.eventsLoading).toBe(false);
  });

  it("clears old rows immediately and ignores a slow response for a previous patient", async () => {
    const old = deferred<Comunicacao[]>();
    const next = deferred<Comunicacao[]>();
    service.fetchPatientEvents.mockImplementation((id: string) =>
      id === "patient-a" ? old.promise : next.promise,
    );
    const { result } = renderHook(() =>
      useProfessionalDashboard("professional-a", false),
    );
    await waitFor(() =>
      expect(service.fetchPatientEvents).toHaveBeenCalledTimes(1),
    );
    const oldSignal = service.fetchPatientEvents.mock
      .calls[0][2] as AbortSignal;
    act(() => result.current.setSelectedId("patient-b"));
    expect(result.current.events).toEqual([]);
    expect(result.current.eventsLoading).toBe(true);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => next.resolve([event("patient-b", "Mais")]));
    expect(result.current.events[0].rotulo).toBe("Mais");
    await act(async () => old.resolve([event("patient-a", "Dado antigo")]));
    expect(result.current.events.map((row) => row.rotulo)).toEqual(["Mais"]);
    expect(result.current.selectedPatient?.id).toBe("patient-b");
  });

  it("does not show a previous period while a newer date request is pending", async () => {
    const old = deferred<Comunicacao[]>();
    const latest = deferred<Comunicacao[]>();
    service.fetchPatientEvents
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() =>
      useProfessionalDashboard("professional-a", false),
    );
    await waitFor(() =>
      expect(service.fetchPatientEvents).toHaveBeenCalledTimes(1),
    );
    const day = todayInSaoPaulo();
    act(() => result.current.setPeriod({ from: day, to: day }));
    expect(result.current.events).toEqual([]);
    await act(async () => latest.resolve([event("patient-a", "Período novo")]));
    await act(async () => old.resolve([event("patient-a", "Período antigo")]));
    expect(result.current.events[0].rotulo).toBe("Período novo");
  });

  it("never exposes cached patients or events when the authenticated user changes", async () => {
    const next = deferred<Crianca[]>();
    service.listProfessionalPatients
      .mockResolvedValueOnce([patients[0]])
      .mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(
      ({ userId }) => useProfessionalDashboard(userId, false),
      { initialProps: { userId: "first-user" } },
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    rerender({ userId: "second-user" });
    expect(result.current.patients).toEqual([]);
    expect(result.current.events).toEqual([]);
    await act(async () => next.resolve([patients[1]]));
    await waitFor(() =>
      expect(result.current.selectedPatient?.id).toBe("patient-b"),
    );
    expect(result.current.patients).toEqual([patients[1]]);
  });

  it("preserves leading zeroes, suppresses duplicate redemption and refreshes on success", async () => {
    const pending = deferred<void>();
    service.redeemInvitation.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() =>
      useProfessionalDashboard("professional-a", false),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    let response!: Promise<boolean>;
    act(() => {
      response = result.current.redeem("001234");
    });
    await act(async () => {
      expect(await result.current.redeem("001234")).toBe(false);
    });
    expect(service.redeemInvitation).toHaveBeenCalledExactlyOnceWith("001234");
    expect(result.current.redeeming).toBe(true);
    await act(async () => {
      pending.resolve();
      expect(await response).toBe(true);
    });
    await waitFor(() =>
      expect(service.listProfessionalPatients).toHaveBeenCalledTimes(2),
    );
    expect(result.current.redeemSuccess).toContain("Paciente vinculado");
  });

  it("shows known redemption errors and masks unexpected service diagnostics", async () => {
    service.redeemInvitation
      .mockRejectedValueOnce(
        new ProfessionalError("Convite expirado ou já utilizado."),
      )
      .mockRejectedValueOnce(new Error("private_database_diagnostic"));
    const { result } = renderHook(() =>
      useProfessionalDashboard("professional-a", false),
    );
    await act(async () => {
      await result.current.redeem("123456");
    });
    expect(result.current.redeemError).toBe(
      "Convite expirado ou já utilizado.",
    );
    await act(async () => {
      await result.current.redeem("123456");
    });
    expect(result.current.redeemError).not.toContain("private_database");
    expect(result.current.redeemError).toContain("Não foi possível resgatar");
    const before = service.redeemInvitation.mock.calls.length;
    await act(async () => {
      await result.current.redeem("12345");
    });
    expect(service.redeemInvitation).toHaveBeenCalledTimes(before);
  });

  it("refetches for export and rejects a report if the patient changes during retrieval", async () => {
    const pending = deferred<Comunicacao[]>();
    const { result } = renderHook(() =>
      useProfessionalDashboard("professional-a", false),
    );
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    service.fetchPatientEvents.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const report = result.current
      .reportData(controller.signal)
      .catch((error: unknown) => error);
    expect(service.fetchPatientEvents).toHaveBeenCalledTimes(2);
    act(() => result.current.setSelectedId("patient-b"));
    pending.resolve([event("patient-a")]);
    expect(((await report) as DOMException).name).toBe("AbortError");
  });

  it("uses fictitious preview data without issuing database requests or redeeming invitations", async () => {
    const { result } = renderHook(() => useProfessionalDashboard(null, true));
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.patients).toHaveLength(2);
    await act(async () => {
      expect(await result.current.redeem("123456")).toBe(false);
    });
    const report = await result.current.reportData(
      new AbortController().signal,
    );
    expect(report.events).toHaveLength(2);
    expect(service.listProfessionalPatients).not.toHaveBeenCalled();
    expect(service.fetchPatientEvents).not.toHaveBeenCalled();
    expect(service.redeemInvitation).not.toHaveBeenCalled();
  });

  it("validates the calendar, timezone, ordering and maximum report period", () => {
    expect(todayInSaoPaulo(new Date("2026-11-02T02:30:00Z"))).toBe(
      "2026-11-01",
    );
    expect(
      validateReportPeriod(
        { from: "2026-02-30", to: "2026-03-01" },
        "2026-11-02",
      ),
    ).not.toBeNull();
    expect(
      validateReportPeriod(
        { from: "2026-02-02", to: "2026-02-01" },
        "2026-11-02",
      ),
    ).toContain("anterior");
    expect(
      validateReportPeriod(
        { from: "2019-12-31", to: "2020-01-01" },
        "2026-11-02",
      ),
    ).toContain("2020");
    expect(
      validateReportPeriod(
        { from: "2025-01-01", to: "2026-01-02" },
        "2026-11-02",
      ),
    ).toContain("366");
    expect(
      validateReportPeriod(
        { from: "2026-11-02", to: "2026-11-03" },
        "2026-11-02",
      ),
    ).not.toBeNull();
    expect(
      validateReportPeriod(
        { from: "2026-11-02", to: "2026-11-02" },
        "2026-11-02",
      ),
    ).toBeNull();
  });
});
