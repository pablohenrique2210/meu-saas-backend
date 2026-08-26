import { join, resolve } from 'node:path';

export function uploadsRootPath() {
  const configuredPath =
    process.env.UPLOADS_DIR?.trim() ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();

  return resolve(configuredPath || join(process.cwd(), 'uploads'));
}

export function publicUploadUrl(filename: string) {
  const fallbackPort = process.env.PORT ?? '4000';
  const configuredUrl = process.env.API_PUBLIC_URL?.trim();
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  const apiPublicUrl = (
    configuredUrl ||
    (railwayDomain ? `https://${railwayDomain}` : `http://localhost:${fallbackPort}`)
  ).replace(/\/$/, '');

  return `${apiPublicUrl}/uploads/${encodeURIComponent(filename)}`;
}
