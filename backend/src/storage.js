import fs from "fs";
import path from "path";
import AWS from "aws-sdk";

const hasS3 = Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);

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

export async function storeImage({ buffer, contentType, key }) {
  if (s3Client) {
    await s3Client
      .putObject({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: "public-read"
      })
      .promise();

    const baseUrl = process.env.S3_PUBLIC_BASE_URL;
    if (!baseUrl) {
      return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`;
    }
    return `${baseUrl.replace(/\/$/, "")}/${key}`;
  }

  const uploadDir = process.env.UPLOAD_DIR || "uploads";
  const fullDir = path.join(process.cwd(), uploadDir);
  if (!fs.existsSync(fullDir)) fs.mkdirSync(fullDir, { recursive: true });

  const filePath = path.join(fullDir, key);
  const fileDir = path.dirname(filePath);
  if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  const publicUploadDir = uploadDir.replace(/^\/+/, "");
  return `/${publicUploadDir}/${key}`;
}
