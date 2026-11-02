import type { AccountRole } from "./authTypes";

export function homeForRole(role: AccountRole | null): string {
  if (role === "responsavel") return "/prancha";
  if (role === "fonoaudiologo") return "/profissional";
  return "/completar-perfil";
}

export function rolesForPath(pathname: string): readonly AccountRole[] | null {
  switch (pathname.replace(/\/$/, "")) {
    case "/prancha":
    case "/evolucao":
    case "/historico":
      return ["responsavel"];
    case "/profissional":
      return ["fonoaudiologo"];
    case "/ajustes":
      return ["responsavel", "fonoaudiologo"];
    default:
      return null;
  }
}

export function loginDestination(
  from: unknown,
  role: AccountRole | null,
  isMock: boolean,
): string {
  if (
    typeof from === "string" &&
    /^\/(prancha|evolucao|historico|ajustes|profissional)\/?(?:\?[^#]*)?$/.test(
      from,
    )
  ) {
    const allowed = rolesForPath(from.split("?", 1)[0]);
    if (allowed && (isMock || (role !== null && allowed.includes(role))))
      return from;
  }
  return homeForRole(role);
}
