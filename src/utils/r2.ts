import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env.js";
import { randomBytes } from "crypto";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadToR2(
  filename: string,
  content: string | Buffer,
  contentType = "text/plain"
): Promise<
  | { success: true; downloadUrl: string; size: number }
  | { success: false; error: string }
> {
  try {
    const key = `bmo/${randomBytes(16).toString("hex")}_${filename}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
        Body: content,
        ContentType: contentType,
      })
    );

    const downloadUrl = env.R2_PUBLIC_URL
      ? `${env.R2_PUBLIC_URL}/${key}`
      : await getSignedUrl(
          r2,
          new GetObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: key,
          }),
          { expiresIn: 7 * 24 * 60 * 60 }
        );

    return {
      success: true,
      downloadUrl,
      size: Buffer.byteLength(content),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
