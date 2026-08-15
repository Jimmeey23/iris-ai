"use client";

import { useEffect, useRef, useState } from "react";
import type { EmbedKind } from "@/lib/fillout";

const SCRIPTS: Record<EmbedKind, string> = {
  "fillout-v1": "https://server.fillout.com/embed/v1/",
  "zite-v2": "https://server.fillout.com/embed/v2-zite/",
};

const loaded = new Set<string>();

/** Loads a Fillout embed script once per page and re-runs it on mount. */
function useEmbedScript(kind: EmbedKind, onReady: () => void) {
  useEffect(() => {
    const src = SCRIPTS[kind];
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);

    if (existing && loaded.has(src)) {
      // Re-inject so the script re-scans the DOM for the newly mounted target.
      existing.remove();
      loaded.delete(src);
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      loaded.add(src);
      onReady();
    };
    document.body.appendChild(script);

    return () => {
      script.onload = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
}

export default function FilloutEmbed({
  embedId,
  kind,
  height,
  params,
}: {
  embedId: string;
  kind: EmbedKind;
  height: number;
  /** Passed through to the form as URL parameters. */
  params?: Record<string, string>;
}) {
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEmbedScript(kind, () => setReady(true));

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, [embedId]);

  const attrs: Record<string, string> =
    kind === "zite-v2"
      ? {
          "data-zite-id": embedId,
          "data-zite-embed-type": "standard",
          "data-zite-inherit-parameters": "",
        }
      : {
          "data-fillout-id": embedId,
          "data-fillout-embed-type": "standard",
          "data-fillout-inherit-parameters": "",
          "data-fillout-dynamic-resize": "",
        };

  for (const [k, v] of Object.entries(params ?? {})) {
    attrs[`data-fillout-${k}`] = v;
  }

  return (
    <div className="relative">
      {!ready && (
        <div
          className="absolute inset-x-0 top-0 z-10 flex items-center justify-center rounded-b-3xl"
          style={{ height, background: "var(--surface)" }}
        >
          <div className="w-full max-w-[420px] space-y-2.5 px-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="shimmer rounded-xl"
                style={{ height: i === 0 ? 30 : 16, background: "var(--surface-3)", animationDelay: `${i * 90}ms` }}
              />
            ))}
            <p className="pt-2 text-center text-[10.5px] uppercase tracking-[0.18em] txt-3">
              {slow ? "Still loading the form…" : "Loading form"}
            </p>
          </div>
        </div>
      )}
      <div
        ref={hostRef}
        key={embedId}
        style={{ width: "100%", height }}
        {...attrs}
      />
    </div>
  );
}
