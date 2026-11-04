import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  Grid2X2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Plus,
  Settings2,
  ShieldCheck,
  Volume2,
  X,
  Stethoscope,
} from "lucide-react";
import { Login } from "./auth/Login";
import { Cadastro } from "./auth/Cadastro";
import { EsqueciSenha } from "./auth/EsqueciSenha";
import { RedefinirSenha } from "./auth/RedefinirSenha";
import { CompletarPerfil } from "./auth/CompletarPerfil";
import { AuthCallback } from "./auth/AuthCallback";
import { EmailConfirmation } from "./auth/EmailConfirmation";
import { AboutPage, PrivacyPage } from "./components/PublicPages";
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
import { CommunicationBoard } from "./components/CommunicationBoard";
import { ChildModePinDialog } from "./components/ChildModePinDialog";
import { Evolution, History } from "./components/ActivityViews";
import { useSpeech } from "./hooks/useSpeech";
import { useWorkspace } from "./hooks/useWorkspace";
import { useChildMode } from "./hooks/useChildMode";
import { PatientInvitation } from "./components/PatientInvitation";

const ProfessionalDashboard = lazy(() =>
  import("./components/ProfessionalDashboard").then((module) => ({
    default: module.ProfessionalDashboard,
  })),
);

type View = "board" | "evolution" | "history" | "settings" | "professional";
const viewPaths: Record<View, string> = {
  board: "/prancha",
  evolution: "/evolucao",
  history: "/historico",
  settings: "/ajustes",
  professional: "/profissional",
};
type Preferences = { voiceURI: string; rate: number; largeCards: boolean };
type ChildModeState = ReturnType<typeof useChildMode>;
const navigation = [
  {
    id: "board" as const,
    label: "Prancha",
    Icon: Grid2X2,
    title: "Espaço para se expressar",
    description: "Uma escolha, uma palavra, um mundo de possibilidades.",
  },
  {
    id: "evolution" as const,
    label: "Evolução",
    Icon: Activity,
    title: "Pequenos passos, novas conexões",
    description: "Acompanhe o uso dos símbolos com clareza.",
  },
  {
    id: "history" as const,
    label: "Histórico",
    Icon: Clock3,
    title: "As expressões de cada dia",
    description: "Revisite as comunicações registradas na prancha.",
  },
  {
    id: "settings" as const,
    label: "Ajustes",
    Icon: Settings2,
    title: "Do seu jeito",
    description: "Escolha a voz e o tamanho dos símbolos.",
  },
  {
    id: "professional" as const,
    label: "Profissional",
    Icon: Stethoscope,
    title: "Acompanhamento fonoaudiológico",
    description:
      "Vincule pacientes por convite, consulte o histórico e exporte relatórios.",
  },
];

function readPreferences(): Preferences {
  const fallback = { voiceURI: "", rate: 1, largeCards: false };
  try {
    const saved = JSON.parse(
      localStorage.getItem("comunica-preferences") ?? "null",
    ) as Partial<Preferences> | null;
    return {
      voiceURI: typeof saved?.voiceURI === "string" ? saved.voiceURI : "",
      rate:
        typeof saved?.rate === "number" &&
        saved.rate >= 0.5 &&
        saved.rate <= 1.5
          ? saved.rate
          : 1,
      largeCards: saved?.largeCards === true,
    };
  } catch {
    return fallback;
  }
}

export function App() {
  const { user, session, isMock } = useAuth();
  return <AppRoutes key={(isMock ? user?.id : session?.user.id) ?? "public"} />;
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

function Workspace({
  preview,
  publicPreview,
  childMode,
}: {
  preview: boolean;
  publicPreview: boolean;
  childMode: ChildModeState;
}) {
  const { user, session, signOut } = useAuth();
  const routeTo = useNavigate();
  const location = useLocation();
  const routePrefix = publicPreview ? "/demonstracao" : "";
  const canManageChildren = preview || user?.role === "responsavel";
  const workspace = useWorkspace(
    canManageChildren ? (session?.user ?? null) : null,
    preview,
    canManageChildren,
  );
  const speech = useSpeech();
  const { isChildMode } = childMode;
  const requestedPath = location.pathname
    .slice(routePrefix.length)
    .replace(/\/$/, "");
  const requestedView = (Object.keys(viewPaths) as View[]).find(
    (key) => viewPaths[key] === requestedPath,
  );
  const view: View = isChildMode ? "board" : (requestedView ?? "board");
  const [preferences, setPreferences] = useState(readPreferences);
  const [showChildForm, setShowChildForm] = useState(false);
  const [childName, setChildName] = useState("");
  const [childError, setChildError] = useState<string | null>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const active = navigation.find((item) => item.id === view)!;
  const displayName = publicPreview
    ? "Modo demonstração"
    : (workspace.profile?.nome ?? user?.name ?? "Minha conta");

  useEffect(() => {
    if (!requestedView || (isChildMode && requestedView !== "board")) {
      routeTo(`${routePrefix}/prancha`, { replace: true });
    }
  }, [requestedView, isChildMode, routePrefix, routeTo]);

  useEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view, isChildMode]);

  useEffect(() => {
    if (showChildForm) document.getElementById("child-name")?.focus();
  }, [showChildForm]);

  useEffect(() => {
    try {
      localStorage.setItem("comunica-preferences", JSON.stringify(preferences));
    } catch {
      /* Storage is optional. */
    }
  }, [preferences]);

  function navigate(next: View) {
    if (isChildMode) return;
    speech.stop();
    routeTo(`${routePrefix}${viewPaths[next]}`);
  }

  function startChildMode() {
    speech.stop();
    setShowChildForm(false);
    routeTo(`${routePrefix}/prancha`, { replace: true });
    childMode.start();
  }

  async function addChild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddingChild(true);
    setChildError(null);
    try {
      await workspace.addChild(childName);
      speech.stop();
      setChildName("");
      setShowChildForm(false);
    } catch (cause) {
      setChildError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar o perfil.",
      );
    } finally {
      setAddingChild(false);
    }
  }

  async function exit() {
    if (isChildMode) return;
    speech.stop();
    if (publicPreview) {
      routeTo("/login", { replace: true });
      return;
    }
    setLeaving(true);
    setExitError(null);
    try {
      await signOut();
      routeTo("/login", { replace: true });
    } catch (cause) {
      setExitError(
        cause instanceof Error ? cause.message : "Não foi possível sair.",
      );
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div
      className={
        isChildMode
          ? "min-h-dvh bg-[#faf9f6]"
          : "min-h-screen lg:grid lg:grid-cols-[248px_minmax(0,1fr)]"
      }
    >
      {!isChildMode && (
        <>
          <a
            href="#main-content"
            className="sr-only z-50 rounded-xl bg-white px-5 py-3 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
          >
            Pular para o conteúdo
          </a>
          <aside className="flex flex-col border-b border-stone-200 bg-white p-4 lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0 lg:p-7">
            <a
              href="#main-content"
              className="mb-5 flex items-center gap-3 lg:mb-12"
              aria-label="Comunica, conteúdo principal"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-600 text-white">
                <MessageCircle size={25} aria-hidden="true" />
              </span>
              <div>
                <span className="text-2xl font-bold tracking-tight">
                  Comunica<span className="text-brand-600">.</span>
                </span>
                <span className="mt-0.5 block text-[10px] tracking-[.19em] text-stone-500 uppercase">
                  Cada expressão importa
                </span>
              </div>
            </a>
            <p className="eyebrow mb-4 hidden px-3 lg:block">Meu espaço</p>
            <nav
              aria-label="Navegação principal"
              className="grid grid-cols-3 gap-1 sm:grid-cols-5 lg:flex lg:flex-col lg:gap-2"
            >
              {navigation
                .filter(
                  ({ id }) =>
                    preview ||
                    rolesForPath(viewPaths[id])?.includes(user!.role!),
                )
                .map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => navigate(id)}
                    aria-current={view === id ? "page" : undefined}
                    className={`flex min-h-14 flex-col items-center justify-center gap-2 rounded-2xl sm:flex-row px-2 py-3 text-xs font-semibold sm:text-sm lg:justify-start lg:gap-3 lg:px-4 ${view === id ? "bg-brand-50 text-brand-700" : "text-stone-600 hover:bg-stone-50"}`}
                  >
                    <Icon size={20} className="shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                    {view === id && (
                      <ChevronRight
                        size={16}
                        className="ml-auto hidden lg:block"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
            </nav>
            <div className="mt-auto hidden lg:block">
              <div className="mb-6 rounded-3xl bg-[#faf8fc] p-4">
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                  <ShieldCheck size={19} aria-hidden="true" />
                </span>
                <p className="text-sm font-semibold">
                  Seu espaço de comunicação
                </p>
                <p className="mt-2 text-xs leading-5 text-stone-500">
                  Comunicar é participar. No seu ritmo, do seu jeito.
                </p>
              </div>
              <div className="border-t border-stone-100 pt-5">
                <p
                  className="truncate text-sm font-semibold"
                  title={displayName}
                >
                  {displayName}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {preview ? "Dados temporários nesta sessão" : "Conta pessoal"}
                </p>
                <button
                  onClick={() => void exit()}
                  disabled={leaving || workspace.pendingWrites > 0}
                  className="mt-3 flex min-h-12 items-center gap-2 text-sm text-stone-600"
                >
                  <LogOut size={17} aria-hidden="true" />
                  {leaving
                    ? "Saindo…"
                    : publicPreview
                      ? "Voltar ao login"
                      : "Sair da conta"}
                </button>
              </div>
            </div>
          </aside>
        </>
      )}

      <div className="min-w-0">
        {!isChildMode && (
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200/70 bg-white/60 px-5 py-4 sm:px-8 lg:px-10">
            <span className="text-sm text-stone-500">
              Meu espaço{" "}
              <span aria-hidden="true" className="mx-2">
                /
              </span>
              <span className="font-medium text-ink">{active.label}</span>
            </span>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {canManageChildren && view !== "professional" && (
                <>
                  <span
                    className="hidden h-10 w-10 items-center justify-center rounded-full sm:flex bg-[#ede6f6] text-sm font-bold text-brand-600"
                    aria-hidden="true"
                  >
                    {(workspace.selectedChild?.nome ?? "C")
                      .slice(0, 1)
                      .toLocaleUpperCase("pt-BR")}
                  </span>
                  <label className="sr-only" htmlFor="child-select">
                    Perfil da criança
                  </label>
                  <select
                    id="child-select"
                    className="min-h-12 max-w-36 rounded-xl sm:max-w-52 border border-stone-200 bg-white px-3 text-sm font-medium"
                    value={workspace.selectedId}
                    onChange={(event) => {
                      speech.stop();
                      workspace.setSelectedId(event.target.value);
                    }}
                    disabled={!workspace.children.length || workspace.loading}
                  >
                    {!workspace.children.length && (
                      <option value="">Nenhum perfil</option>
                    )}
                    {workspace.children.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.nome}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button-secondary min-w-12 px-3"
                    aria-label="Adicionar perfil de criança"
                    onClick={() => setShowChildForm((value) => !value)}
                  >
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </>
              )}
              {view === "professional" && (
                <span className="text-sm font-medium text-brand-700">
                  Painel do profissional
                </span>
              )}
              <button
                type="button"
                className="button-secondary min-w-12 px-3 lg:hidden"
                aria-label={publicPreview ? "Voltar ao login" : "Sair da conta"}
                disabled={leaving || workspace.pendingWrites > 0}
                onClick={() => void exit()}
              >
                <LogOut size={18} aria-hidden="true" />
              </button>
            </div>
          </header>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className={
            isChildMode
              ? "mx-auto min-h-dvh max-w-[1600px] p-3 outline-none sm:p-5"
              : "mx-auto max-w-[1440px] px-5 py-7 outline-none sm:px-8 lg:px-10 lg:py-9"
          }
        >
          {!isChildMode && (
            <>
              {preview && (
                <div className="mb-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p>
                    <strong>Demonstração interativa.</strong> Use dados
                    fictícios. Os registros são temporários e não são enviados
                    ao banco.
                  </p>
                  <button
                    type="button"
                    className="flex min-h-10 items-center gap-2 font-semibold"
                    onClick={() => void exit()}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    {publicPreview ? "Voltar ao login" : "Sair da conta"}
                  </button>
                </div>
              )}
              <div className="mb-7">
                <p className="eyebrow mb-3">
                  Comunicação aumentativa e alternativa
                </p>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl lg:text-[34px]">
                  {active.title}
                </h1>
                <p className="mt-3 text-sm leading-6 text-stone-500 sm:text-base">
                  {!canManageChildren && view === "settings"
                    ? "Confira os dados da sua conta profissional."
                    : active.description}
                </p>
              </div>
              {canManageChildren &&
                showChildForm &&
                view !== "professional" && (
                  <form
                    onSubmit={(event) => void addChild(event)}
                    className="surface mb-6 p-5"
                  >
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2 className="font-semibold">Novo perfil de criança</h2>
                      <button
                        type="button"
                        className="flex h-12 w-12 items-center justify-center rounded-xl hover:bg-stone-50"
                        aria-label="Fechar cadastro de perfil"
                        disabled={addingChild}
                        onClick={() => setShowChildForm(false)}
                      >
                        <X size={20} aria-hidden="true" />
                      </button>
                    </div>
                    <label
                      htmlFor="child-name"
                      className="mb-2 block text-sm font-medium"
                    >
                      Nome ou apelido
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <input
                        id="child-name"
                        className="input-field"
                        autoComplete="off"
                        required
                        maxLength={80}
                        value={childName}
                        onChange={(event) => setChildName(event.target.value)}
                      />
                      <button
                        type="submit"
                        className="button-primary shrink-0"
                        disabled={addingChild || workspace.loading}
                      >
                        {addingChild ? "Salvando…" : "Criar perfil"}
                      </button>
                    </div>
                    {childError && (
                      <p role="alert" className="mt-3 text-sm text-red-800">
                        {childError}
                      </p>
                    )}
                  </form>
                )}
              {workspace.error && (
                <div
                  role="alert"
                  className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                >
                  <p>{workspace.error}</p>
                  <button
                    type="button"
                    className="button-secondary mt-3"
                    disabled={workspace.loading}
                    onClick={workspace.reload}
                  >
                    Tentar carregar novamente
                  </button>
                </div>
              )}
              {exitError && (
                <p
                  role="alert"
                  className="mb-5 rounded-2xl bg-red-50 p-4 text-sm text-red-800"
                >
                  {exitError}
                </p>
              )}
              {workspace.saveError && (
                <div
                  role="alert"
                  className="mb-5 flex items-center justify-between gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-800"
                >
                  <p>{workspace.saveError}</p>
                  <button
                    type="button"
                    className="shrink-0 p-3"
                    aria-label="Fechar aviso de gravação"
                    onClick={workspace.dismissSaveError}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              )}
              {!preview &&
                canManageChildren &&
                view !== "professional" &&
                !workspace.children.length &&
                !workspace.loading &&
                !workspace.error && (
                  <div className="mb-6 rounded-2xl border border-brand-100 bg-brand-50 p-5">
                    <h2 className="font-semibold">
                      Vamos criar o primeiro perfil?
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      A voz já funciona na prancha. Crie um perfil para salvar
                      as comunicações e acompanhar o histórico.
                    </p>
                    <button
                      type="button"
                      className="button-primary mt-4"
                      onClick={() => setShowChildForm(true)}
                    >
                      <Plus size={17} aria-hidden="true" />
                      Adicionar perfil
                    </button>
                  </div>
                )}
              {workspace.loading && view !== "professional" && (
                <p
                  role="status"
                  className="mb-5 flex items-center gap-2 text-sm text-stone-600"
                >
                  <LoaderCircle
                    size={17}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  Carregando perfis…
                </p>
              )}
              {workspace.pendingWrites > 0 && (
                <p role="status" className="mb-4 text-xs text-stone-500">
                  Salvando{" "}
                  {workspace.pendingWrites === 1
                    ? "comunicação"
                    : "comunicações"}
                  …
                </p>
              )}
              {view === "board" && (
                <div className="mb-5 flex justify-end">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={startChildMode}
                    disabled={workspace.loading}
                  >
                    <LockKeyhole size={18} aria-hidden="true" />
                    Iniciar modo criança
                  </button>
                </div>
              )}
            </>
          )}
          {view === "board" && (
            <CommunicationBoard
              key={workspace.selectedId || "unassigned"}
              speech={speech}
              onSelect={workspace.record}
              {...preferences}
              largeCards={isChildMode || preferences.largeCards}
              isChildMode={isChildMode}
              onUnlockRequest={() => {
                speech.stop();
                childMode.requestUnlock();
              }}
            />
          )}
          {view === "evolution" && (
            <Evolution
              key={workspace.selectedId}
              events={workspace.events}
              onBoard={() => navigate("board")}
            />
          )}
          {view === "history" && (
            <History
              key={workspace.selectedId}
              events={workspace.events}
              loading={workspace.historyLoading}
              onBoard={() => navigate("board")}
            />
          )}
          {view === "professional" && (
            <Suspense
              fallback={
                <p role="status" className="text-sm text-stone-600">
                  Carregando painel profissional…
                </p>
              }
            >
              <ProfessionalDashboard
                userId={session?.user.id ?? null}
                preview={preview}
              />
            </Suspense>
          )}
          {view === "settings" && (
            <div className="max-w-3xl space-y-6">
              {canManageChildren && (
                <PatientInvitation
                  key={workspace.selectedId || "unassigned"}
                  child={workspace.selectedChild}
                  preview={preview}
                />
              )}
              {canManageChildren && (
                <>
                  <section
                    className="surface p-6"
                    aria-labelledby="voice-settings"
                  >
                    <h2
                      id="voice-settings"
                      className="mb-2 text-lg font-semibold"
                    >
                      Voz e leitura
                    </h2>
                    <p className="mb-6 text-sm leading-6 text-stone-500">
                      Escolha uma voz neural em português do Brasil para a
                      prancha.
                    </p>
                    <label
                      htmlFor="voice"
                      className="mb-2 block text-sm font-medium"
                    >
                      Voz da prancha
                    </label>
                    <select
                      id="voice"
                      className="input-field"
                      value={preferences.voiceURI}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          voiceURI: event.target.value,
                        })
                      }
                    >
                      <option value="">Francisca · padrão</option>
                      {speech.voices.map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                    <label
                      htmlFor="rate"
                      className="mt-6 mb-3 block text-sm font-medium"
                    >
                      Velocidade da fala: {preferences.rate.toFixed(1)}×
                    </label>
                    <input
                      id="rate"
                      className="min-h-12 w-full accent-[#6c48a0]"
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.1"
                      value={preferences.rate}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          rate: Number(event.target.value),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="button-secondary mt-4"
                      disabled={!speech.supported}
                      onClick={() =>
                        speech.speak(
                          "Olá! Cada expressão importa.",
                          preferences,
                        )
                      }
                    >
                      <Volume2 size={18} aria-hidden="true" />
                      Testar voz
                    </button>
                    {speech.error && (
                      <p role="alert" className="mt-3 text-sm text-red-800">
                        {speech.error}
                      </p>
                    )}
                    {speech.needsPlaybackGesture && (
                      <button
                        type="button"
                        className="button-primary mt-3"
                        onClick={speech.retryPlayback}
                      >
                        <Volume2 size={18} aria-hidden="true" />
                        Ouvir áudio pronto
                      </button>
                    )}
                  </section>
                  <section
                    className="surface p-6"
                    aria-labelledby="board-settings"
                  >
                    <h2
                      id="board-settings"
                      className="mb-5 text-lg font-semibold"
                    >
                      Visual da prancha
                    </h2>
                    <label className="flex min-h-12 items-center gap-4">
                      <input
                        type="checkbox"
                        className="h-6 w-6 accent-[#6c48a0]"
                        checked={preferences.largeCards}
                        onChange={(event) =>
                          setPreferences({
                            ...preferences,
                            largeCards: event.target.checked,
                          })
                        }
                      />
                      <span>
                        <span className="block text-sm font-semibold">
                          Símbolos ampliados
                        </span>
                        <span className="mt-1 block text-sm text-stone-500">
                          Cartões maiores, com menos símbolos por linha.
                        </span>
                      </span>
                    </label>
                  </section>
                </>
              )}
              <section
                className="surface p-6"
                aria-labelledby="account-settings"
              >
                <h2
                  id="account-settings"
                  className="mb-4 text-lg font-semibold"
                >
                  {canManageChildren ? "Conta e perfis" : "Conta profissional"}
                </h2>
                <p className="font-medium">{displayName}</p>
                {user && (
                  <p className="mt-1 break-all text-sm text-stone-500">
                    {user.email}
                  </p>
                )}
                <p className="mt-4 flex items-center gap-2 text-sm text-stone-600">
                  <Check
                    size={17}
                    className="text-brand-600"
                    aria-hidden="true"
                  />
                  {preview
                    ? "Dados de exemplo somente nesta sessão."
                    : canManageChildren
                      ? "Os perfis desta conta são protegidos por controle de acesso no banco."
                      : "Consulta restrita aos pacientes vinculados à sua conta."}
                </p>
                {canManageChildren && (
                  <button
                    type="button"
                    className="button-secondary mt-5"
                    onClick={() => setShowChildForm(true)}
                  >
                    <Plus size={17} aria-hidden="true" />
                    Adicionar perfil
                  </button>
                )}
              </section>
              {canManageChildren && (
                <p className="text-xs leading-5 text-stone-500">
                  Preferências de voz e tamanho são salvas somente neste
                  navegador. Os símbolos e as frases da prancha usam os áudios
                  incluídos no site. Outros textos podem precisar de conexão.
                </p>
              )}
            </div>
          )}
          {!isChildMode && (
            <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-5 text-xs text-stone-500">
              <span>Comunica · Cada expressão importa.</span>
              <span>Um passo de cada vez.</span>
            </footer>
          )}
          {isChildMode && childMode.fullscreenNotice && (
            <p role="status" className="sr-only">
              {childMode.fullscreenNotice}
            </p>
          )}
        </main>
      </div>
      <ChildModePinDialog
        open={childMode.dialogMode !== null}
        mode={childMode.dialogMode ?? "unlock"}
        onCancel={childMode.cancelDialog}
        onSubmit={childMode.submitPin}
      />
    </div>
  );
}
