import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Comunicacao, Crianca } from "../lib/database.types";
import {
  fetchPatientEvents,
  listProfessionalPatients,
  ProfessionalError,
  redeemInvitation,
} from "../lib/professional";

export type ReportPeriod = { from: string; to: string };

export function todayInSaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function initialPeriod(): ReportPeriod {
  const to = todayInSaoPaulo();
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to };
}

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return null;
  return date.getTime();
}

export function validateReportPeriod(
  period: ReportPeriod,
  today = todayInSaoPaulo(),
): string | null {
  const from = dateValue(period.from);
  const to = dateValue(period.to);
  if (from === null || to === null)
    return "Informe as datas inicial e final do período.";
  if (period.from < "2020-01-01" || period.to > today)
    return "Escolha datas entre 01/01/2020 e hoje.";
  if (from > to)
    return "A data inicial deve ser anterior ou igual à data final.";
  if ((to - from) / 86_400_000 + 1 > 366)
    return "Escolha um período de até 366 dias.";
  return null;
}

const demoPatients: Crianca[] = [
  {
    id: "professional-demo-ana",
    usuario_id: "demo-guardian",
    nome: "Ana (demonstração)",
    created_at: "2026-01-01T12:00:00Z",
    updated_at: "2026-01-01T12:00:00Z",
  },
  {
    id: "professional-demo-bruno",
    usuario_id: "demo-guardian",
    nome: "Bruno (demonstração)",
    created_at: "2026-01-01T12:00:00Z",
    updated_at: "2026-01-01T12:00:00Z",
  },
];

function demoEvents(patientId: string, period: ReportPeriod): Comunicacao[] {
  const day = todayInSaoPaulo();
  if (day < period.from || day > period.to) return [];
  return [
    {
      id: `${patientId}-water`,
      usuario_id: "demo-guardian",
      crianca_id: patientId,
      pictograma_id: "agua",
      rotulo: "Água",
      categoria: "Necessidades",
      created_at: `${day}T14:30:00-03:00`,
    },
    {
      id: `${patientId}-more`,
      usuario_id: "demo-guardian",
      crianca_id: patientId,
      pictograma_id: "mais",
      rotulo: "Mais",
      categoria: "Conversar",
      created_at: `${day}T10:15:00-03:00`,
    },
  ];
}

const unavailable =
  "Não foi possível acessar os pacientes. Verifique sua conexão e tente novamente.";
const eventFailure =
  "Não foi possível carregar as comunicações do período. Tente novamente.";
const sanitized = (error: unknown, fallback: string) =>
  error instanceof ProfessionalError ? error.message : fallback;

export function useProfessionalDashboard(
  userId: string | null,
  preview: boolean,
) {
  const owner = preview ? "preview" : `user:${userId ?? "none"}`;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const [period, setPeriod] = useState<ReportPeriod>(initialPeriod);
  const [selectedId, setSelectedId] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [patientsState, setPatientsState] = useState<{
    owner: string;
    rows: Crianca[];
    loading: boolean;
    error: string | null;
  }>({ owner, rows: [], loading: true, error: null });
  const [eventState, setEventState] = useState<{
    key: string;
    rows: Comunicacao[];
    loading: boolean;
    error: string | null;
  }>({ key: "", rows: [], loading: false, error: null });
  const [redeemState, setRedeemState] = useState<{
    owner: string;
    pending: boolean;
    error: string | null;
    success: string | null;
  }>({ owner, pending: false, error: null, success: null });
  const redeemFlight = useRef<symbol | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patients = patientsState.owner === owner ? patientsState.rows : [];
  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedId) ?? null,
    [patients, selectedId],
  );
  const periodError = validateReportPeriod(period);
  const contextKey = JSON.stringify([
    owner,
    selectedPatient?.id ?? "",
    period.from,
    period.to,
  ]);
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setPatientsState({ owner, rows: [], loading: true, error: null });
    if (!preview && !userId) {
      setPatientsState({
        owner,
        rows: [],
        loading: false,
        error: "Entre na sua conta para acessar os pacientes vinculados.",
      });
      return () => {
        active = false;
        controller.abort();
      };
    }
    void (
      preview
        ? Promise.resolve(demoPatients)
        : listProfessionalPatients(controller.signal)
    )
      .then((rows) => {
        if (!active || currentOwner.current !== owner) return;
        setPatientsState({ owner, rows, loading: false, error: null });
        setSelectedId((current) =>
          rows.some((patient) => patient.id === current)
            ? current
            : (rows[0]?.id ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (active && currentOwner.current === owner)
          setPatientsState({
            owner,
            rows: [],
            loading: false,
            error: sanitized(error, unavailable),
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [owner, preview, userId, reloadVersion]);

  useEffect(() => {
    if (!selectedPatient || periodError) return;
    const controller = new AbortController();
    let active = true;
    const patientId = selectedPatient.id;
    setEventState({ key: contextKey, rows: [], loading: true, error: null });
    void (
      preview
        ? Promise.resolve(demoEvents(patientId, period))
        : fetchPatientEvents(patientId, period, controller.signal)
    )
      .then((rows) => {
        if (active && currentContext.current === contextKey)
          setEventState({ key: contextKey, rows, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (active && currentContext.current === contextKey)
          setEventState({
            key: contextKey,
            rows: [],
            loading: false,
            error: sanitized(error, eventFailure),
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    contextKey,
    selectedPatient?.id,
    period.from,
    period.to,
    periodError,
    preview,
    reloadVersion,
  ]);

  const redeem = useCallback(
    async (code: string): Promise<boolean> => {
      if (redeemFlight.current) return false;
      if (preview || !userId) {
        setRedeemState({
          owner,
          pending: false,
          error: "Entre na sua conta para vincular um paciente.",
          success: null,
        });
        return false;
      }
      if (!/^\d{6}$/.test(code)) {
        setRedeemState({
          owner,
          pending: false,
          error: "Informe o código com seis dígitos numéricos.",
          success: null,
        });
        return false;
      }
      const token = Symbol();
      redeemFlight.current = token;
      setRedeemState({ owner, pending: true, error: null, success: null });
      try {
        await redeemInvitation(code);
        if (!mounted.current || currentOwner.current !== owner) return false;
        setRedeemState({
          owner,
          pending: false,
          error: null,
          success: "Paciente vinculado. A lista foi atualizada.",
        });
        setReloadVersion((version) => version + 1);
        return true;
      } catch (error) {
        if (mounted.current && currentOwner.current === owner)
          setRedeemState({
            owner,
            pending: false,
            error: sanitized(
              error,
              "Não foi possível resgatar o convite. Tente novamente.",
            ),
            success: null,
          });
        return false;
      } finally {
        if (redeemFlight.current === token) redeemFlight.current = null;
      }
    },
    [owner, preview, userId],
  );

  const reportData = useCallback(
    async (signal: AbortSignal) => {
      if (!selectedPatient || periodError || (!preview && !userId))
        throw new Error("report_unavailable");
      const expectedContext = contextKey;
      const snapshot = {
        patient: { id: selectedPatient.id, nome: selectedPatient.nome },
        period: { ...period },
      };
      const events = preview
        ? demoEvents(selectedPatient.id, period)
        : await fetchPatientEvents(selectedPatient.id, period, signal);
      if (
        signal.aborted ||
        !mounted.current ||
        currentContext.current !== expectedContext
      )
        throw new DOMException("Exportação cancelada.", "AbortError");
      return { ...snapshot, events };
    },
    [
      contextKey,
      selectedPatient,
      period.from,
      period.to,
      periodError,
      preview,
      userId,
    ],
  );

  const eventsCurrent = eventState.key === contextKey;
  const reload = useCallback(
    () => setReloadVersion((version) => version + 1),
    [],
  );
  return {
    patients,
    selectedPatient,
    selectedId,
    setSelectedId,
    period,
    setPeriod,
    periodError,
    contextKey,
    loading: patientsState.owner !== owner || patientsState.loading,
    error: patientsState.owner === owner ? patientsState.error : null,
    events: eventsCurrent ? eventState.rows : [],
    eventsLoading: Boolean(
      selectedPatient && !periodError && (!eventsCurrent || eventState.loading),
    ),
    eventsError: eventsCurrent ? eventState.error : null,
    redeem,
    redeeming: redeemState.owner === owner && redeemState.pending,
    redeemError: redeemState.owner === owner ? redeemState.error : null,
    redeemSuccess: redeemState.owner === owner ? redeemState.success : null,
    reload,
    reportData,
  };
}
