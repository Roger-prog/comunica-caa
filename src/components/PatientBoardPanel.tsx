import { lazy, Suspense } from "react";
import type { usePatientBoard } from "../lib/patientBoard";

const BoardManager = lazy(() => import("./BoardManager").then((module) => ({
  default: module.BoardManager,
})));

type Identity = { patientId: string; patientName: string; userId: string };

export function PatientBoardPanel({
  state, canDeleteAny = false, ...patient
}: Identity & { state: ReturnType<typeof usePatientBoard>; canDeleteAny?: boolean }) {
  if (state.status === "error") return (
    <div className="surface p-4">
      <p role="alert" className="text-sm text-red-800">
        {state.error ?? "A personalização desta prancha não pôde ser carregada."}
      </p>
      <button type="button" className="button-secondary mt-3" onClick={state.reload}>Tentar novamente</button>
    </div>
  );
  if (!state.board) return (
    <p role="status" className="surface p-4">Carregando personalização da prancha…</p>
  );
  return (
    <Suspense fallback={<p role="status" className="surface p-4">Carregando editor da prancha…</p>}>
      <BoardManager {...patient} data={state.board} onChange={state.reload} canDeleteAny={canDeleteAny} />
    </Suspense>
  );
}

export function LinkedPatientBoardPanel({ open, onToggle, state, ...props }: Identity & {
  open: boolean;
  onToggle: (open: boolean) => void;
  state: ReturnType<typeof usePatientBoard>;
}) {
  return (
    <details
      className="surface p-5"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-brand-700">
        Personalizar prancha de {props.patientName}
      </summary>
      {open && <PatientBoardPanel {...props} state={state} />}
    </details>
  );
}
