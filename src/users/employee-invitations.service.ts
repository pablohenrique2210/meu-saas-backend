import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertValidCpf, cpfHashesMatch, hashCpf } from './cpf';
import { ClaimEmployeeInviteDto } from './dto/claim-employee-invite.dto';
import { CreateEmployeeInviteDto } from './dto/create-employee-invite.dto';

const inviteViewSelect = {
  id: true,
  name: true,
  email: true,
  cpfLast4: true,
  role: true,
  position: true,
  department: true,
  phone: true,
  hireDate: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  courseAccesses: {
    select: {
      course: {
        select: { id: true, title: true, isPublished: true },
      },
    },
  },
} as const;

@Injectable()
export class EmployeeInvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPrograms() {
    return this.prisma.course.findMany({
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        isPublished: true,
      },
    });
  }

  async list(manager: User) {
    await this.expireOldInvites(manager.companyId);

    const invites = await this.prisma.employeeInvite.findMany({
      where: { companyId: manager.companyId },
      orderBy: { createdAt: 'desc' },
      select: inviteViewSelect,
    });

    return invites.map((invite) => this.toView(invite));
  }

  async create(manager: User, dto: CreateEmployeeInviteDto) {
    this.assertRoleCanBeAssigned(manager, dto.role);

    const cpf = assertValidCpf(dto.cpf);
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    const courseIds = [...new Set(dto.courseIds)];

    const [existingUser, existingInvite, courses] = await Promise.all([
      this.prisma.user.findUnique({ where: { email } }),
      this.prisma.employeeInvite.findFirst({
        where: {
          companyId: manager.companyId,
          email,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      }),
      this.prisma.course.findMany({
        where: { id: { in: courseIds } },
        select: { id: true },
      }),
    ]);

    if (existingUser) {
      throw new ConflictException(
        'Já existe um utilizador ativo com este e-mail.',
      );
    }

    if (existingInvite) {
      throw new ConflictException(
        'Já existe um convite pendente para este e-mail nesta empresa.',
      );
    }

    if (courses.length !== courseIds.length) {
      throw new NotFoundException('Um dos programas selecionados não existe.');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const invite = await this.prisma.employeeInvite.create({
      data: {
        companyId: manager.companyId,
        createdByUserId: manager.id,
        name,
        email,
        cpfHash: hashCpf(cpf),
        cpfLast4: cpf.slice(-4),
        role: dto.role ?? Role.USER,
        position: dto.position?.trim() || null,
        department: dto.department?.trim() || null,
        phone: dto.phone?.trim() || null,
        hireDate: dto.hireDate,
        expiresAt,
        courseAccesses: {
          create: courseIds.map((courseId) => ({ courseId })),
        },
      },
      select: inviteViewSelect,
    });

    try {
      const clerkInvitation = await this.createClerkInvitation(
        invite.id,
        email,
      );
      const savedInvite = await this.prisma.employeeInvite.update({
        where: { id: invite.id },
        data: { clerkInvitationId: clerkInvitation.id },
        select: inviteViewSelect,
      });
      return this.toView(savedInvite);
    } catch (error) {
      await this.prisma.employeeInvite.delete({ where: { id: invite.id } });
      throw new ServiceUnavailableException(
        'Não foi possível enviar o convite agora. Tente novamente em instantes.',
        { cause: error },
      );
    }
  }

  async revoke(manager: User, inviteId: string) {
    const invite = await this.prisma.employeeInvite.findFirst({
      where: {
        id: inviteId,
        companyId: manager.companyId,
        status: 'PENDING',
      },
    });

    if (!invite) {
      throw new NotFoundException('Convite pendente não encontrado.');
    }

    if (invite.clerkInvitationId) {
      const clerkClient = this.getClerkClient();
      await clerkClient.invitations.revokeInvitation(invite.clerkInvitationId);
    }

    const revoked = await this.prisma.employeeInvite.update({
      where: { id: invite.id },
      data: { status: 'REVOKED' },
      select: inviteViewSelect,
    });
    return this.toView(revoked);
  }

  async getInvitationLink(manager: User, inviteId: string) {
    const invite = await this.prisma.employeeInvite.findFirst({
      where: {
        id: inviteId,
        companyId: manager.companyId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: { clerkInvitationId: true },
    });

    if (!invite?.clerkInvitationId) {
      throw new NotFoundException('Convite pendente não encontrado.');
    }

    const result = await this.getClerkClient().invitations.getInvitationList({
      query: invite.clerkInvitationId,
      limit: 10,
    });
    const clerkInvitation = result.data.find(
      (candidate) => candidate.id === invite.clerkInvitationId,
    );

    if (!clerkInvitation?.url || clerkInvitation.status !== 'pending') {
      throw new NotFoundException(
        'O link deste convite não está mais disponível.',
      );
    }

    return { url: clerkInvitation.url };
  }

  async claim(clerkUserId: string, dto: ClaimEmployeeInviteDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: clerkUserId },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException(
        'A conta conectada já possui acesso. Saia e entre com o e-mail que recebeu o convite.',
      );
    }

    const clerkUser = await this.getClerkClient().users.getUser(clerkUserId);
    const primaryEmail = clerkUser.emailAddresses.find(
      (email) => email.id === clerkUser.primaryEmailAddressId,
    );

    if (!primaryEmail || primaryEmail.verification?.status !== 'verified') {
      throw new ForbiddenException(
        'Confirme o e-mail principal da sua conta antes de ativar o acesso.',
      );
    }

    const email = primaryEmail.emailAddress.trim().toLowerCase();
    const cpf = assertValidCpf(dto.cpf);
    const suppliedCpfHash = hashCpf(cpf);
    const candidates = await this.prisma.employeeInvite.findMany({
      where: {
        email,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: { courseAccesses: { select: { courseId: true } } },
    });
    const invite = candidates.find((candidate) =>
      cpfHashesMatch(candidate.cpfHash, suppliedCpfHash),
    );

    if (!invite) {
      throw new ForbiddenException(
        'Não encontramos uma autorização válida para este e-mail e CPF.',
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const stillPending = await transaction.employeeInvite.findFirst({
        where: {
          id: invite.id,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      });
      if (!stillPending) {
        throw new ConflictException(
          'Este convite já foi utilizado ou expirou.',
        );
      }

      const user = await transaction.user.create({
        data: {
          id: clerkUserId,
          companyId: invite.companyId,
          name: invite.name,
          email,
          role: invite.role,
          position: invite.position,
          department: invite.department,
          phone: invite.phone,
          hireDate: invite.hireDate,
        },
      });

      if (invite.courseAccesses.length > 0) {
        await transaction.userCourseAccess.createMany({
          data: invite.courseAccesses.map(({ courseId }) => ({
            userId: user.id,
            courseId,
            grantedByUserId: invite.createdByUserId,
          })),
        });
      }

      await transaction.employeeInvite.update({
        where: { id: invite.id },
        data: {
          status: 'CLAIMED',
          claimedByUserId: user.id,
          claimedAt: new Date(),
        },
      });

      return {
        id: user.id,
        companyId: user.companyId,
        name: user.name,
        email: user.email,
        role: user.role,
        position: user.position,
        department: user.department,
        phone: user.phone,
        hireDate: user.hireDate,
        isActive: user.isActive,
      };
    });
  }

  private async createClerkInvitation(inviteId: string, emailAddress: string) {
    const frontendUrl = (
      process.env.FRONTEND_URL ?? 'http://localhost:3000'
    ).replace(/\/$/, '');

    return this.getClerkClient().invitations.createInvitation({
      emailAddress,
      redirectUrl: `${frontendUrl}/ativar-acesso`,
      expiresInDays: 30,
      ignoreExisting: true,
      notify: true,
      publicMetadata: { employeeInviteId: inviteId },
    });
  }

  private getClerkClient() {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new InternalServerErrorException(
        'O serviço de convites não está configurado.',
      );
    }
    return createClerkClient({ secretKey });
  }

  private expireOldInvites(companyId: string) {
    return this.prisma.employeeInvite.updateMany({
      where: {
        companyId,
        status: 'PENDING',
        expiresAt: { lte: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
  }

  private assertRoleCanBeAssigned(manager: User, role?: Role) {
    if (
      role !== undefined &&
      role !== Role.USER &&
      manager.role !== Role.ADMIN
    ) {
      throw new ForbiddenException(
        'Apenas administradores podem conceder perfis de gestão.',
      );
    }
  }

  private toView<T extends { cpfLast4: string; courseAccesses: unknown[] }>(
    invite: T,
  ) {
    return {
      ...invite,
      cpfMasked: `***.***.***-${invite.cpfLast4}`,
      cpfLast4: undefined,
      programs: invite.courseAccesses.map(
        (access) => (access as { course: unknown }).course,
      ),
      courseAccesses: undefined,
    };
  }
}
