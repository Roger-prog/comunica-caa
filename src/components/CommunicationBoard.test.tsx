import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PICTOGRAMS } from "../data/pictograms";
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
      PICTOGRAMS.filter((item) => item.category === "Necessidades").map(
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
    });
    expect(prepareSentence).toHaveBeenCalledTimes(3);
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
});
