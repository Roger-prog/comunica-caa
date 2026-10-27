import { webcrypto } from "node:crypto";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";

const speech = vi.hoisted(() => ({
  speak: vi.fn(),
  stop: vi.fn(),
  prefetch: vi.fn(() => () => {}),
  prepareSentence: vi.fn(() => () => {}),
}));

vi.mock("./lib/supabase", () => ({
  supabase: null,
  configurationError: "Conexão não configurada para este teste local.",
}));

vi.mock("./hooks/useSpeech", () => ({
  useSpeech: () => ({
    supported: true,
    voices: [],
    speaking: false,
    error: null,
    speak: speech.speak,
    stop: speech.stop,
    prefetch: speech.prefetch,
    prepareSentence: speech.prepareSentence,
  }),
}));

describe("App: PIN e interface do modo criança", () => {
  let originalRequest: PropertyDescriptor | undefined;
  let originalExit: PropertyDescriptor | undefined;
  let originalElement: PropertyDescriptor | undefined;
  let fullscreenElement: Element | null;
  let requestFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto as unknown as Crypto);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    localStorage.clear();
    sessionStorage.clear();
    speech.speak.mockClear();
    speech.stop.mockClear();
    fullscreenElement = null;
    originalRequest = Object.getOwnPropertyDescriptor(
      document.documentElement,
      "requestFullscreen",
    );
    originalExit = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
    originalElement = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenElement",
    );
    requestFullscreen = vi.fn(() => {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });
  });

  afterEach(() => {
    for (const [target, key, descriptor] of [
      [document.documentElement, "requestFullscreen", originalRequest],
      [document, "exitFullscreen", originalExit],
      [document, "fullscreenElement", originalElement],
    ] as const) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preserva a frase, remove a navegação e só restaura os controles com o PIN correto", async () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Explorar demonstração",
      }),
    );
    expect(
      screen.getByRole("navigation", { name: "Navegação principal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Perfil da criança" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Buscar símbolo" }),
    ).toBeInTheDocument();
    expect(document.querySelector("footer")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Falar Água" }),
    );
    expect(speech.speak).toHaveBeenCalledWith("Água", {
      voiceURI: "",
      rate: 1,
    });
    const sentence = () =>
      screen.getByRole("region", { name: "O que vamos comunicar?" });
    expect(
      within(sentence()).getByText("Água", { exact: true }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Iniciar modo criança" }),
    );
    fireEvent.change(screen.getByLabelText("Novo PIN"), {
      target: { value: "4826" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar PIN"), {
      target: { value: "4826" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar PIN e iniciar" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Perfil da criança" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("searchbox", { name: "Buscar símbolo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Filtrar símbolos por categoria"),
    ).not.toBeInTheDocument();
    expect(document.querySelector("footer")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Falar / })).toHaveLength(24);
    expect(
      within(sentence()).getByText("Água", { exact: true }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Desbloquear modo criança",
      }),
    );
    fireEvent.change(screen.getByLabelText("PIN do responsável"), {
      target: { value: "8642" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Desbloquear" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("PIN incorreto");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Falar / })).toHaveLength(24);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Desbloquear modo criança",
      }),
    );
    fireEvent.change(screen.getByLabelText("PIN do responsável"), {
      target: { value: "4826" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Desbloquear" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("navigation", { name: "Navegação principal" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Perfil da criança" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Buscar símbolo" }),
    ).toBeInTheDocument();
    expect(document.querySelector("footer")).toBeInTheDocument();
    expect(
      within(sentence()).getByText("Água", { exact: true }),
    ).toBeInTheDocument();
  });
});
