import { UtensilsCrossed } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Container de imagem. Enquanto não houver `src` (image_url do banco/R2),
 * mostra um placeholder estilizado com a dimensão recomendada — basta trocar
 * por `src={product.imageUrl}` depois que o layout já está pronto.
 */
export function ImageFrame({
  src,
  alt,
  label = "Foto do Lanche",
  hint = "400x300",
  ratio = "4 / 3",
  fill = false,
  tint,
  className,
  imageClassName,
}: {
  src?: string | null;
  alt: string;
  label?: string;
  hint?: string;
  /** Proporção fixa (largura / altura). Ignorada quando `fill` é true. */
  ratio?: string;
  /** Preenche 100% do pai (ex: dentro de um flex-1) em vez de travar `ratio`. */
  fill?: boolean;
  /** Cor de fundo do placeholder, imitando o fundo colorido da foto real do destino. */
  tint?: string;
  className?: string;
  imageClassName?: string;
}) {
  const showBorder = !src && !tint;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl",
        fill ? "h-full" : undefined,
        src ? "bg-ink/10" : "bg-ink/5",
        showBorder && "border-2 border-dashed border-slate-400/60",
        className,
      )}
      style={{
        ...(fill ? {} : { aspectRatio: ratio }),
        ...(!src && tint ? { backgroundColor: tint } : {}),
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          className={cn("h-full w-full object-cover", imageClassName)}
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center",
            tint ? "text-white/90" : "text-ink/45",
          )}
        >
          <UtensilsCrossed className="h-8 w-8" strokeWidth={1.5} />
          <span className="text-[11px] font-bold leading-tight">{label}</span>
          <span className="text-[10px] font-medium tabular-nums opacity-80">({hint})</span>
        </div>
      )}
    </div>
  );
}
