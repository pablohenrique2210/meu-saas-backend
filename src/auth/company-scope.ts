import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { getRhAllowedEmails } from './rh-access';

export function isPlatformAdministrator(
  user: Pick<User, 'email' | 'role'>,
) {
  const platformOwnerEmail = getRhAllowedEmails()[0];
  return (
    user.role === Role.ADMIN &&
    Boolean(platformOwnerEmail) &&
    user.email.trim().toLowerCase() === platformOwnerEmail
  );
}

export function resolveManagedCompanyId(
  manager: Pick<User, 'companyId' | 'email' | 'role'>,
  requestedCompanyId?: string,
) {
  if (!requestedCompanyId || requestedCompanyId === manager.companyId) {
    return manager.companyId;
  }

  if (isPlatformAdministrator(manager)) return requestedCompanyId;

  throw new ForbiddenException(
    'Você não possui permissão para consultar outra empresa.',
  );
}
