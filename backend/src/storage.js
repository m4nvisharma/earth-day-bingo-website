import fs from "fs";
import path from "path";
import AWS from "aws-sdk";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const hasS3 = Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

let supabaseClient = null;
if (hasSupabase) {
  supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let s3Client = null;
if (hasS3) {
  s3Client = new AWS.S3({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "auto",
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: Boolean(process.env.S3_ENDPOINT)
  });
}

const MAX_DIMENSION = Number(process.env.IMAGE_MAX_WIDTH || 1600);
const IMAGE_QUALITY = Number(process.env.IMAGE_QUALITY || 75);
const IMAGE_FORMAT = (process.env.IMAGE_FORMAT || "jpeg").toLowerCase();

async function optimizeImage(buffer) {
  let transformer = sharp(buffer).rotate().resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true
  });

  if (IMAGE_FORMAT === "webp") {
    transformer = transformer.webp({ quality: IMAGE_QUALITY });
    return { buffer: await transformer.toBuffer(), contentType: "image/webp", extension: "webp" };
  }

  transformer = transformer.jpeg({ quality: IMAGE_QUALITY, mozjpeg: true });
  return { buffer: await transformer.toBuffer(), contentType: "image/jpeg", extension: "jpg" };
}

export async function storeImage({ buffer, contentType, key }) {
  const optimized = await optimizeImage(buffer);
  const normalizedKey = key.replace(/\.[a-zA-Z0-9]+$/, `.${optimized.extension}`);

  if (supabaseClient) {
    const bucket = process.env.SUPABASE_BUCKET || "bingo-images";
    const { error } = await supabaseClient.storage
      .from(bucket)
      .upload(normalizedKey, optimized.buffer, {
        contentType: optimized.contentType,
        upsert: true
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(normalizedKey);
    return data.publicUrl;
  }

  if (s3Client) {
    await s3Client
      .putObject({
        Bucket: process.env.S3_BUCKET,
        Key: normalizedKey,
        Body: optimized.buffer,
        ContentType: optimized.contentType,
        ACL: "public-read"
      })
      .promise();

    const baseUrl = process.env.S3_PUBLIC_BASE_URL;
    if (!baseUrl) {
      return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${normalizedKey}`;
    }
    return `${baseUrl.replace(/\/$/, "")}/${normalizedKey}`;
  }

  const uploadDir = process.env.UPLOAD_DIR || "uploads";
  const fullDir = path.join(process.cwd(), uploadDir);
  if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

  const filePath = path.join(fullDir, normalizedKey);
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
  fs.writeFileSync(filePath, optimized.buffer);
  const publicUploadDir = uploadDir.replace(/^\/+/, "");
  return `/${publicUploadDir}/${normalizedKey}`;
}
