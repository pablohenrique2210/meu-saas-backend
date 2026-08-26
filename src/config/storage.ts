import { join, resolve } from 'node:path';

export function uploadsRootPath() {
  return resolve(process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads'));
}

export function publicUploadUrl(filename: string) {
  const fallbackPort = process.env.PORT ?? '4000';
  const apiPublicUrl = (
    process.env.API_PUBLIC_URL ?? `http://localhost:${fallbackPort}`
  ).replace(/\/$/, '');

  return `${apiPublicUrl}/uploads/${encodeURIComponent(filename)}`;
}
