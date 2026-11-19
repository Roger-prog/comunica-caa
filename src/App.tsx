import { lazy, Suspense, useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { Login } from "./auth/Login";
import { Cadastro } from "./auth/Cadastro";
import { EsqueciSenha } from "./auth/EsqueciSenha";
import { RedefinirSenha } from "./auth/RedefinirSenha";
import { CompletarPerfil } from "./auth/CompletarPerfil";
import { AuthCallback } from "./auth/AuthCallback";
import { EmailConfirmation } from "./auth/EmailConfirmation";
import { AboutPage, CreditsPage, PrivacyPage } from "./components/PublicPages";
import {
  homeForRole,
  loginDestination,
  rolesForPath,
} from "./auth/authRouting";
import { useAuth } from "./auth/AuthProvider";
import { PrivateRoute } from "./auth/PrivateRoute";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useChildMode } from "./hooks/useChildMode";
type ChildModeState = ReturnType<typeof useChildMode>;
const Workspace = lazy(() => import("./Workspace"));

export function App() {
  const { user, session, isMock } = useAuth();
  return <Suspense fallback={<SessionPending />}><AppRoutes key={(isMock ? user?.id : session?.user.id) ?? "public"} /></Suspense>;
}

function SessionPending() {
  return (
    <div
      role="status"
      className="flex min-h-dvh items-center justify-center gap-3 text-brand-600"
    >
      <LoaderCircle className="animate-spin" size={24} aria-hidden="true" />
      Restaurando sua sessão…
    </div>
  );
}

function HomeRedirect() {
  const { user, loading, isRecovery } = useAuth();
  if (loading) return <SessionPending />;
  return (
    <Navigate
      to={
        isRecovery
          ? "/redefinir-senha"
          : !user
            ? "/login"
            : !user.emailConfirmed
              ? "/confirmar-email"
              : homeForRole(user.role)
      }
      replace
    />
  );
}

function AppRoutes() {
  const { user, session, isMock, loading } = useAuth();
  const childModeState = useChildMode();
  const location = useLocation();
  const routeTo = useNavigate();
  const authenticatedIdentity = isMock ? Boolean(user) : Boolean(session);
  const lockedPath = authenticatedIdentity
    ? "/prancha"
    : "/demonstracao/prancha";
  // A child lock must never override a lost session or a changed account role.
  const canKeepChildLock =
    !authenticatedIdentity ||
    isMock ||
    loading ||
    Boolean(user?.emailConfirmed && user.role === "responsavel");
  const childMode = {
    ...childModeState,
    isChildMode: childModeState.isChildMode && canKeepChildLock,
  };

  useEffect(() => {
    if (childMode.isChildMode && location.pathname !== lockedPath) {
      routeTo(lockedPath, { replace: true });
    }
  }, [childMode.isChildMode, location.pathname, lockedPath, routeTo]);

  return (
    <Routes location={childMode.isChildMode ? lockedPath : location}>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/sobre" element={<AboutPage />} />
      <Route path="/privacidade" element={<PrivacyPage />} />
      <Route path="/creditos" element={<CreditsPage />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/cadastro" element={<LoginRoute registering />} />
      <Route path="/esqueci-senha" element={<EsqueciSenha />} />
      <Route path="/redefinir-senha" element={<RedefinirSenha />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/confirmar-email" element={<EmailConfirmation />} />
      <Route path="/completar-perfil" element={<OnboardingRoute />} />
      <Route
        path="/demonstracao/*"
        element={<PublicPreviewRoute childMode={childMode} />}
      />
      <Route element={<PrivateRoute />}>
        <Route path="/*" element={<DashboardRoute childMode={childMode} />} />
      </Route>
    </Routes>
  );
}

function LoginRoute({ registering = false }: { registering?: boolean }) {
  const { user, loading, isRecovery, isMock } = useAuth();
  const location = useLocation();
  const from: unknown = (location.state as { from?: unknown } | null)?.from;
  if (loading) return <SessionPending />;
  if (isRecovery) return <Navigate to="/redefinir-senha" replace />;
  if (user && !user.emailConfirmed)
    return <Navigate to="/confirmar-email" replace />;
  if (user)
    return <Navigate to={loginDestination(from, user.role, isMock)} replace />;
  if (registering) return <Cadastro />;
  return <Login />;
}

function OnboardingRoute() {
  const { user, loading, isRecovery } = useAuth();
  if (loading) return <SessionPending />;
  if (isRecovery) return <Navigate to="/redefinir-senha" replace />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.emailConfirmed) return <Navigate to="/confirmar-email" replace />;
  if (user.role) return <Navigate to={homeForRole(user.role)} replace />;
  return <CompletarPerfil />;
}

function DashboardRoute({ childMode }: { childMode: ChildModeState }) {
  const { user } = useAuth();
  const location = useLocation();
  const allowed = rolesForPath(location.pathname);
  if (!allowed) return <Navigate to={homeForRole(user!.role)} replace />;
  return (
    <PrivateRoute allowedRoles={allowed}>
      <AuthenticatedWorkspace childMode={childMode} />
    </PrivateRoute>
  );
}

function AuthenticatedWorkspace({ childMode }: { childMode: ChildModeState }) {
  const { user, isMock } = useAuth();
  return (
    <Workspace
      key={user!.id}
      preview={isMock}
      publicPreview={false}
      childMode={childMode}
    />
  );
}

function PublicPreviewRoute({ childMode }: { childMode: ChildModeState }) {
  const { user, loading, isRecovery } = useAuth();
  if (loading) return <SessionPending />;
  if (isRecovery) return <Navigate to="/redefinir-senha" replace />;
  if (user)
    return (
      <Navigate
        to={user.emailConfirmed ? homeForRole(user.role) : "/confirmar-email"}
        replace
      />
    );
  return <Workspace preview publicPreview childMode={childMode} />;
}

