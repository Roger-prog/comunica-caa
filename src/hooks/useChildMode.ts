import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPinVerifier,
  isValidPin,
  verifyPin,
  type PinVerifier,
} from "../lib/childModePin";

export function useChildMode() {
  const [isChildMode, setIsChildMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"setup" | "unlock" | null>(null);
  const verifier = useRef<PinVerifier | null>(null);
  const active = useRef(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const revision = useRef(0);
  const fullscreenWanted = useRef(false);
  const fullscreenOwned = useRef(false);
  const fullscreenPending = useRef(false);

  const releaseFullscreen = useCallback(() => {
    fullscreenWanted.current = false;
    if (!fullscreenOwned.current) return;
    fullscreenOwned.current = false;
    if (
      document.fullscreenElement !== document.documentElement ||
      !document.exitFullscreen
    )
      return;
    try {
      void Promise.resolve(document.exitFullscreen()).catch(() => {});
    } catch {
      /* Browser controls remain available if exiting is not supported. */
    }
  }, []);

  const requestFullscreen = useCallback(() => {
    fullscreenWanted.current = true;
    setFullscreenNotice(null);
    const root = document.documentElement;
    if (document.fullscreenElement || fullscreenPending.current) return;
    if (typeof root.requestFullscreen !== "function") {
      setFullscreenNotice(
        "Tela cheia indisponível neste navegador. O modo criança continua ativo.",
      );
      return;
    }
    fullscreenPending.current = true;
    try {
      // Invoke before any await: browsers require the responsible adult's gesture.
      const request = root.requestFullscreen();
      void Promise.resolve(request)
        .then(() => {
          if (document.fullscreenElement !== root) return;
          if (!mounted.current || !fullscreenWanted.current) {
            if (document.exitFullscreen)
              void Promise.resolve(document.exitFullscreen()).catch(() => {});
            return;
          }
          fullscreenOwned.current = true;
          setIsFullscreen(true);
        })
        .catch(() => {
          if (mounted.current && fullscreenWanted.current) {
            setFullscreenNotice(
              "Não foi possível abrir a tela cheia. O modo criança continua ativo.",
            );
          }
        })
        .finally(() => {
          fullscreenPending.current = false;
        });
    } catch {
      fullscreenPending.current = false;
      setFullscreenNotice(
        "Não foi possível abrir a tela cheia. O modo criança continua ativo.",
      );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === document.documentElement);
      if (!document.fullscreenElement) fullscreenOwned.current = false;
      // Esc or browser controls only change fullscreen, never the child lock.
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      mounted.current = false;
      revision.current++;
      verifier.current = null;
      releaseFullscreen();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [releaseFullscreen]);

  const start = useCallback(() => {
    if (active.current || busy.current) return;
    if (!verifier.current) {
      setDialogMode("setup");
      return;
    }
    active.current = true;
    setIsChildMode(true);
    requestFullscreen();
  }, [requestFullscreen]);

  const requestUnlock = useCallback(() => {
    if (active.current) setDialogMode("unlock");
  }, []);

  const cancelDialog = useCallback(() => {
    if (!busy.current) setDialogMode(null);
  }, []);

  const submitPin = useCallback(
    async (pin: string): Promise<boolean> => {
      if (busy.current || !dialogMode || !isValidPin(pin)) return false;
      const current = ++revision.current;
      busy.current = true;
      try {
        if (dialogMode === "setup") {
          requestFullscreen();
          const credential = await createPinVerifier(pin);
          if (!mounted.current || revision.current !== current) return false;
          verifier.current = credential;
          active.current = true;
          setIsChildMode(true);
          setDialogMode(null);
          return true;
        }
        if (!verifier.current || !(await verifyPin(pin, verifier.current)))
          return false;
        if (!mounted.current || revision.current !== current) return false;
        active.current = false;
        setIsChildMode(false);
        setDialogMode(null);
        releaseFullscreen();
        return true;
      } catch {
        if (dialogMode === "setup") releaseFullscreen();
        throw new Error("Não foi possível verificar o PIN.");
      } finally {
        busy.current = false;
      }
    },
    [dialogMode, releaseFullscreen, requestFullscreen],
  );

  return {
    isChildMode,
    isFullscreen,
    fullscreenNotice,
    dialogMode,
    start,
    requestUnlock,
    cancelDialog,
    submitPin,
  };
}
