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
  createInvitation,
  listGuardianMembers,
  revokeMember,
} from "../lib/professional";

vi.mock("../lib/professional", async (original) => ({
  ...(await original<typeof import("../lib/professional")>()),
  createInvitation: vi.fn(),
  listGuardianMembers: vi.fn(),
  revokeMember: vi.fn(),
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
  vi.mocked(createInvitation).mockReset();
  vi.mocked(listGuardianMembers).mockReset().mockResolvedValue([]);
  vi.mocked(revokeMember).mockReset().mockResolvedValue();
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
});
