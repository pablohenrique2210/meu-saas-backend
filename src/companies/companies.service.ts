import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isPlatformAdministrator } from '../auth/company-scope';
import { CreateCompanyDto } from './dto/create-company.dto';

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

  async create(manager: User, dto: CreateCompanyDto) {
    if (!isPlatformAdministrator(manager)) {
      throw new ForbiddenException(
        'Somente o administrador da plataforma pode cadastrar empresas.',
      );
    }

    const name = dto.name.trim();
    const duplicate = await this.prisma.company.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('Já existe uma empresa com este nome.');
    }

    return this.prisma.company.create({
      data: { name },
      select: {
        id: true,
        name: true,
        _count: { select: { users: true, employeeInvites: true } },
      },
    });
  }
}
