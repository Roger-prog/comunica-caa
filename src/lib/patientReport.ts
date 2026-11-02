import type { jsPDF } from "jspdf";
import type { Comunicacao } from "./database.types";

export type PatientReportPeriod = { from: string; to: string };
export type PatientReportInput = {
  patient: { id: string; nome: string };
  events: readonly Comunicacao[];
  period: PatientReportPeriod;
  generatedAt?: Date;
};

const TIME_ZONE = "America/Sao_Paulo";
const MAX_REPORT_EVENTS = 10_000;
const DAY_MS = 86_400_000;
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const localDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

// Core PDF fonts support Portuguese Latin characters. Pictogram emoji and
// control characters are omitted so they cannot become unreadable PDF glyphs.
function text(value: string): string {
  return value.normalize("NFC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\u00a0-\u00ff]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

function validDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Selecione um período válido.");
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    throw new Error("Selecione um período válido.");
  return time;
}

function validate(input: PatientReportInput) {
  const start = validDay(input.period.from);
  const end = validDay(input.period.to);
  if (input.period.from < "2020-01-01" || start > end || (end - start) / DAY_MS + 1 > 366)
    throw new Error("Selecione um período de até 366 dias, a partir de 2020.");
  const patientName = text(input.patient.nome);
  if (!input.patient.id || !patientName || input.patient.nome.trim().length > 80)
    throw new Error("Os dados do paciente não são válidos para o relatório.");
  if (input.events.length > MAX_REPORT_EVENTS)
    throw new Error("O período contém mais de 10.000 registros. Reduza o período para exportar todos os dados.");
  const generatedAt = input.generatedAt ?? new Date();
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("A data de emissão é inválida.");
  for (const event of input.events) {
    const timestamp = new Date(event.created_at);
    if (event.crianca_id !== input.patient.id || !Number.isFinite(timestamp.getTime()))
      throw new Error("Há registros incompatíveis com o paciente selecionado.");
    const day = localDay.format(timestamp);
    if (day < input.period.from || day > input.period.to)
      throw new Error("Há registros fora do período selecionado. Atualize os dados antes de exportar.");
    if (!text(event.rotulo) || !text(event.categoria))
      throw new Error("Há registros incompletos. Atualize os dados antes de exportar.");
  }
  return { patientName, generatedAt };
}

function displayDay(day: string) {
  return day.split("-").reverse().join("/");
}

export function patientReportFileName(period: PatientReportPeriod): string {
  validDay(period.from);
  validDay(period.to);
  return `comunica-relatorio-${period.from}-a-${period.to}.pdf`;
}

/** Produces the complete selected period; PDF libraries load only on export. */
export async function buildPatientReport(input: PatientReportInput): Promise<jsPDF> {
  const { patientName, generatedAt } = validate(input);
  const [{ jsPDF: Pdf }, { autoTable }] = await Promise.all([
    import("jspdf"), import("jspdf-autotable"),
  ]);
  const doc = new Pdf({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: "Relatório de comunicação", subject: "Registros de utilização da prancha CAA", author: "Comunica - CAA", creator: "Comunica - CAA" });
  doc.setCreationDate(generatedAt);

  const margin = 18;
  const width = doc.internal.pageSize.getWidth();
  const usable = width - margin * 2;
  const purple: [number, number, number] = [105, 70, 152];
  const dark: [number, number, number] = [46, 41, 55];
  const muted: [number, number, number] = [100, 95, 110];
  const period = `${displayDay(input.period.from)} a ${displayDay(input.period.to)}`;
  const events = [...input.events].sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
  );
  const days = new Set(events.map((event) => localDay.format(new Date(event.created_at)))).size;
  const symbols = new Set(events.map((event) => event.pictograma_id)).size;

  function brand() {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...purple);
    doc.text("Comunica - CAA", margin, 21);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...muted);
    doc.text("Relatório de comunicação", margin, 28);
    doc.setDrawColor(225, 217, 235);
    doc.line(margin, 33, width - margin, 33);
  }

  brand();
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text("PACIENTE", margin, 41);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...dark);
  const nameLines = doc.splitTextToSize(patientName, usable) as string[];
  doc.text(nameLines, margin, 47);
  const metadataY = 47 + nameLines.length * 5 + 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text("PERÍODO", margin, metadataY);
  doc.text("EMITIDO EM", width - margin, metadataY, { align: "right" });
  doc.setFontSize(9);
  doc.setTextColor(...dark);
  doc.text(period, margin, metadataY + 5);
  doc.text(dateTime.format(generatedAt), width - margin, metadataY + 5, { align: "right" });
  doc.setFontSize(7.5);
  doc.setTextColor(...muted);
  doc.text("Datas e horários: America/Sao_Paulo (UTC-03:00).", margin, metadataY + 11);

  const summaryY = metadataY + 18;
  const cardWidth = (usable - 8) / 3;
  [
    ["REGISTROS", events.length], ["SÍMBOLOS UTILIZADOS", symbols], ["DIAS COM REGISTROS", days],
  ].forEach(([label, value], index) => {
    const x = margin + index * (cardWidth + 4);
    doc.setFillColor(247, 244, 250);
    doc.roundedRect(x, summaryY, cardWidth, 19, 2, 2, "F");
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text(String(label), x + 4, summaryY + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...purple);
    doc.text(Number(value).toLocaleString("pt-BR"), x + 4, summaryY + 14);
    doc.setFont("helvetica", "normal");
  });

  autoTable(doc, {
    startY: summaryY + 26,
    margin: { left: margin, right: margin, top: 51, bottom: 20 },
    head: [["Data e hora", "Símbolo", "Categoria"]],
    body: events.length
      ? events.map((event) => [dateTime.format(new Date(event.created_at)), text(event.rotulo), text(event.categoria)])
      : [[{ content: "Nenhum registro de comunicação no período selecionado.", colSpan: 3, styles: { halign: "center", textColor: muted, minCellHeight: 18, valign: "middle" } }]],
    theme: "striped",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 3, overflow: "linebreak", textColor: dark, lineColor: [235, 230, 240], lineWidth: 0.1 },
    headStyles: { fillColor: purple, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: [250, 248, 252] },
    columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 80 }, 2: { cellWidth: usable - 122 } },
    rowPageBreak: "avoid",
    showHead: "everyPage",
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    // Add repeated headers after AutoTable has finished so header fonts never
    // interfere with the table's cached text measurements or drawing styles.
    if (page > 1) {
      brand();
      doc.setFontSize(8);
      doc.setTextColor(...dark);
      doc.text(patientName, margin, 40, { maxWidth: usable });
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      doc.text(`Período: ${period}`, margin, 46);
    }
    const height = doc.internal.pageSize.getHeight();
    doc.setDrawColor(225, 217, 235);
    doc.line(margin, height - 16, width - margin, height - 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...muted);
    doc.text("Registros de utilização da prancha de comunicação.", margin, height - 11);
    doc.text(`Página ${page} de ${pages}`, width - margin, height - 11, { align: "right" });
  }
  return doc;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Exportação cancelada.", "AbortError");
}

export async function downloadPatientReport(
  input: PatientReportInput,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  throwIfAborted(options.signal);
  const doc = await buildPatientReport(input);
  throwIfAborted(options.signal);
  doc.save(patientReportFileName(input.period));
}
