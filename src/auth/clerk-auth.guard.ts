import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { getClerkAuthorizedParties } from '../config/frontend-origins';
import { verifyUploadSessionToken } from './upload-session-token';

export interface ClerkAuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  auth?: {
    userId: string;
  };
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<ClerkAuthenticatedRequest>();
    const uploadToken = request.headers['x-upload-token'];

    if (
      request.method === 'POST' &&
      request.originalUrl
        ?.split('?')[0]
        .endsWith('/api/courses/upload/chunk') &&
      typeof uploadToken === 'string'
    ) {
      try {
        const uploadSession = verifyUploadSessionToken(uploadToken);
        if (!uploadSession) {
          throw new UnauthorizedException('Invalid upload session.');
        }
        request.auth = { userId: uploadSession.userId };
        return true;
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        throw new UnauthorizedException('Invalid upload session.');
      }
    }

    const authHeader = request.headers.authorization;

    if (typeof authHeader !== 'string') {
      throw new UnauthorizedException('Bearer token is required.');
    }

    const [scheme, token] = authHeader.trim().split(/\s+/);

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('A valid Bearer token is required.');
    }

    const jwtKey = process.env.CLERK_JWT_KEY?.replace(/\\n/g, '\n').trim();
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();

    if (!jwtKey && !secretKey) {
      throw new UnauthorizedException('Authentication is not configured.');
    }

    const requestOrigin = request.headers.origin;
    const authorizedParties = getClerkAuthorizedParties(
      typeof requestOrigin === 'string' ? requestOrigin : undefined,
    );

    try {
      const decodedToken = await verifyToken(token, {
        ...(jwtKey ? { jwtKey } : { secretKey }),
        authorizedParties,
      });

      request.auth = { userId: decodedToken.sub };
      return true;
    } catch (error) {
      const reason =
        typeof error === 'object' && error !== null && 'reason' in error
          ? String(error.reason)
          : error instanceof Error
            ? error.name
            : 'unknown';
      const message = error instanceof Error ? error.message : 'Unknown error';

      this.logger.warn(`Clerk token rejected (${reason}): ${message}`);
      throw new UnauthorizedException('Invalid or expired token.');
    }
  }
}
