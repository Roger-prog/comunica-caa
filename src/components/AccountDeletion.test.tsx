import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth/authTypes";
import type { AccountDeletionPreview } from "../lib/database.types";
import { AccountDeletion } from "./AccountDeletion";

const { rpc, previewResult, confirmResult } = vi.hoisted(() => ({
  rpc: vi.fn(),
  previewResult: vi.fn(),
  confirmResult: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

const user: AuthUser = { id: "user", name: "João", email: "joao@example.com", emailConfirmed: true, role: "responsavel" };
const ready: AccountDeletionPreview = { reauth_required: false, patients: [], review_reason: null, review_requested_at: null };

async function open(preview: AccountDeletionPreview) {
  previewResult.mockResolvedValue({ data: preview, error: null });
  const signOut = vi.fn().mockResolvedValue(undefined);
  render(<AccountDeletion user={user} signOut={signOut} />);
  fireEvent.click(screen.getByRole("button", { name: "Excluir minha conta" }));
  await waitFor(() => expect(screen.queryByText("Processando…")).not.toBeInTheDocument());
  return signOut;
}

describe("Exclusão de conta", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockImplementation(name => name === "preview_caa_account_deletion"
      ? { single: previewResult }
      : confirmResult());
  });

  it("exige sessão recente e confirmação explícita no fluxo de exclusão", async () => {
    const signOut = await open(ready);
    expect(screen.getByRole("button", { name: "Excluir definitivamente" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Digite EXCLUIR/), { target: { value: "EXCLUIR" } });
    confirmResult.mockResolvedValue({ data: "deleted", error: null });
    fireEvent.click(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenLastCalledWith("confirm_caa_account_deletion", {
      p_expected_user_id: user.id,
      p_confirmation: "EXCLUIR",
      p_expected_plan: [],
      p_expected_review_reason: null,
    });
  });

  it("pede novo login quando a sessão estiver antiga", async () => {
    const signOut = await open({ ...ready, reauth_required: true });
    expect(screen.queryByRole("button", { name: "Excluir definitivamente" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sair para entrar novamente" }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(confirmResult).not.toHaveBeenCalled();
  });

  it("registra uma análise sem encerrar a conta se o paciente não tem sucessor", async () => {
    const preview = {
      ...ready,
      review_reason: "patient_care" as const,
      patients: [{ patient_id: "patient", patient_name: "Ana", successor_id: null, successor_name: null }],
    };
    const signOut = await open(preview);
    expect(screen.getByText(/Sem outro responsável/)).toBeInTheDocument();
    confirmResult.mockResolvedValue({ data: "review_requested", error: null });
    previewResult.mockResolvedValue({ data: { ...preview, review_requested_at: "2026-11-22" }, error: null });
    fireEvent.change(screen.getByLabelText(/Digite EXCLUIR/), { target: { value: "EXCLUIR" } });
    fireEvent.click(screen.getByRole("button", { name: "Solicitar análise de exclusão" }));
    expect(await screen.findByText("Solicitação registrada. A conta continua ativa durante a análise.")).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("confirm_caa_account_deletion", {
      p_expected_user_id: user.id,
      p_confirmation: "EXCLUIR",
      p_expected_plan: preview.patients,
      p_expected_review_reason: "patient_care",
    });
  });
});
