import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../auth/authTypes";
import { AccountOptions } from "./AccountOptions";

const { readProfile, rpc, filterAccount } = vi.hoisted(() => ({
  readProfile: vi.fn(), rpc: vi.fn(), filterAccount: vi.fn(),
}));

vi.mock("../lib/supabase", () => {
  const query = {
    select: vi.fn(() => query), eq: filterAccount.mockImplementation(() => query),
    abortSignal: vi.fn(() => query), single: readProfile,
  };
  return { supabase: { from: vi.fn(() => query), rpc } };
});

const user: AuthUser = {
  id: "account-1", name: "Conta de teste", email: "teste@example.com",
  role: "responsavel", emailConfirmed: true,
};

beforeEach(() => { vi.clearAllMocks(); });

describe("AccountOptions: compatibilidade com o banco publicado", () => {
  it.each(["responsavel", "fonoaudiologo"] as const)("mantém a conta %s utilizável sem as novas opções quando a migração está ausente", async role => {
    readProfile.mockResolvedValue({ data: null, error: { code: "42703" } });
    render(<AccountOptions user={{ ...user, role }} signOut={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("temporariamente indisponíveis");
    expect(screen.queryByRole("button", { name: "Excluir conta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(filterAccount).toHaveBeenCalledWith("id", user.id);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("aguarda a verificação do banco antes de oferecer a confirmação de exclusão", () => {
    readProfile.mockReturnValue(new Promise(() => {}));
    render(<AccountOptions user={user} signOut={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Excluir conta" })).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("habilita as opções após verificar a migração e exige confirmação para excluir", async () => {
    readProfile.mockResolvedValue({ data: { professional_category: "Professor" }, error: null });
    render(<AccountOptions user={{ ...user, role: "fonoaudiologo" }} signOut={vi.fn()} />);
    expect(await screen.findByRole("combobox", { name: "Categoria profissional" })).toHaveValue("Professor");
    fireEvent.click(screen.getByRole("button", { name: "Excluir conta" }));
    expect(screen.getByRole("button", { name: "Excluir definitivamente" })).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("trata falhas de rede sem liberar operações de conta", async () => {
    readProfile.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AccountOptions user={user} signOut={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("temporariamente indisponíveis");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });
});
