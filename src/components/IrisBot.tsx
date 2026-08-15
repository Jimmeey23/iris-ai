"use client";

import { useEffect, useRef, useState } from "react";

type Mood = "idle" | "thinking" | "happy" | "alert" | "listening";

/**
 * Playful SVG assistant. Eyes track the cursor, blinks on a timer and
 * changes expression with the conversation state.
 */
export default function IrisBot({
  mood = "idle",
  size = 76,
  onPoke,
}: {
  mood?: Mood;
  size?: number;
  onPoke?: () => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [pupil, setPupil] = useState({ x: 0, y: 0 });
  const [poked, setPoked] = useState(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = ref.current?.getBoundingClientRect();
      if (!el) return;
      const cx = el.left + el.width / 2;
      const cy = el.top + el.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const max = 2.6;
      setPupil({ x: (dx / dist) * Math.min(max, dist / 40), y: (dy / dist) * Math.min(max, dist / 60) });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const accent = "var(--accent)";
  const isThinking = mood === "thinking";
  const isAlert = mood === "alert";
  const isHappy = mood === "happy" || poked;

  return (
    <button
      type="button"
      aria-label="Iris assistant"
      onClick={() => {
        setPoked(true);
        onPoke?.();
        setTimeout(() => setPoked(false), 1400);
      }}
      className="relative shrink-0 outline-none"
      style={{ width: size, height: size }}
    >
      <svg
        ref={ref}
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={mood === "idle" ? "animate-floaty" : undefined}
      >
        <defs>
          <linearGradient id="botBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={accent} />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
          <radialGradient id="botGlow">
            <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="50" cy="54" r="44" fill="url(#botGlow)" />

        {/* antenna */}
        <line x1="50" y1="20" x2="50" y2="10" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />
        <circle
          cx="50"
          cy="8"
          r="4"
          fill={isAlert ? "var(--danger)" : accent}
          className={isThinking ? "dot-blink" : undefined}
        />

        {/* head */}
        <rect x="18" y="20" width="64" height="52" rx="19" fill="url(#botBody)" />
        <rect x="18" y="20" width="64" height="52" rx="19" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.2" />

        {/* visor */}
        <rect x="26" y="31" width="48" height="30" rx="15" fill="rgba(4,12,26,0.82)" />

        {/* eyes */}
        <g transform={`translate(${pupil.x} ${pupil.y})`}>
          {isHappy ? (
            <>
              <path d="M36 47 q4.5 -6 9 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M55 47 q4.5 -6 9 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
            </>
          ) : isThinking ? (
            <>
              <circle cx="40.5" cy="46" r="3.6" fill="#fff" className="dot-blink" />
              <circle cx="59.5" cy="46" r="3.6" fill="#fff" className="dot-blink" style={{ animationDelay: "0.2s" }} />
            </>
          ) : (
            <>
              <ellipse cx="40.5" cy="46" rx="4.2" ry="5" fill="#fff" className="bot-eye" />
              <ellipse cx="59.5" cy="46" rx="4.2" ry="5" fill="#fff" className="bot-eye" />
              <circle cx="42" cy="44.4" r="1.2" fill="rgba(0,0,0,0.35)" />
              <circle cx="61" cy="44.4" r="1.2" fill="rgba(0,0,0,0.35)" />
            </>
          )}
        </g>

        {/* mouth */}
        {isAlert ? (
          <rect x="45" y="55" width="10" height="2.6" rx="1.3" fill="rgba(255,255,255,0.55)" />
        ) : (
          <path
            d={isHappy ? "M43 54 q7 6 14 0" : "M45 55.5 q5 3 10 0"}
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* body */}
        <rect x="30" y="72" width="40" height="18" rx="9" fill="url(#botBody)" opacity="0.9" />
        <circle cx="50" cy="81" r="4" fill="rgba(255,255,255,0.75)" className={isThinking ? "spin-slow" : undefined} />

        {/* arms */}
        <path d="M18 56 q-8 6 -6 14" stroke={accent} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />
        <path d="M82 56 q8 6 6 14" stroke={accent} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />
      </svg>

      {poked && (
        <span
          className="animate-pop absolute -right-1 -top-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold text-white"
          style={{ background: "var(--accent)" }}
        >
          hi!
        </span>
      )}
    </button>
  );
}
