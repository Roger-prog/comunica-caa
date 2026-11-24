import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibrasPanel } from "./LibrasPanel";

function activate() {
  fireEvent.click(screen.getByRole("button", { name: "Ativar Libras" }));
  return screen.getByTitle<HTMLIFrameElement>("Intérprete VLibras");
}

function report(source: Window | null, status: string, origin = "null") {
  act(() => window.dispatchEvent(new MessageEvent("message", {
    source,
    origin,
    data: { type: "comunica-vlibras", status },
  })));
}

describe("VLibras", () => {
  afterEach(() => vi.useRealTimers());

  it("carrega o guia isolado só após a ativação e restaura o foco ao fechar", () => {
    render(<LibrasPanel />);
    expect(screen.queryByTitle("Intérprete VLibras")).not.toBeInTheDocument();
    const frame = activate();
    expect(frame).toHaveAttribute("src", "/vlibras.html");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).not.toHaveAttribute("srcdoc");

    report(window, "ready");
    report(frame.contentWindow, "ready", "https://example.org");
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
    report(frame.contentWindow, "ready");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Desativar Libras" }));
    expect(screen.queryByTitle("Intérprete VLibras")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ativar Libras" })).toHaveFocus();
  });

  it("informa falhas de carregamento e permite tentar novamente", () => {
    vi.useFakeTimers();
    render(<LibrasPanel />);
    const frame = activate();
    report(frame.contentWindow, "error");
    expect(screen.getByRole("status")).toHaveTextContent("indisponível");
    expect(screen.queryByTitle("Intérprete VLibras")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(screen.getByTitle("Intérprete VLibras")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByRole("status")).toHaveTextContent("indisponível");
  });
});
