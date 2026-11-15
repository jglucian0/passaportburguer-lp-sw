import { useId } from "react";

import { cn } from "@/lib/utils";

export type StampData = {
  /** Texto curvo superior. */
  top: string;
  /** Texto da faixa central. */
  middle: string;
  /** Texto curvo inferior. */
  bottom: string;
};

function arcFontSize(text: string): number {
  if (text.length > 12) return 11;
  if (text.length > 8) return 14;
  return 17;
}

/** Carimbos reais (PNG) por id de destino. Destinos ausentes usam o SVG. Adicione novos aqui. */
const STAMP_IMAGES: Record<string, string> = {
  "buenos-aires": "/stamps/buenosaires-stamp.png",
  mexico: "/stamps/mexico-stamp.png",
  "st-louis": "/stamps/stlouis-stamp.png",
  tokyo: "/stamps/tokyo-stamp.png",
};

/** Carimbo de passaporte: PNG real quando existe para o destino, senão SVG (cor via `currentColor`). */
export function PassportStamp({
  stamp,
  destinationId,
  size = 120,
  className,
  distressed = true,
}: {
  stamp: StampData;
  destinationId?: string;
  size?: number;
  className?: string;
  distressed?: boolean;
}) {
  const image = destinationId ? STAMP_IMAGES[destinationId] : undefined;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const topId = `st-top-${uid}`;
  const bottomId = `st-bot-${uid}`;
  const filterId = `st-fx-${uid}`;

  const middleSize = stamp.middle.length > 9 ? 15 : stamp.middle.length > 6 ? 19 : 24;
  const bottomSize = arcFontSize(stamp.bottom);

  if (image) {
    // Versão 256px para usos pequenos: reduzir 1700px -> 50px direto no navegador
    // causa serrilhado/embaçado, ainda mais quando a animação gira o carimbo.
    const src = size <= 128 ? image.replace("/stamps/", "/stamps/256/") : image;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={`Carimbo ${stamp.middle}`}
        draggable={false}
        className={cn("select-none object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      role="img"
      aria-label={`Carimbo ${stamp.middle}`}
      className={cn("select-none", className)}
    >
      <defs>
        <path id={topId} d="M 30 100 A 70 70 0 0 1 170 100" />
        <path id={bottomId} d="M 22 100 A 78 78 0 0 0 178 100" />
        <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4" result="noise" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 -2.4 1.75"
            result="holes"
          />
          <feComposite in="SourceGraphic" in2="holes" operator="in" />
        </filter>
      </defs>

      <g filter={distressed ? `url(#${filterId})` : undefined} fill="currentColor">
        <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="4" />
        <circle
          cx="100"
          cy="100"
          r="87"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="70 5 24 7"
        />

        <text fontSize={arcFontSize(stamp.top)} fontWeight={800} letterSpacing={1.5} textAnchor="middle">
          <textPath href={`#${topId}`} startOffset="50%">
            {stamp.top}
          </textPath>
        </text>

        <rect x="30" y="80" width="140" height="40" fill="none" stroke="currentColor" strokeWidth="3" />
        <line x1="30" y1="85" x2="170" y2="85" stroke="currentColor" strokeWidth="1" />
        <line x1="30" y1="115" x2="170" y2="115" stroke="currentColor" strokeWidth="1" />
        <text
          x="100"
          y={100 + middleSize * 0.35}
          fontSize={middleSize}
          fontWeight={900}
          letterSpacing={1}
          textAnchor="middle"
        >
          {stamp.middle}
        </text>

        <text fontSize={bottomSize} fontWeight={700} letterSpacing={1.5} textAnchor="middle">
          <textPath href={`#${bottomId}`} startOffset="50%">
            {stamp.bottom}
          </textPath>
        </text>
      </g>
    </svg>
  );
}
