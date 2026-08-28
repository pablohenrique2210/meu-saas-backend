import { join, resolve } from 'node:path';
import { accessSync, constants, mkdirSync, statSync } from 'node:fs';

export function uploadsRootPath() {
  const configuredPath =
    process.env.UPLOADS_DIR?.trim() ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();

  return resolve(configuredPath || join(process.cwd(), 'uploads'));
}

export function ensureUploadsRootPath() {
  const uploadPath = uploadsRootPath();
  mkdirSync(uploadPath, { recursive: true });
  if (!statSync(uploadPath).isDirectory()) {
    throw new Error(`O caminho de uploads não é uma pasta: ${uploadPath}`);
  }
  accessSync(uploadPath, constants.R_OK | constants.W_OK);
  return uploadPath;
}

export function publicUploadUrl(filename: string) {
  const fallbackPort = process.env.PORT ?? '4000';
  const configuredUrl = process.env.API_PUBLIC_URL?.trim();
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const rawPublicUrl =
    configuredUrl ||
    (railwayDomain ? railwayDomain : `http://localhost:${fallbackPort}`);
  const apiPublicUrl = (
    /^https?:\/\//i.test(rawPublicUrl)
      ? rawPublicUrl
      : `${/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(rawPublicUrl) ? 'http' : 'https'}://${rawPublicUrl}`
  ).replace(/\/$/, '');

  return `${apiPublicUrl}/uploads/${encodeURIComponent(filename)}`;
}
