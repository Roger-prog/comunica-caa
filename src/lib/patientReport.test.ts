import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { jsPDF } from "jspdf";
import type { Comunicacao } from "./database.types";
import { buildPatientReport, downloadPatientReport, patientReportFileName, type PatientReportInput } from "./patientReport";

const patient = { id: "patient-example", nome: "Ágata Gonçalves de São José" };
const period = { from: "2026-11-01", to: "2026-11-30" };
const emitted = new Date("2026-11-02T15:30:00.000Z");

function event(index: number, overrides: Partial<Comunicacao> = {}): Comunicacao {
  return {
    id: `event-${String(index).padStart(5, "0")}`,
    usuario_id: "guardian-example", crianca_id: patient.id,
    pictograma_id: index % 2 ? "agua" : "mais",
    rotulo: index % 2 ? "Água" : "Mais", categoria: "Necessidades",
    created_at: new Date(Date.parse("2026-11-01T12:00:00.000Z") + index * 60_000).toISOString(),
    ...overrides,
  };
}

function input(overrides: Partial<PatientReportInput> = {}): PatientReportInput {
  return { patient, period, events: [event(0), event(1)], generatedAt: emitted, ...overrides };
}

// Read actual generated PDF page streams, not jsPDF internal drawing calls.
function content(doc: jsPDF): string {
  const pdf = doc.output();
  return [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    const buffer = Buffer.from(match[1], "latin1");
    try { return inflateSync(buffer).toString("latin1"); }
    catch { return buffer.toString("latin1"); }
  }).join("\n");
}

describe("patientReport", () => {
  it("generates a real PDF with Portuguese text, period, timezone and every selected record", async () => {
    const doc = await buildPatientReport(input());
    expect(doc.output().startsWith("%PDF-")).toBe(true);
    expect(doc.output("arraybuffer").byteLength).toBeGreaterThan(1_000);
    expect(doc.getNumberOfPages()).toBe(1);
    const pdf = content(doc);
    expect(pdf).toContain("Ágata Gonçalves de São José");
    expect(pdf).toContain("01/11/2026 a 30/11/2026");
    expect(pdf).toContain("America/Sao_Paulo");
    expect(pdf).toContain("01/11/2026, 09:00:00");
    expect(pdf).toContain("Água");
    expect(pdf).toContain("Mais");
    expect(pdf).not.toContain(patient.id);
    expect(pdf).not.toContain("guardian-example");
  });

  it("exports the full multipage history with repeated table headings and final record", async () => {
    const events = Array.from({ length: 150 }, (_, index) => event(index, {
      rotulo: index === 149 ? "Ultimo registro confirmado" : `Registro ${index + 1}`,
      categoria: "Atividades de comunicação e necessidades",
    }));
    const doc = await buildPatientReport(input({ events, patient: { ...patient, nome: "Ágata Gonçalves de São José e Albuquerque de Oliveira de Souza dos Santos" } }));
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(2);
    const pdf = content(doc);
    expect(pdf).toContain("Ultimo registro confirmado");
    expect((pdf.match(/Data e hora/g) ?? []).length).toBe(pages);
    expect(pdf).toContain(`Página ${pages} de ${pages}`);
    expect(pdf).toContain("Atividades de");
    expect(events).toHaveLength(150);
  });

  it("creates an explicit empty-period report without invented activity", async () => {
    const doc = await buildPatientReport(input({ events: [] }));
    const pdf = content(doc);
    expect(pdf).toContain("Nenhum registro de comunicação no período selecionado.");
    expect(pdf).toContain("REGISTROS");
    expect(pdf).toContain("DIAS COM REGISTROS");
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it("uses São Paulo dates at period boundaries and does not silently hide rows", async () => {
    await expect(buildPatientReport(input({ events: [event(1, { created_at: "2026-11-01T02:59:59Z" })] }))).rejects.toThrow("fora do período");
    const doc = await buildPatientReport(input({ events: [event(1, { created_at: "2026-12-01T02:59:59Z" })] }));
    expect(content(doc)).toContain("30/11/2026, 23:59:59");
    await expect(buildPatientReport(input({ events: [event(1, { crianca_id: "other-patient" })] }))).rejects.toThrow("incompatíveis");
    await expect(buildPatientReport(input({ events: [event(1, { created_at: "invalid-date" })] }))).rejects.toThrow("incompatíveis");
  });

  it("rejects invalid periods and excessive reports rather than truncating", async () => {
    await expect(buildPatientReport(input({ period: { from: "2026-02-30", to: "2026-03-01" } }))).rejects.toThrow("período válido");
    await expect(buildPatientReport(input({ period: { from: "2026-11-30", to: "2026-11-01" } }))).rejects.toThrow("366 dias");
    await expect(buildPatientReport(input({ period: { from: "2020-01-01", to: "2026-11-01" } }))).rejects.toThrow("366 dias");
    await expect(buildPatientReport(input({ events: Array.from({ length: 10_001 }, () => event(1)) }))).rejects.toThrow("10.000 registros");
  });

  it("keeps the download filename free of patient identifiers and honors cancellation", async () => {
    expect(patientReportFileName(period)).toBe("comunica-relatorio-2026-11-01-a-2026-11-30.pdf");
    const controller = new AbortController();
    controller.abort();
    await expect(downloadPatientReport(input(), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels before save when a view changes while the PDF dependencies load", async () => {
    const controller = new AbortController();
    const pending = downloadPatientReport(input(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
