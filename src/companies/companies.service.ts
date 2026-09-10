import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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

  async remove(manager: User, id: string) {
    if (!isPlatformAdministrator(manager)) {
      throw new ForbiddenException(
        'Somente administradores podem excluir empresas.',
      );
    }
    if (id === manager.companyId) {
      throw new ForbiddenException(
        'Você não pode excluir a empresa vinculada ao seu próprio perfil.',
      );
    }

    const company = await this.prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        _count: { select: { users: true, employeeInvites: true } },
        employeeInvites: {
          where: { status: 'PENDING' },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    if (company._count.users > 0) {
      throw new ConflictException(
        'Esta empresa possui colaboradores. Transfira ou exclua os colaboradores antes de apagar a empresa.',
      );
    }
    if (company.employeeInvites.length > 0) {
      throw new ConflictException(
        'Esta empresa possui convites pendentes. Revogue os convites antes de apagar a empresa.',
      );
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.alert.deleteMany({ where: { companyId: id } });
      await transaction.company.delete({ where: { id } });
    });

    return { id: company.id, name: company.name, deleted: true as const };
  }
}
