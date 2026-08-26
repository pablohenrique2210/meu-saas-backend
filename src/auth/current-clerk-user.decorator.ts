import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ClerkAuthenticatedRequest } from './clerk-auth.guard';

export const CurrentClerkUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context
      .switchToHttp()
      .getRequest<ClerkAuthenticatedRequest>();
    return request.auth?.userId as string;
  },
);
