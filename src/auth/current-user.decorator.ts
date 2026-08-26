import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';

export interface AuthenticatedUserRequest {
  currentUser?: User;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();
    return request.currentUser as User;
  },
);
