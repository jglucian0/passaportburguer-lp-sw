import { Plane } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Glifo de hambúrguer (usado dentro dos selos)                        */
/* ------------------------------------------------------------------ */

function BurgerGlyph({ scale = 1 }: { scale?: number }) {
  return (
    <g transform={`translate(100 100) scale(${scale}) translate(-100 -100)`}>
      <path d="M 70 92 C 70 74, 130 74, 130 92 Z" fill="currentColor" />
      <circle cx="88" cy="83" r="2.4" fill="#ffffff" fillOpacity="0.55" />
      <circle cx="102" cy="79" r="2.4" fill="#ffffff" fillOpacity="0.55" />
      <circle cx="115" cy="84" r="2.4" fill="#ffffff" fillOpacity="0.55" />
      <rect x="69" y="96" width="62" height="7" rx="3.5" fill="currentColor" />
      <path
        d="M 69 108 C 80 101, 90 115, 100 108 C 110 101, 120 115, 131 108 L 131 115 L 69 115 Z"
        fill="currentColor"
      />
      <path d="M 70 120 C 70 134, 130 134, 130 120 Z" fill="currentColor" />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Carimbos decorativos                                                */
/* ------------------------------------------------------------------ */

/** Carimbo circular com texto curvo em cima e embaixo. */
export function CircleStamp({
  id,
  topText,
  centerText,
  bottomText,
  size = 160,
  className,
}: {
  id: string;
  topText: string;
  centerText?: string;
  bottomText: string;
  size?: number;
  className?: string;
}) {
  const topPath = `cs-top-${id}`;
  const bottomPath = `cs-bot-${id}`;
  const centerSize =
    centerText && centerText.length > 10 ? 16 : centerText && centerText.length > 7 ? 19 : 24;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("select-none", className)}
    >
      <defs>
        <path id={topPath} d="M 32 100 A 68 68 0 0 1 168 100" />
        <path id={bottomPath} d="M 24 100 A 76 76 0 0 0 176 100" />
      </defs>

      <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle
        cx="100"
        cy="100"
        r="86"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="64 6 20 8"
      />

      <text fill="currentColor" fontSize="16" fontWeight={700} letterSpacing="2" textAnchor="middle">
        <textPath href={`#${topPath}`} startOffset="50%">
          {topText}
        </textPath>
      </text>

      {centerText ? (
        <>
          <line x1="34" y1="84" x2="166" y2="84" stroke="currentColor" strokeWidth="2" />
          <line x1="34" y1="118" x2="166" y2="118" stroke="currentColor" strokeWidth="2" />
          <text
            x="100"
            y={100 + centerSize * 0.35}
            fill="currentColor"
            fontSize={centerSize}
            fontWeight={800}
            letterSpacing="1.5"
            textAnchor="middle"
          >
            {centerText}
          </text>
        </>
      ) : (
        <g fill="currentColor">
          <BurgerGlyph scale={0.8} />
        </g>
      )}

      <text fill="currentColor" fontSize="15" fontWeight={700} letterSpacing="2" textAnchor="middle">
        <textPath href={`#${bottomPath}`} startOffset="50%">
          {bottomText}
        </textPath>
      </text>
    </svg>
  );
}

/** Retângulo inclinado "APROVADO". */
export function ApprovedStamp({
  label = "APROVADO",
  width = 110,
  className,
}: {
  label?: string;
  width?: number;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 200 72" width={width} aria-hidden="true" className={cn("select-none", className)}>
      <rect x="5" y="5" width="190" height="62" rx="6" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect
        x="14"
        y="14"
        width="172"
        height="44"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.7"
      />
      <text
        x="100"
        y="48"
        fill="currentColor"
        fontSize="30"
        fontWeight={800}
        letterSpacing="3"
        textAnchor="middle"
      >
        {label}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Código de barras, avião e mapa-múndi                                */
/* ------------------------------------------------------------------ */

const BAR_WIDTHS = [3, 1, 2, 1, 1, 3, 2, 1, 1, 2, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2];

/** Código de barras decorativo. `vertical` empilha as barras (canhoto de ticket). */
export function Barcode({
  vertical = false,
  className,
}: {
  vertical?: boolean;
  className?: string;
}) {
  let cursor = 0;
  const bars: ReactNode[] = [];

  for (const [index, w] of BAR_WIDTHS.entries()) {
    const offset = cursor;
    cursor += w + 2;
    if (index % 2 !== 0) continue;

    bars.push(
      vertical ? (
        <rect key={index} x="0" y={offset} width="40" height={w} fill="currentColor" />
      ) : (
        <rect key={index} x={offset} y="0" width={w} height="40" fill="currentColor" />
      ),
    );
  }

  return (
    <svg
      viewBox={vertical ? `0 0 40 ${cursor}` : `0 0 ${cursor} 40`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("select-none", className)}
    >
      {bars}
    </svg>
  );
}

/** Ícone de avião com rastro tracejado curvo (nariz para o canto superior direito). */
export function PlaneTrail({
  width = 120,
  flip = false,
  rotate = 0,
  className,
}: {
  width?: number;
  flip?: boolean;
  /** Rotação em graus, para espalhar rastros em ângulos diferentes. */
  rotate?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 80"
      width={width}
      aria-hidden="true"
      className={cn("select-none", className)}
      style={
        flip || rotate
          ? { transform: `rotate(${rotate}deg)${flip ? " scaleX(-1)" : ""}` }
          : undefined
      }
    >
      <path
        d="M 4 74 C 26 74, 50 62, 70 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeDasharray="4 6"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />
      <Plane x={62} y={14} width={30} height={30} strokeWidth={1.75} />
    </svg>
  );
}
