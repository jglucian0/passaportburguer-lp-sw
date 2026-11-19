import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";

import { appUrl } from "@/infra/whatsapp/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Só fotos do cardápio (caminho fixo dentro de /public): nada de URL livre. */
const ALLOWED_PATH = /^\/(lanches|combos|bebidas|molhos)\/[a-z0-9][a-z0-9\-_/]*\.webp$/i;

/**
 * Foto do lanche em JPEG para o WhatsApp (a Meta só aceita JPEG/PNG no topo das mensagens, e as fotos
 * do site são WebP). Pública de propósito: quem busca é o servidor da Meta, sem login.
 */
export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("p") ?? "";
  if (!ALLOWED_PATH.test(path) || path.includes("..")) {
    return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });
  }
  const source = await fetch(`${appUrl()}${path}`, { cache: "force-cache" }).catch(() => null);
  if (!source?.ok) return NextResponse.json({ error: "Foto não encontrada." }, { status: 404 });

  const jpeg = await sharp(Buffer.from(await source.arrayBuffer()))
    .rotate()
    .resize({ width: 1080, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();

  return new NextResponse(new Uint8Array(jpeg), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400, s-maxage=86400" },
  });
}
