import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PatientInvitation } from "./PatientInvitation";
import type { Crianca } from "../lib/database.types";
import {
  approveProfessionalMember,
  createInvitation,
  listGuardianMembers,
  revokeMember,
  setBoardMemberAccess,
} from "../lib/professional";

vi.mock("../lib/professional", async (original) => ({
  ...(await original<typeof import("../lib/professional")>()),
  approveProfessionalMember: vi.fn(),
  createInvitation: vi.fn(),
  listGuardianMembers: vi.fn(),
  revokeMember: vi.fn(),
  setBoardMemberAccess: vi.fn(),
}));
const child: Crianca = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  usuario_id: "11111111-1111-4111-8111-111111111111",
  nome: "Perfil fictício",
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
};
const invitation = {
  id: "invitation",
  crianca_id: child.id,
  code: "001234",
  expires_at: "2026-11-03T12:00:00Z",
  is_used: false,
  created_at: "2026-11-02T12:00:00Z",
};
beforeEach(() => {
  vi.mocked(approveProfessionalMember).mockReset().mockResolvedValue();
  vi.mocked(createInvitation).mockReset();
  vi.mocked(listGuardianMembers).mockReset().mockResolvedValue([]);
  vi.mocked(revokeMember).mockReset().mockResolvedValue();
  vi.mocked(setBoardMemberAccess).mockReset().mockResolvedValue();
});

describe("Convite do responsável", () => {
  it("shows the server code preserving zeros and prepares an email without patient information", async () => {
    vi.mocked(createInvitation).mockResolvedValue(invitation);
    render(<PatientInvitation child={child} preview={false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Gerar código de convite" }),
    );
    expect(await screen.findByText("001234")).toBeInTheDocument();
    expect(createInvitation).toHaveBeenCalledExactlyOnceWith(child.id);
    const href = screen
      .getByRole("link", { name: /Preparar e-mail/ })
      .getAttribute("href")!;
    expect(href).toMatch(/^mailto:\?subject=/);
    expect(decodeURIComponent(href)).toContain("Código de vínculo: 001234");
    expect(decodeURIComponent(href)).not.toContain(child.nome);
  });

  it("does not contact the database or generate usable invitations in preview", () => {
    render(<PatientInvitation child={child} preview />);
    expect(
      screen.getByRole("button", { name: "Gerar código de convite" }),
    ).toBeDisabled();
    expect(listGuardianMembers).not.toHaveBeenCalled();
    expect(createInvitation).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("ignores a late invitation when the selected child changes", async () => {
    let finish!: (value: typeof invitation) => void;
    vi.mocked(createInvitation).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(
      <PatientInvitation child={child} preview={false} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Gerar código de convite" }),
    );
    rerender(
      <PatientInvitation
        child={{
          ...child,
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          nome: "Outro perfil fictício",
        }}
        preview={false}
      />,
    );
    await act(async () => finish(invitation));
    expect(screen.queryByText("001234")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("lets the guardian revoke a listed professional", async () => {
    const professionalId = "22222222-2222-4222-8222-222222222222";
    vi.mocked(listGuardianMembers).mockResolvedValue([
      {
        professional_id: professionalId,
        professional_name: "Profissional fictício",
        created_at: "2026-11-02T12:00:00Z",
      },
    ]);
    render(<PatientInvitation child={child} preview={false} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remover vínculo" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText("Profissional fictício"),
      ).not.toBeInTheDocument(),
    );
    expect(revokeMember).toHaveBeenCalledExactlyOnceWith(
      child.id,
      professionalId,
    );
  });

  it("offers an explicit board grant and lets the guardian withdraw it without removing the link", async () => {
    const professionalId = "22222222-2222-4222-8222-222222222222";
    vi.mocked(listGuardianMembers).mockResolvedValue([
      { professional_id: professionalId, professional_name: "Profissional fictício", created_at: "2026-11-02T12:00:00Z", board_access: false },
    ]);
    render(<PatientInvitation child={child} preview={false} />);
    const grant = await screen.findByRole("button", { name: /Autorizar edição da prancha para/ });
    expect(grant).toHaveAccessibleDescription(/veja as fotos privadas/);
    fireEvent.click(grant);
    expect(await screen.findByText("Edição da prancha autorizada")).toBeInTheDocument();
    expect(setBoardMemberAccess).toHaveBeenLastCalledWith(child.id, professionalId, true);
    fireEvent.click(screen.getByRole("button", { name: /Retirar acesso à prancha para/ }));
    expect(await screen.findByText("Acesso ao histórico e aos relatórios")).toBeInTheDocument();
    expect(setBoardMemberAccess).toHaveBeenLastCalledWith(child.id, professionalId, false);
    expect(revokeMember).not.toHaveBeenCalled();
  });

  it("mostra a categoria antes de permitir autorização do profissional", async () => {
    const professionalId = "22222222-2222-4222-8222-222222222222";
    const pending = {
      professional_id: professionalId, professional_name: "Profissional fictício",
      created_at: "2026-11-02T12:00:00Z", approved_at: null,
      professional_category: "Psicólogo", professional_validated: false,
    };
    vi.mocked(listGuardianMembers).mockResolvedValueOnce([pending])
      .mockResolvedValueOnce([{ ...pending, approved_at: "2026-11-03T12:00:00Z" }]);
    render(<PatientInvitation child={child} preview={false} />);
    expect(await screen.findByText("Psicólogo · Categoria declarada")).toBeVisible();
    expect(screen.queryByRole("button", { name: /autorizar edição da prancha/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Autorizar vínculo" }));
    expect(await screen.findByRole("button", { name: /autorizar edição da prancha/i })).toBeVisible();
    expect(approveProfessionalMember).toHaveBeenCalledWith(child.id, professionalId);
  });
});
