import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { GuardianLinks, LinkGuardian } from "./GuardianLinks";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
const code = "0123456789abcdef0123456789abcdef";
const created = "2026-11-22T11:00:00Z";
const coGuardian = { guardian_id: "contact", guardian_name: "Marina", is_owner: false, can_edit: false,
  can_manage_links: false, created_at: created };

beforeEach(() => rpc.mockReset());

it("exibe convite ao titular e aplica permissões separadas", async () => {
  rpc.mockImplementation((name: string) => {
    if (name === "list_caa_guardians") return { abortSignal: async () => ({ data: [coGuardian], error: null }) };
    if (name === "create_caa_guardian_invitation") return {
      single: async () => ({ data: { code, expires_at: created }, error: null }),
    };
    return Promise.resolve({ data: true, error: null });
  });
  render(<GuardianLinks patientId="patient" access={{ is_owner: true, can_edit: true, can_manage_links: true }} />);
  fireEvent.change(screen.getByLabelText("E-mail do corresponsável"), { target: { value: "marina@exemplo.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar código de corresponsável" }));
  expect(await screen.findByText(code)).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("create_caa_guardian_invitation", {
    p_crianca_id: "patient", p_email: "marina@exemplo.com",
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Autorizar edição para Marina" }));
  expect(await screen.findByText("Permissões atualizadas.")).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("set_caa_guardian_permissions", {
    p_crianca_id: "patient", p_guardian_id: "contact", p_can_edit: true, p_can_manage_links: false,
  });
});

it("uma conta com visualização consulta vínculos sem ações de gerenciamento", async () => {
  rpc.mockReturnValue({ abortSignal: async () => ({ data: [coGuardian], error: null }) });
  render(<GuardianLinks patientId="patient" access={{ is_owner: false, can_edit: false, can_manage_links: false }} />);
  expect(await screen.findByText("Marina")).toBeVisible();
  expect(screen.queryByRole("button", { name: /revogar acesso|gerar código/ })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("seleciona o paciente vinculado quando o servidor aceita o convite", async () => {
  rpc.mockResolvedValue({ data: "new-patient", error: null });
  const onLinked = vi.fn();
  render(<LinkGuardian onLinked={onLinked} />);
  const button = screen.getByRole("button", { name: "Vincular criança" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Código de corresponsável"), { target: { value: code } });
  fireEvent.click(button);
  await waitFor(() => expect(onLinked).toHaveBeenCalledWith("new-patient"));
  expect(screen.getByRole("status")).toHaveTextContent("Criança vinculada à sua conta.");
});

it("exibe vários corresponsáveis e torna o convite fácil de encontrar", async () => {
  const second = { ...coGuardian, guardian_id: "contact-2", guardian_name: "Paulo", created_at: created };
  rpc.mockImplementation((name: string) => {
    if (name === "list_caa_guardians") return { abortSignal: async () => ({ data: [coGuardian, second], error: null }) };
    return Promise.resolve({ data: true, error: null });
  });
  render(<GuardianLinks patientId="patient" access={{ is_owner: true, can_edit: true, can_manage_links: true }} />);
  expect(await screen.findByText("Marina")).toBeVisible();
  expect(screen.getByText("Paulo")).toBeVisible();
  expect(screen.getByRole("button", { name: "Gerar código de corresponsável" })).toBeVisible();
  expect(screen.getByText(/um novo código substitui qualquer convite pendente/)).toBeVisible();
});
