import { NextResponse, type NextRequest } from "next/server";

import { presignedUploadRequestSchema } from "@/core/schemas/admin";
import { getActiveAdminSession as getAdminSession } from "@/infra/auth/active-session";
import { createPresignedUpload } from "@/infra/storage/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = presignedUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const upload = await createPresignedUpload({
      tenantId: session.tenantId,
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
      folder: parsed.data.folder,
    });
    return NextResponse.json(upload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Falha ao gerar presigned URL", error);
    return NextResponse.json({ error: "Não foi possível gerar a URL de upload." }, { status: 500 });
  }
}
