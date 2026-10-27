import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildModePinDialog } from "./ChildModePinDialog";

describe("ChildModePinDialog", () => {
  const originalShowModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const originalClose = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  );

  beforeEach(() => {
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        writable: true,
        value: vi.fn(function (this: HTMLDialogElement) {
          this.setAttribute("open", "");
        }),
      },
      close: {
        configurable: true,
        writable: true,
        value: vi.fn(function (this: HTMLDialogElement) {
          this.removeAttribute("open");
        }),
      },
    });
  });

  afterEach(() => {
    if (originalShowModal)
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "showModal",
        originalShowModal,
      );
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose)
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "close",
        originalClose,
      );
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  });

  it("blocks mismatched and nonnumeric PINs before calling the verifier", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <ChildModePinDialog
        open
        mode="setup"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Novo PIN"), {
      target: { value: "12a4" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar PIN"), {
      target: { value: "12a4" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar PIN e iniciar" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("4 a 6 números");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Novo PIN"), {
      target: { value: "2468" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar PIN"), {
      target: { value: "8642" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Salvar PIN e iniciar" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("não coincidem");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the lock dialog open when the PIN is incorrect", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    const onCancel = vi.fn();
    render(
      <ChildModePinDialog
        open
        mode="unlock"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    fireEvent.change(screen.getByLabelText("PIN do responsável"), {
      target: { value: "2468" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PIN incorreto. Tente novamente.",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("PIN do responsável")).toHaveValue("");
    expect(onSubmit).toHaveBeenCalledWith("2468");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels without submitting and restores the original control's focus on close", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ChildModePinDialog
        open
        mode="unlock"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByLabelText("PIN do responsável")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(
      <ChildModePinDialog
        open={false}
        mode="unlock"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("treats Escape as cancel only and traps keyboard focus inside the modal", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <ChildModePinDialog
        open
        mode="unlock"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByLabelText("PIN do responsável");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancelar" }), {
      key: "Tab",
    });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prevents cancellation and duplicate verification while a request is pending", async () => {
    let finish: (accepted: boolean) => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const onCancel = vi.fn();
    render(
      <ChildModePinDialog
        open
        mode="unlock"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    fireEvent.change(screen.getByLabelText("PIN do responsável"), {
      target: { value: "2468" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Desbloquear" }));
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledOnce();
    finish(false);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Desbloquear" })).toBeEnabled(),
    );
  });

  it("keeps PIN entry accessible when native showModal is unavailable", () => {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    render(
      <ChildModePinDialog
        open
        mode="unlock"
        onSubmit={vi.fn().mockResolvedValue(false)}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Sair do modo criança" }),
    ).toBeVisible();
    expect(screen.getByLabelText("PIN do responsável")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
  });
});
