import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CATALOG_PICTOGRAMS, NEEDS_PICTOGRAM_IDS, PICTOGRAMS } from "../data/pictograms";
import { DEFAULT_BOARD_SETTINGS } from "../lib/patientBoardModel";
import type { SpeechOptions } from "../hooks/useSpeech";
import { CommunicationBoard } from "./CommunicationBoard";

type BoardProps = ComponentProps<typeof CommunicationBoard>;

function fixture() {
  const cancellations: ReturnType<typeof vi.fn>[] = [];
  const preparations: ReturnType<typeof vi.fn>[] = [];
  const prefetch = vi.fn(
    (_texts: readonly string[], _options: SpeechOptions = {}) => {
      const cancel = vi.fn();
      cancellations.push(cancel);
      return cancel;
    },
  );
  const prepareSentence = vi.fn(
    (_texts: readonly string[], _options: SpeechOptions = {}) => {
      const cancel = vi.fn();
      preparations.push(cancel);
      return cancel;
    },
  );
  const speech: BoardProps["speech"] = {
    supported: true,
    voices: [],
    speaking: false,
    error: null,
    notice: null,
    needsPlaybackGesture: false,
    preparing: false,
    canRetrySynthesis: false,
    retrySynthesis: vi.fn(),
    canFallbackToDevice: false,
    fallbackToDevice: vi.fn(),
    speak: vi.fn(),
    stop: vi.fn(),
    retryPlayback: vi.fn(),
    prefetch,
    prepareSentence,
  };
  const props: BoardProps = {
    speech,
    onSelect: vi.fn(),
    onPlayback: vi.fn(),
    voiceURI: "pt-BR-FranciscaNeural",
    rate: 1,
    largeCards: false,
    catalog: PICTOGRAMS,
    settings: { ...DEFAULT_BOARD_SETTINGS, homeSymbols: PICTOGRAMS.map((item) => item.id), pageSize: 24 },
  };
  return { props, prefetch, cancellations, prepareSentence, preparations };
}

function openArea(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Áreas da prancha" })).getByRole("button", { name }));
}

describe("CommunicationBoard: pré-carregamento e resposta ao toque", () => {
  it("preloads only the rendered vocabulary without playing or registering selections", () => {
    const { props, prefetch, cancellations } = fixture();
    const { unmount } = render(<CommunicationBoard {...props} />);

    expect(prefetch).toHaveBeenCalledExactlyOnceWith(
      PICTOGRAMS.map((item) => item.label),
      { voiceURI: props.voiceURI, rate: props.rate, offlineOnly: true },
    );
    expect(screen.getAllByRole("button", { name: /^Falar / })).toHaveLength(
      PICTOGRAMS.length,
    );
    expect(props.speech.speak).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();

    unmount();
    expect(cancellations[0]).toHaveBeenCalledOnce();
  });

  it("replaces the preload batch when the category or search changes", () => {
    const { props, prefetch, cancellations } = fixture();
    const { unmount } = render(<CommunicationBoard {...props} />);

    openArea("Necessidades");
    expect(cancellations[0]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(
      PICTOGRAMS.filter((item) => NEEDS_PICTOGRAM_IDS.includes(item.id)).map(
        (item) => item.label,
      ),
      { voiceURI: props.voiceURI, rate: props.rate, offlineOnly: true },
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar símbolo" }), {
      target: { value: "agua" },
    });
    expect(cancellations[1]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(["Água"], {
      voiceURI: props.voiceURI,
      rate: props.rate,
      offlineOnly: true,
    });
    expect(screen.getAllByRole("button", { name: /^Falar / })).toHaveLength(1);

    unmount();
    expect(cancellations[2]).toHaveBeenCalledOnce();
  });

  it("uses the new voice and rate and cancels stale batches", () => {
    const { props, prefetch, cancellations } = fixture();
    const { rerender } = render(<CommunicationBoard {...props} />);
    rerender(
      <CommunicationBoard {...props} voiceURI="pt-BR-AntonioNeural" />,
    );
    expect(cancellations[0]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(
      PICTOGRAMS.map((item) => item.label),
      { voiceURI: "pt-BR-AntonioNeural", rate: 1, offlineOnly: true },
    );

    rerender(
      <CommunicationBoard {...props} voiceURI="pt-BR-AntonioNeural" rate={0.8} />,
    );
    expect(cancellations[1]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(
      PICTOGRAMS.map((item) => item.label),
      { voiceURI: "pt-BR-AntonioNeural", rate: 0.8, offlineOnly: true },
    );
    expect(prefetch).toHaveBeenCalledTimes(3);
  });

  it("does not restart preloading for sentence edits or speech-state updates", () => {
    const { props, prefetch } = fixture();
    const { rerender } = render(<CommunicationBoard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    expect(props.speech.speak).toHaveBeenCalledExactlyOnceWith("Água", {
      voiceURI: props.voiceURI,
      rate: props.rate,
      offlineOnly: true,
    });
    expect(props.onSelect).toHaveBeenCalledWith(PICTOGRAMS[0]);
    expect(
      within(screen.getByRole("region", { name: "O que vamos comunicar?" }))
        .getByText("Água", { exact: true }),
    ).toBeInTheDocument();

    rerender(
      <CommunicationBoard
        {...props}
        speech={{ ...props.speech, speaking: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar frase" }));
    expect(props.speech.stop).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenCalledOnce();
  });

  it("preloads the full child-mode vocabulary after a filtered board", () => {
    const { props, prefetch, cancellations } = fixture();
    const { rerender } = render(<CommunicationBoard {...props} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar símbolo" }), {
      target: { value: "Mais" },
    });
    expect(prefetch).toHaveBeenLastCalledWith(["Mais"], {
      voiceURI: props.voiceURI,
      rate: props.rate,
      offlineOnly: true,
    });

    rerender(<CommunicationBoard {...props} isChildMode />);
    expect(cancellations[1]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(
      PICTOGRAMS.map((item) => item.label),
      { voiceURI: props.voiceURI, rate: props.rate, offlineOnly: true },
    );
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Falar / })).toHaveLength(24);
  });

  it("provides immediate pressed styles with a reduced-motion override", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} />);

    const button = screen.getByRole("button", { name: "Falar Água" });
    expect(button).toHaveClass(
      "active:bg-purple-200",
      "active:scale-95",
      "active:duration-0",
      "motion-reduce:active:scale-100",
    );
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(props.speech.speak).toHaveBeenCalledOnce();
  });

  it("prepares the exact selected sequence and passes repeated segments in order to playback", () => {
    const { props, prepareSentence } = fixture();
    render(<CommunicationBoard {...props} />);
    expect(prepareSentence).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    fireEvent.click(screen.getByRole("button", { name: "Falar Mais" }));
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    expect(prepareSentence).toHaveBeenLastCalledWith(
      ["Água", "Mais", "Água"],
      { voiceURI: props.voiceURI, rate: props.rate },
    );
    // Preparation never adds selections or starts an extra playback.
    expect(props.onSelect).toHaveBeenCalledTimes(3);
    expect(props.speech.speak).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(props.speech.speak).toHaveBeenLastCalledWith("Água Mais Água", {
      voiceURI: props.voiceURI,
      rate: props.rate,
      segments: ["Água", "Mais", "Água"],
      offlineOnly: true,
      onStart: expect.any(Function),
    });
    expect(prepareSentence).toHaveBeenCalledTimes(3);
  });

  it("records one complete message for each actual start without duplicating selections", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} />);
    for (const label of ["Mais", "Água", "Água"]) {
      fireEvent.click(screen.getByRole("button", { name: `Falar ${label}` }));
    }
    expect(props.onSelect).toHaveBeenCalledTimes(3);
    vi.mocked(props.speech.speak).mockClear();

    const play = screen.getByRole("button", { name: "Ouvir frase" });
    fireEvent.click(play);
    expect(props.onPlayback).not.toHaveBeenCalled();
    expect(props.speech.speak).toHaveBeenCalledExactlyOnceWith("Mais Água Água", {
      voiceURI: props.voiceURI,
      rate: props.rate,
      segments: ["Mais", "Água", "Água"],
      offlineOnly: true,
      onStart: expect.any(Function),
    });
    const firstStart = vi.mocked(props.speech.speak).mock.calls[0][1]?.onStart;
    firstStart?.();
    firstStart?.();
    expect(props.onPlayback).toHaveBeenCalledExactlyOnceWith("Mais Água Água");

    fireEvent.click(play);
    vi.mocked(props.speech.speak).mock.calls[1][1]?.onStart?.();
    expect(props.onPlayback).toHaveBeenCalledTimes(2);
    expect(props.onSelect).toHaveBeenCalledTimes(3);
    const sentence = screen.getByRole("region", { name: "O que vamos comunicar?" });
    expect(within(sentence).getAllByText("Água", { exact: true })).toHaveLength(2);
    expect(within(sentence).getAllByText("Mais", { exact: true })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    const confirmation = screen.getByRole("group", { name: "Confirmar limpeza da frase" });
    expect(within(confirmation).getByRole("button", { name: "Manter frase" })).toHaveFocus();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Manter frase" }));
    expect(play).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar frase" }));
    fireEvent.click(play);
    expect(play).toBeDisabled();
    expect(props.onSelect).toHaveBeenCalledTimes(3);
    expect(props.onPlayback).toHaveBeenCalledTimes(2);
    expect(props.speech.speak).toHaveBeenCalledTimes(2);
  });

  it("keeps more than twelve symbols and preserves the beginning at the configured limit", () => {
    const { props } = fixture();
    const record = vi.fn();
    render(<CommunicationBoard {...props} onSelect={record} settings={{ ...props.settings!, maxSentenceSymbols: 13 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Falar Mais" }));
    for (let index = 0; index < 12; index++) {
      fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Falar Olá" }));
    expect(screen.getByText(/limite de 13 símbolos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ops, remover último" }));
    fireEvent.click(screen.getByRole("button", { name: "Falar Olá" }));
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    vi.mocked(props.speech.speak).mock.lastCall?.[1]?.onStart?.();
    expect(record).toHaveBeenCalledTimes(14);
    expect(props.onPlayback).toHaveBeenCalledExactlyOnceWith(["Mais", ...Array(11).fill("Água"), "Olá"].join(" "));
  });

  it("does not register a phrase when playback is unavailable", () => {
    const { props } = fixture();
    const record = vi.fn();
    const { rerender } = render(<CommunicationBoard {...props} onSelect={record} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(record).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    record.mockClear();
    vi.mocked(props.speech.speak).mockClear();

    rerender(<CommunicationBoard {...props} onSelect={record}
      speech={{ ...props.speech, supported: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(record).not.toHaveBeenCalled();
    expect(props.speech.speak).not.toHaveBeenCalled();
  });

  it("cancels old sentence preparation when composition or voice settings change", () => {
    const { props, prepareSentence, preparations } = fixture();
    const { rerender, unmount } = render(<CommunicationBoard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    fireEvent.click(screen.getByRole("button", { name: "Falar Mais" }));
    expect(preparations[0]).toHaveBeenCalledOnce();

    rerender(<CommunicationBoard {...props} voiceURI="pt-BR-AntonioNeural" />);
    expect(preparations[1]).toHaveBeenCalledOnce();
    expect(prepareSentence).toHaveBeenLastCalledWith(["Água", "Mais"], {
      voiceURI: "pt-BR-AntonioNeural", rate: 1,
    });
    rerender(<CommunicationBoard {...props} voiceURI="pt-BR-AntonioNeural" rate={0.8} />);
    expect(preparations[2]).toHaveBeenCalledOnce();
    expect(prepareSentence).toHaveBeenLastCalledWith(["Água", "Mais"], {
      voiceURI: "pt-BR-AntonioNeural", rate: 0.8,
    });
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar frase" }));
    expect(preparations[3]).toHaveBeenCalledOnce();
    expect(prepareSentence).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole("button", { name: "Falar Olá" }));
    unmount();
    expect(preparations[4]).toHaveBeenCalledOnce();
  });

  it("does not repeat sentence preparation when speech state or visible symbols change", () => {
    const { props, prepareSentence } = fixture();
    const { rerender } = render(<CommunicationBoard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    expect(prepareSentence).toHaveBeenCalledOnce();
    rerender(<CommunicationBoard {...props} speech={{ ...props.speech, speaking: true }} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar símbolo" }), {
      target: { value: "agua" },
    });
    expect(prepareSentence).toHaveBeenCalledOnce();
  });

  it("limits the initial view, searches the complete catalog and keeps the sentence across categories", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} catalog={CATALOG_PICTOGRAMS} settings={DEFAULT_BOARD_SETTINGS} />);
    expect(screen.getAllByRole("button", { name: /^Falar / })).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    openArea("Todas as categorias");
    fireEvent.click(screen.getByRole("button", { name: /^Animais$/ }));
    expect(screen.getByRole("button", { name: "Falar Gato" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "O que vamos comunicar?" })).getByText("Água")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar símbolo" }), { target: { value: "ONIBUS" } });
    expect(screen.getByRole("button", { name: "Falar Ônibus" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remover Água da posição 1" }));
    expect(screen.getByRole("button", { name: "Ouvir frase" })).toBeDisabled();
  });

  it("records custom selections while keeping playback and prefetch local", () => {
    const { props, prefetch, prepareSentence } = fixture();
    const custom = {
      id: "custom-mamae", label: "Mamãe", spokenText: "Quero conversar com a minha mãe",
      category: "Pessoas", symbol: "", color: "#eee", source: "custom" as const, privateSpeech: true,
    };
    render(<CommunicationBoard {...props} catalog={[...PICTOGRAMS, custom]} />);
    openArea("Meus símbolos");
    fireEvent.click(screen.getByRole("button", { name: "Falar Mamãe" }));
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(props.speech.speak).toHaveBeenLastCalledWith(custom.spokenText, {
      voiceURI: props.voiceURI, rate: props.rate, offlineOnly: true, segments: [custom.spokenText],
      onStart: expect.any(Function),
    });
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(custom);
    expect(prepareSentence).not.toHaveBeenCalled();
    expect(prefetch.mock.calls.flatMap(([words]) => words)).not.toContain(custom.spokenText);
  });

  it("fills the first page of a 13-card home without changing order or losing the phrase", () => {
    const { props } = fixture();
    const ordered = PICTOGRAMS.slice(0, 13).reverse();
    render(<CommunicationBoard {...props} settings={{
      ...props.settings!, pageSize: 12, homeSymbols: ordered.map((item) => item.id),
    }} />);
    const cardLabels = () => screen.getAllByRole("button", { name: /^Falar / })
      .map((button) => button.getAttribute("aria-label"));
    expect(cardLabels()).toEqual(ordered.slice(0, 12).map((item) => `Falar ${item.label}`));
    fireEvent.click(screen.getByRole("button", { name: `Falar ${ordered[0].label}` }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(cardLabels()).toEqual(ordered.slice(12).map((item) => `Falar ${item.label}`));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "O que vamos comunicar?" }))
      .getByText(ordered[0].label)).toBeInTheDocument();
    openArea("Necessidades");
    expect(screen.getByRole("button", { name: "Próxima página" })).toBeDisabled();
    openArea("Início");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
  });

  it("plays a quick phrase directly or adds it silently and keeps the text private", () => {
    const { props } = fixture();
    const quickPhrase = { id: "local", label: "Pergunta", text: "Quero perguntar uma coisa." };
    render(<CommunicationBoard {...props} settings={{ ...props.settings!, quickPhrases: [quickPhrase] }} />);
    openArea("Frases rápidas");
    fireEvent.click(screen.getByRole("button", { name: "Ouvir: Pergunta" }));
    expect(props.speech.speak).toHaveBeenCalledWith(quickPhrase.text, expect.objectContaining({ offlineOnly: true }));
    vi.mocked(props.speech.speak).mock.lastCall?.[1]?.onStart?.();
    expect(props.onPlayback).toHaveBeenCalledExactlyOnceWith(quickPhrase.text);
    vi.mocked(props.speech.speak).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar à frase: Pergunta" }));
    expect(props.speech.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(props.speech.speak).toHaveBeenCalledWith(quickPhrase.text, expect.objectContaining({ offlineOnly: true }));
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onPlayback).toHaveBeenCalledOnce();
  });
  it("desfaz só a última figura com o botão Ops e deixa a frase anterior intacta", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} />);
    const opa = screen.getByRole("button", { name: "Ops, remover último" });
    expect(opa).toBeDisabled();
    expect(opa).toHaveTextContent("Ops");

    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    fireEvent.click(screen.getByRole("button", { name: "Falar Mais" }));
    const sentence = screen.getByRole("region", { name: "O que vamos comunicar?" });
    expect(within(sentence).getByText("Mais")).toBeInTheDocument();

    fireEvent.click(opa);
    expect(within(sentence).queryByText("Mais")).not.toBeInTheDocument();
    expect(within(sentence).getByText("Água")).toBeInTheDocument();
    expect(props.speech.stop).toHaveBeenCalled();
    expect(opa).toBeEnabled();
    fireEvent.click(opa);
    expect(opa).toBeDisabled();
  });

  it("oferece Sim e Não grandes que entram na frase como qualquer figura", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Responder sim" }));
    fireEvent.click(screen.getByRole("button", { name: "Responder não" }));
    const sentence = screen.getByRole("region", { name: "O que vamos comunicar?" });
    expect(within(sentence).getByText("Sim")).toBeInTheDocument();
    expect(within(sentence).getByText("Não")).toBeInTheDocument();
    expect(props.onSelect).toHaveBeenCalledTimes(2);
  });

  it("no modo criança mantém os três controles principais e esconde os controles de adulto", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} isChildMode />);
    expect(screen.queryByRole("button", { name: "Página anterior" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima página" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ops, remover último" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    expect(screen.queryByRole("button", { name: /^Remover Água/ })).not.toBeInTheDocument();
  });

  it("reúne todas as áreas dentro de Categorias e deixa somente três controles com pictograma e texto", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} />);
    expect(screen.queryByRole("group", { name: "Áreas da prancha" })).not.toBeInTheDocument();
    const controls = within(screen.getByRole("group", { name: "Controles da prancha" }));
    expect(controls.getAllByRole("button")).toHaveLength(3);
    for (const name of ["Ops, remover último", "Próxima página", "Categorias"]) {
      const button = controls.getByRole("button", { name });
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent?.trim()).not.toBe("");
    }
    fireEvent.click(controls.getByRole("button", { name: "Categorias" }));
    expect(controls.getByRole("button", { name: "Categorias" })).toHaveAttribute("aria-expanded", "true");
    const areas = within(screen.getByRole("group", { name: "Áreas da prancha" }));
    expect(areas.getAllByRole("button")).toHaveLength(8);
    for (const name of ["Início", "Vocabulário essencial", "Necessidades", "Todas as categorias", "Saúde", "Favoritos", "Meus símbolos", "Frases rápidas"]) {
      expect(areas.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(areas.getByRole("button", { name: "Início" }));
    expect(screen.queryByRole("group", { name: "Áreas da prancha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Falar Água" })).toBeInTheDocument();
  });

  it("fecha Categorias por Escape sem perder a página nem a frase e devolve o foco ao botão", async () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} settings={{ ...props.settings!, pageSize: 12 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Falar Água" }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
    expect(screen.getByRole("button", { name: "Próxima página" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("group", { name: "Áreas da prancha" }), { key: "Escape" });
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeEnabled();
    expect(within(screen.getByRole("region", { name: "O que vamos comunicar?" })).getByText("Água")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Categorias" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
  });

  it("respeita a preferência de ocultar frases rápidas também dentro de Categorias", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} settings={{ ...props.settings!, quickPhrasesEnabled: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
    expect(within(screen.getByRole("group", { name: "Áreas da prancha" })).queryByRole("button", { name: "Frases rápidas" })).not.toBeInTheDocument();
  });

  it("preserva a dica das categorias e registra somente o início da reprodução", () => {
    const { props } = fixture();
    render(<CommunicationBoard {...props} />);
    openArea("Todas as categorias");
    fireEvent.click(screen.getByRole("button", { name: /Não está no meu livro/ }));
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onPlayback).not.toHaveBeenCalled();
    const options = vi.mocked(props.speech.speak).mock.calls.at(-1)![1]!;
    options.onStart?.();
    options.onStart?.();
    expect(props.onPlayback).toHaveBeenCalledExactlyOnceWith("Não está no meu livro, mas vou dar uma dica");
  });

  it("mantém Libras opcional para o adulto sem carregar o intérprete ao selecionar", () => {
    const { props } = fixture();
    const { rerender } = render(<CommunicationBoard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Responder sim" }));
    expect(screen.getByText("Traduzir em Libras")).toBeInTheDocument();
    expect(screen.queryByTitle("Intérprete VLibras")).not.toBeInTheDocument();
    rerender(<CommunicationBoard {...props} isChildMode />);
    expect(screen.queryByText("Traduzir em Libras")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "O que vamos comunicar?" })).getByText("Sim")).toBeInTheDocument();
  });
});
