import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    needsPlaybackGesture: false,
    speak: vi.fn(),
    stop: vi.fn(),
    retryPlayback: vi.fn(),
    prefetch,
    prepareSentence,
  };
  const props: BoardProps = {
    speech,
    onSelect: vi.fn(),
    voiceURI: "pt-BR-FranciscaNeural",
    rate: 1,
    largeCards: false,
    catalog: PICTOGRAMS,
    settings: { ...DEFAULT_BOARD_SETTINGS, homeSymbols: PICTOGRAMS.map((item) => item.id), pageSize: 24 },
  };
  return { props, prefetch, cancellations, prepareSentence, preparations };
}

describe("CommunicationBoard: pré-carregamento e resposta ao toque", () => {
  it("preloads only the rendered vocabulary without playing or registering selections", () => {
    const { props, prefetch, cancellations } = fixture();
    const { unmount } = render(<CommunicationBoard {...props} />);

    expect(prefetch).toHaveBeenCalledExactlyOnceWith(
      PICTOGRAMS.map((item) => item.label),
      { voiceURI: props.voiceURI, rate: props.rate },
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

    fireEvent.click(screen.getByRole("button", { name: "Necessidades" }));
    expect(cancellations[0]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(
      PICTOGRAMS.filter((item) => NEEDS_PICTOGRAM_IDS.includes(item.id)).map(
        (item) => item.label,
      ),
      { voiceURI: props.voiceURI, rate: props.rate },
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar símbolo" }), {
      target: { value: "agua" },
    });
    expect(cancellations[1]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(["Água"], {
      voiceURI: props.voiceURI,
      rate: props.rate,
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
      { voiceURI: "pt-BR-AntonioNeural", rate: 1 },
    );

    rerender(
      <CommunicationBoard {...props} voiceURI="pt-BR-AntonioNeural" rate={0.8} />,
    );
    expect(cancellations[1]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(
      PICTOGRAMS.map((item) => item.label),
      { voiceURI: "pt-BR-AntonioNeural", rate: 0.8 },
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
    });

    rerender(<CommunicationBoard {...props} isChildMode />);
    expect(cancellations[1]).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenLastCalledWith(
      PICTOGRAMS.map((item) => item.label),
      { voiceURI: props.voiceURI, rate: props.rate },
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
      bundledOnly: true,
    });
    expect(prepareSentence).toHaveBeenCalledTimes(3);
  });

  it("records every phrase occurrence on each playback without changing the composition", () => {
    const { props } = fixture();
    const record = vi.fn();
    props.onSelect = record;
    render(<CommunicationBoard {...props} />);
    const agua = PICTOGRAMS.find((item) => item.label === "Água")!;
    const mais = PICTOGRAMS.find((item) => item.label === "Mais")!;

    for (const label of ["Mais", "Água", "Água"]) {
      fireEvent.click(screen.getByRole("button", { name: `Falar ${label}` }));
    }
    expect(record.mock.calls).toEqual([[mais], [agua], [agua]]);
    record.mockClear();
    vi.mocked(props.speech.speak).mockClear();

    const play = screen.getByRole("button", { name: "Ouvir frase" });
    fireEvent.click(play);
    expect(record.mock.calls).toEqual([[mais], [agua], [agua]]);
    expect(props.speech.speak).toHaveBeenCalledExactlyOnceWith("Mais Água Água", {
      voiceURI: props.voiceURI,
      rate: props.rate,
      segments: ["Mais", "Água", "Água"],
      bundledOnly: true,
    });
    expect(vi.mocked(props.speech.speak).mock.invocationCallOrder[0])
      .toBeLessThan(record.mock.invocationCallOrder[0]);

    fireEvent.click(play);
    expect(record.mock.calls).toEqual([
      [mais], [agua], [agua], [mais], [agua], [agua],
    ]);
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
    expect(record).toHaveBeenCalledTimes(6);
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
    record.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(record).toHaveBeenCalledTimes(13);
    expect(record.mock.calls.map(([item]) => item.label)).toEqual(["Mais", ...Array(12).fill("Água")]);
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
    fireEvent.click(screen.getByRole("button", { name: "Categorias" }));
    fireEvent.click(screen.getByRole("button", { name: /^Animais$/ }));
    expect(screen.getByRole("button", { name: "Falar Gato" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "O que vamos comunicar?" })).getByText("Água")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar símbolo" }), { target: { value: "ONIBUS" } });
    expect(screen.getByRole("button", { name: "Falar Ônibus" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remover Água da posição 1" }));
    expect(screen.getByRole("button", { name: "Ouvir frase" })).toBeDisabled();
  });

  it("keeps a personalized phrase on the device and out of history and prefetch", () => {
    const { props, prefetch, prepareSentence } = fixture();
    const custom = {
      id: "custom-mamae", label: "Mamãe", spokenText: "Quero conversar com a minha mãe",
      category: "Pessoas", symbol: "", color: "#eee", source: "custom" as const, privateSpeech: true,
    };
    render(<CommunicationBoard {...props} catalog={[...PICTOGRAMS, custom]} />);
    fireEvent.click(screen.getByRole("button", { name: "Meus símbolos" }));
    fireEvent.click(screen.getByRole("button", { name: "Falar Mamãe" }));
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(props.speech.speak).toHaveBeenLastCalledWith(custom.spokenText, {
      voiceURI: props.voiceURI, rate: props.rate, deviceOnly: true, segments: [custom.spokenText],
    });
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(prepareSentence).not.toHaveBeenCalled();
    expect(prefetch.mock.calls.flatMap(([words]) => words)).not.toContain(custom.spokenText);
  });

  it("balances a 13-card home across two pages without changing order or losing the phrase", () => {
    const { props } = fixture();
    const ordered = PICTOGRAMS.slice(0, 13).reverse();
    render(<CommunicationBoard {...props} settings={{
      ...props.settings!, pageSize: 12, homeSymbols: ordered.map((item) => item.id),
    }} />);
    const cardLabels = () => screen.getAllByRole("button", { name: /^Falar / })
      .map((button) => button.getAttribute("aria-label"));
    expect(cardLabels()).toEqual(ordered.slice(0, 7).map((item) => `Falar ${item.label}`));
    fireEvent.click(screen.getByRole("button", { name: `Falar ${ordered[0].label}` }));
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));
    expect(cardLabels()).toEqual(ordered.slice(7).map((item) => `Falar ${item.label}`));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "O que vamos comunicar?" }))
      .getByText(ordered[0].label)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Necessidades" }));
    expect(screen.queryByRole("button", { name: "Próxima página" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Início" }));
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
  });

  it("plays a quick phrase directly or adds it silently and keeps the text private", () => {
    const { props } = fixture();
    const quickPhrase = { id: "local", label: "Pergunta", text: "Quero perguntar uma coisa." };
    render(<CommunicationBoard {...props} settings={{ ...props.settings!, quickPhrases: [quickPhrase] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Frases rápidas" }));
    fireEvent.click(screen.getByRole("button", { name: "Ouvir: Pergunta" }));
    expect(props.speech.speak).toHaveBeenCalledWith(quickPhrase.text, expect.objectContaining({ deviceOnly: true }));
    vi.mocked(props.speech.speak).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar à frase: Pergunta" }));
    expect(props.speech.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ouvir frase" }));
    expect(props.speech.speak).toHaveBeenCalledWith(quickPhrase.text, expect.objectContaining({ deviceOnly: true }));
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
