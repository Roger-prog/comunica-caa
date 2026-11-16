import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { validBoardPhotoBlob } from "../lib/patientBoardPhoto";

export function usePatientPhotoUrl(path: string | null) {
  const [asset, setAsset] = useState<{ path: string; url: string } | null>(null);
  useEffect(() => {
    if (!path || !supabase) return;
    const client = supabase;
    const controller = new AbortController();
    let ownedUrl: string | null = null;
    void (async () => {
      const { data } = await client.auth.getSession();
      if (!data.session || controller.signal.aborted) return;
      const response = await fetch("/api/board-photo", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ path }),
        signal: controller.signal,
      });
      if (!response.ok) return;
      const image = await response.blob();
      if (controller.signal.aborted || !validBoardPhotoBlob(image)) return;
      ownedUrl = URL.createObjectURL(image);
      setAsset({ path, url: ownedUrl });
    })().catch(() => {
      // An unavailable or revoked image falls back to the card's text.
    });
    return () => {
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      setAsset(null);
    };
  }, [path]);
  return path && asset?.path === path ? asset.url : null;
}

export function PatientPhoto({ path, alt, className, fallback }: {
  path: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    if (!node.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "120px" });
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [visible]);
  const imageUrl = usePatientPhotoUrl(visible ? path : null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span ref={node} className="inline-flex min-h-8 min-w-8 items-center justify-center">
      {imageUrl && imageUrl !== failedUrl
        ? <img src={imageUrl} alt={alt} className={className} decoding="async" onError={() => setFailedUrl(imageUrl)} />
        : fallback ?? <span className="sr-only">Foto indisponível</span>}
    </span>
  );
}
