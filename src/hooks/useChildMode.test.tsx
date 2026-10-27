import { webcrypto } from "node:crypto";
import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChildMode } from "./useChildMode";

// Fictional PIN used only to exercise the real session verifier.
const TEST_PIN = "7482";
type HookState = { current: ReturnType<typeof useChildMode> };

describe("useChildMode", () => {
  let fullscreenElement: Element | null;
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;
  let originalRequest: PropertyDescriptor | undefined;
  let originalExit: PropertyDescriptor | undefined;
  let originalElement: PropertyDescriptor | undefined;

  function renderMode() {
    return renderHook(() => useChildMode(), { wrapper: StrictMode });
  }

  async function lock(state: HookState) {
    act(() => state.current.start());
    expect(state.current.dialogMode).toBe("setup");
    let accepted = false;
    await act(async () => {
      accepted = await state.current.submitPin(TEST_PIN);
    });
    expect(accepted).toBe(true);
    expect(state.current.isChildMode).toBe(true);
    expect(state.current.dialogMode).toBeNull();
  }

  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto as unknown as Crypto);
    localStorage.clear();
    sessionStorage.clear();
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
    exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
  });

  afterEach(() => {
    cleanup();
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

  it("requests fullscreen synchronously before deriving the configured PIN", async () => {
    const { result } = renderMode();
    expect(result.current.isChildMode).toBe(false);
    act(() => result.current.start());
    expect(result.current.dialogMode).toBe("setup");
    expect(requestFullscreen).not.toHaveBeenCalled();
    await act(async () => {
      const submission = result.current.submitPin(TEST_PIN);
      // This assertion runs before awaiting the first crypto continuation.
      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(await submission).toBe(true);
    });
    expect(result.current.isChildMode).toBe(true);
    expect(result.current.isFullscreen).toBe(true);
  });

  it("rejects invalid setup PINs without activating the mode or fullscreen", async () => {
    const { result } = renderMode();
    act(() => result.current.start());
    for (const pin of ["", "123", "1234567", "12a4", "12 4"]) {
      await act(async () => {
        expect(await result.current.submitPin(pin)).toBe(false);
      });
      expect(result.current.isChildMode).toBe(false);
      expect(result.current.dialogMode).toBe("setup");
    }
    expect(requestFullscreen).not.toHaveBeenCalled();
    act(() => result.current.cancelDialog());
    expect(result.current.dialogMode).toBeNull();
  });

  it("keeps child mode locked after a wrong PIN or a cancelled unlock dialog", async () => {
    const { result } = renderMode();
    await lock(result);
    act(() => result.current.requestUnlock());
    expect(result.current.dialogMode).toBe("unlock");
    await act(async () => {
      expect(await result.current.submitPin("9631")).toBe(false);
    });
    expect(result.current.isChildMode).toBe(true);
    expect(result.current.dialogMode).toBe("unlock");
    expect(exitFullscreen).not.toHaveBeenCalled();
    act(() => result.current.cancelDialog());
    expect(result.current.dialogMode).toBeNull();
    expect(result.current.isChildMode).toBe(true);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("unlocks only with the configured PIN and reuses it during this session", async () => {
    const { result } = renderMode();
    await lock(result);
    act(() => result.current.requestUnlock());
    await act(async () => {
      expect(await result.current.submitPin(TEST_PIN)).toBe(true);
    });
    expect(result.current.isChildMode).toBe(false);
    expect(result.current.dialogMode).toBeNull();
    expect(result.current.isFullscreen).toBe(false);
    expect(exitFullscreen).toHaveBeenCalledOnce();
    await act(async () => result.current.start());
    expect(result.current.isChildMode).toBe(true);
    expect(result.current.dialogMode).toBeNull();
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
  });

  it("does not unlock when the browser leaves fullscreen with Esc", async () => {
    const { result } = renderMode();
    await lock(result);
    act(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.isFullscreen).toBe(false);
    expect(result.current.isChildMode).toBe(true);
    expect(result.current.dialogMode).toBeNull();
    act(() => result.current.requestUnlock());
    await act(async () => {
      expect(await result.current.submitPin(TEST_PIN)).toBe(true);
    });
    expect(result.current.isChildMode).toBe(false);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("keeps the PIN lock usable when fullscreen is unsupported", async () => {
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    const { result } = renderMode();
    await lock(result);
    expect(result.current.isFullscreen).toBe(false);
    expect(result.current.fullscreenNotice).toBeTruthy();
    act(() => result.current.requestUnlock());
    await act(async () => {
      expect(await result.current.submitPin(TEST_PIN)).toBe(true);
    });
    expect(result.current.isChildMode).toBe(false);
  });

  it("handles fullscreen rejection without dropping the PIN lock", async () => {
    requestFullscreen.mockRejectedValue(new Error("permission denied"));
    const { result } = renderMode();
    await lock(result);
    expect(result.current.isFullscreen).toBe(false);
    expect(result.current.fullscreenNotice).toBeTruthy();
    expect(result.current.isChildMode).toBe(true);
  });

  it("does not write a PIN or verifier into persistent browser storage", async () => {
    const save = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderMode();
    await lock(result);
    expect(save).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("releases its own fullscreen on unmount but preserves pre-existing fullscreen", async () => {
    const own = renderMode();
    await lock(own.result);
    own.unmount();
    expect(exitFullscreen).toHaveBeenCalledOnce();
    exitFullscreen.mockClear();
    requestFullscreen.mockClear();
    fullscreenElement = document.documentElement;
    const existing = renderMode();
    await lock(existing.result);
    expect(requestFullscreen).not.toHaveBeenCalled();
    existing.unmount();
    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(fullscreenElement).toBe(document.documentElement);
  });

  it("releases a fullscreen request that completes after unmount", async () => {
    let completeRequest: (() => void) | undefined;
    requestFullscreen.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeRequest = () => {
            fullscreenElement = document.documentElement;
            document.dispatchEvent(new Event("fullscreenchange"));
            resolve();
          };
        }),
    );
    const { result, unmount } = renderMode();
    await lock(result);
    expect(exitFullscreen).not.toHaveBeenCalled();
    unmount();
    await act(async () => {
      completeRequest?.();
      await Promise.resolve();
    });
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(fullscreenElement).toBeNull();
  });
});
