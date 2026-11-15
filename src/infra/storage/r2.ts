import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
const PRESIGN_EXPIRES_SECONDS = 60 * 5;

export type PresignedUpload = {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  contentType: AllowedImageType;
  expiresInSeconds: number;
};

export type CreatePresignedUploadInput = {
  tenantId: string;
  contentType: string;
  sizeBytes: number;
  folder?: "products" | "logo";
};

let client: S3Client | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida.`);
  return value;
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

export function isAllowedImageType(value: string): value is AllowedImageType {
  return value in ALLOWED_IMAGE_TYPES;
}

export async function createPresignedUpload(
  input: CreatePresignedUploadInput,
): Promise<PresignedUpload> {
  if (!isAllowedImageType(input.contentType)) {
    throw new Error("Tipo de imagem não permitido.");
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_IMAGE_BYTES) {
    throw new Error("Tamanho de imagem inválido (máximo 5MB).");
  }

  const extension = ALLOWED_IMAGE_TYPES[input.contentType];
  const key = `${input.tenantId}/${input.folder ?? "products"}/${crypto.randomUUID()}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: requireEnv("R2_BUCKET_NAME"),
    Key: key,
    ContentType: input.contentType,
    ContentLength: input.sizeBytes,
  });

  const uploadUrl = await getSignedUrl(getClient(), command, {
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  });

  const publicBase = requireEnv("R2_PUBLIC_URL").replace(/\/+$/, "");

  return {
    uploadUrl,
    key,
    publicUrl: `${publicBase}/${key}`,
    contentType: input.contentType,
    expiresInSeconds: PRESIGN_EXPIRES_SECONDS,
  };
}
