import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isPlatformAdministrator } from '../auth/company-scope';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  findAvailable(manager: User) {
    return this.prisma.company.findMany({
      where: isPlatformAdministrator(manager)
        ? undefined
        : { id: manager.companyId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        _count: { select: { users: true, employeeInvites: true } },
      },
    });
  }
}
