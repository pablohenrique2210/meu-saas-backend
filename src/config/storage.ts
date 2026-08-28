import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { accessSync, constants, mkdirSync, statSync } from 'node:fs';

export function uploadsRootPath() {
  const configuredPath = process.env.UPLOADS_DIR?.trim();
  const railwayMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();

  if (railwayMountPath) {
    const mountRoot = resolve(railwayMountPath);
    if (configuredPath) {
      const requestedPath = resolve(configuredPath);
      const relativePath = relative(mountRoot, requestedPath);
      if (
        relativePath === '' ||
        (relativePath !== '..' &&
          !relativePath.startsWith(`..${sep}`) &&
          !isAbsolute(relativePath))
      ) {
        return requestedPath;
      }
    }
    return join(mountRoot, 'uploads');
  }

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
  return `/api/media/${encodeURIComponent(filename)}`;
}
