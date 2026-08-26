import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthenticatedUserRequest } from './current-user.decorator';
import { getRhAllowedEmails, hasRhEmailAccess } from './rh-access';

@Injectable()
export class RhAccessGuard implements CanActivate {
  private readonly logger = new Logger(RhAccessGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();

    if (getRhAllowedEmails().length === 0) {
      this.logger.error(
        'RH_ALLOWED_EMAILS is empty. RH access is closed until it is configured.',
      );
    }

    if (!hasRhEmailAccess(request.currentUser)) {
      throw new ForbiddenException(
        'Este usuário não possui autorização para acessar a área de RH.',
      );
    }

    return true;
  }
}
