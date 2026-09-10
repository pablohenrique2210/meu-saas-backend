import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';

export function isPlatformAdministrator(user: Pick<User, 'role'>) {
  return user.role === Role.ADMIN;
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
