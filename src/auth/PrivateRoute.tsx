import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import type { AccountRole } from "./authTypes";
import { homeForRole } from "./authRouting";

/** Guards dashboard routes while leaving authentication to the selected provider. */
export function PrivateRoute({
  children,
  allowedRoles,
}: {
  children?: ReactNode;
  allowedRoles?: readonly AccountRole[];
}) {
  const { user, loading, isMock, isRecovery } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center px-5 text-brand-700"
      >
        Restaurando sua sessão…
      </div>
    );
  }

  if (isRecovery) return <Navigate to="/redefinir-senha" replace />;

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  if (!user.emailConfirmed) return <Navigate to="/confirmar-email" replace />;
  if (!user.role) return <Navigate to="/completar-perfil" replace />;
  if (!isMock && allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }

  return children === undefined ? <Outlet /> : <>{children}</>;
}
