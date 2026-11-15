"use client";

import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/** Upload direto ao Cloudflare R2 via Presigned URL (o bucket precisa de CORS liberando PUT). */
export function ImageUpload({
  value,
  onChange,
  folder = "products",
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  folder?: "products" | "logo";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError("Use uma imagem JPG, PNG, WEBP ou AVIF.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("A imagem deve ter no máximo 5MB.");
      return;
    }

    setUploading(true);
    try {
      const presign = await fetch("/api/upload/presigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, sizeBytes: file.size, folder }),
      });
      if (!presign.ok) throw new Error("presign");

      const { uploadUrl, publicUrl } = (await presign.json()) as { uploadUrl: string; publicUrl: string };

      const upload = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("upload");

      onChange(publicUrl);
    } catch {
      setError("Falha no upload da imagem. Verifique a configuração do R2 e tente novamente.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface-2">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Pré-visualização" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-6 w-6 text-muted" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {value ? "Trocar imagem" : "Enviar imagem"}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={() => onChange(null)}>
              <Trash2 className="h-4 w-4" /> Remover
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
