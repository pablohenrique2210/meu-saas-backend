import { createHmac, timingSafeEqual } from 'node:crypto';

interface UploadSessionPayload {
  uploadId: string;
  userId: string;
  expiresAt: number;
}

const uploadIdPattern = /^[a-zA-Z0-9-]{8,80}$/;

function secret() {
  const value =
    process.env.UPLOAD_TOKEN_SECRET?.trim() ||
    process.env.CLERK_SECRET_KEY?.trim();
  if (!value) throw new Error('Upload session secret is not configured.');
  return value;
}

function signature(encodedPayload: string) {
  return createHmac('sha256', secret())
    .update(encodedPayload)
    .digest('base64url');
}

export function issueUploadSessionToken(uploadId: string, userId: string) {
  const payload: UploadSessionPayload = {
    uploadId,
    userId,
    expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyUploadSessionToken(token: string) {
  const [encodedPayload, suppliedSignature, extra] = token.split('.');
  if (!encodedPayload || !suppliedSignature || extra) return null;

  const expectedSignature = signature(encodedPayload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<UploadSessionPayload>;
    if (
      typeof payload.uploadId !== 'string' ||
      !uploadIdPattern.test(payload.uploadId) ||
      typeof payload.userId !== 'string' ||
      !payload.userId ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload as UploadSessionPayload;
  } catch {
    return null;
  }
}
