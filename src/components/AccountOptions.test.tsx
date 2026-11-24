import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountOptionsRow } from "../lib/database.types";
import { AccountOptions } from "./AccountOptions";

const { rpc, update } = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc, from: () => ({ update }) } }));
vi.mock("./AccountDeletion", () => ({ AccountDeletion: () => null }));

const user = { id: "account-id", name: "Ana", email: "ana@exemplo.com", role: "responsavel" as const, emailConfirmed: true };
const single = <T,>(data: T) => {
  const query = { abortSignal: () => query, single: () => Promise.resolve({ data, error: null }) };
  return query;
};

describe("Tipos de perfil", () => {
  let account: AccountOptionsRow;
  beforeEach(() => {
    account = {
      roles: ["responsavel"], professional_pending: false, professional_category: null,
      professional_registration: null, professional_validated: false,
    };
    rpc.mockReset();
    rpc.mockImplementation((name) => {
      if (name === "get_caa_account_options") return single(account);
      if (name === "request_caa_account_role") account = { ...account, professional_pending: true };
      return Promise.resolve({ error: null });
    });
  });

  it("envia o perfil profissional para validação sem oferecê-lo para troca", async () => {
    render(<AccountOptions user={user} signOut={vi.fn()} onRoleChanged={vi.fn()} />);
    const selector = await screen.findByLabelText("Perfil em uso");
    expect(selector).toBeDisabled();
    expect(within(selector).getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Solicitar perfil profissional" }));
    const send = screen.getByRole("button", { name: "Enviar para validação" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Categoria profissional"), { target: { value: "Fisioterapeuta" } });
    fireEvent.change(screen.getByLabelText(/registro profissional/i), { target: { value: "CREFITO 123" } });
    fireEvent.click(send);
    expect(await screen.findByText("Solicitação profissional em validação.")).toBeVisible();
    expect(rpc).toHaveBeenCalledWith("request_caa_account_role", {
      p_expected_user_id: user.id, p_role: "fonoaudiologo", p_category: "Fisioterapeuta", p_registration: "CREFITO 123",
    });
    expect(rpc).not.toHaveBeenCalledWith("switch_caa_account_role", expect.anything());
  });

  it("troca somente para um segundo papel autorizado", async () => {
    account.roles.push("fonoaudiologo");
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<AccountOptions user={user} signOut={vi.fn()} onRoleChanged={refresh} />);
    fireEvent.change(await screen.findByLabelText("Perfil em uso"), { target: { value: "fonoaudiologo" } });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(rpc).toHaveBeenCalledWith("switch_caa_account_role", {
      p_expected_user_id: user.id, p_role: "fonoaudiologo",
    });
  });

  it("distingue a categoria declarada da validação profissional", async () => {
    account = { ...account, roles: ["fonoaudiologo"], professional_category: "Médico" };
    update.mockReturnValue({ eq: () => ({ select: () => single({ id: user.id }) }) });
    render(<AccountOptions user={{ ...user, role: "fonoaudiologo" }} signOut={vi.fn()} onRoleChanged={vi.fn()} />);
    const select = await screen.findByLabelText("Categoria profissional");
    expect(select).toHaveValue("Médico");
    expect(screen.getByText("Categoria declarada")).toBeVisible();
    fireEvent.change(select, { target: { value: "Psicólogo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados profissionais" }));
    expect(await screen.findByText("Dados profissionais salvos.")).toBeVisible();
    expect(update).toHaveBeenCalledWith({ professional_category: "Psicólogo", professional_registration: null });
  });
});
