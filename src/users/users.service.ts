import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { Prisma, Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  isPlatformAdministrator,
  resolveManagedCompanyId,
} from '../auth/company-scope';

const userProfileSelect = {
  id: true,
  companyId: true,
  name: true,
  email: true,
  role: true,
  position: true,
  department: true,
  phone: true,
  hireDate: true,
  isActive: true,
  company: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  getProfile(id: string) {
    return this.findProfileOrThrow(id);
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    await this.findProfileOrThrow(id);

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: userProfileSelect,
    });
  }

  findEmployeesForHR(manager: User, requestedCompanyId?: string) {
    const companyId = resolveManagedCompanyId(manager, requestedCompanyId);
    return this.prisma.user.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      select: userProfileSelect,
    });
  }

  findEmployeeForHR(manager: User, id: string) {
    return this.findManagedUserOrThrow(manager, id);
  }

  createFromWebhook(dto: CreateUserDto & { companyId: string }) {
    return this.prisma.user.create({
      data: {
        ...dto,
        role: dto.role ?? Role.USER,
      },
      select: userProfileSelect,
    });
  }

  async createManagedUser(manager: User, dto: CreateUserDto) {
    this.assertRoleCanBeAssigned(manager, dto.role);

    try {
      return await this.prisma.user.create({
        data: {
          ...dto,
          companyId: manager.companyId,
          role: dto.role ?? Role.USER,
        },
        select: userProfileSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A user with this ID or email already exists.',
        );
      }

      throw error;
    }
  }

  async update(manager: User, id: string, dto: UpdateUserDto) {
    const target = await this.findManagedUserOrThrow(manager, id);
    this.assertCanManageTarget(manager, target);

    if (dto.role !== undefined) {
      this.assertRoleCanBeAssigned(manager, dto.role);
    }

    if (
      manager.id === target.id &&
      (dto.isActive === false ||
        (dto.role !== undefined && dto.role !== manager.role))
    ) {
      throw new ForbiddenException(
        'You cannot deactivate yourself or change your own role.',
      );
    }

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: userProfileSelect,
    });
  }

  async remove(manager: User, id: string) {
    const target = await this.findManagedUserOrThrow(manager, id);
    this.assertCanManageTarget(manager, target);

    if (manager.id === target.id) {
      throw new ForbiddenException('You cannot delete your own profile.');
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.employeeInvite.deleteMany({
        where: { claimedByUserId: id },
      });
      await transaction.lessonProgress.deleteMany({ where: { userId: id } });
      await transaction.userProgress.deleteMany({ where: { userId: id } });
      await transaction.userGamification.deleteMany({ where: { userId: id } });
      await transaction.checkIn.deleteMany({ where: { userId: id } });
      await transaction.userGameProgress.deleteMany({ where: { userId: id } });
      await transaction.userCourseAccess.deleteMany({ where: { userId: id } });
      await transaction.user.delete({ where: { id } });
    });

    let authenticationAccountDeleted = false;
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (secretKey) {
      try {
        const clerkClient = createClerkClient({ secretKey });
        await clerkClient.users.deleteUser(id);
        authenticationAccountDeleted = true;
      } catch (error) {
        this.logger.warn(
          `Profile ${id} was deleted, but the Clerk account could not be removed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    } else {
      this.logger.warn(
        `Profile ${id} was deleted without removing the Clerk account because CLERK_SECRET_KEY is not configured.`,
      );
    }

    return { id, deleted: true, authenticationAccountDeleted };
  }

  private async findProfileOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('User profile not found.');
    }

    return user;
  }

  private async findCompanyUserOrThrow(companyId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      select: userProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found in your company.');
    }

    return user;
  }

  private async findManagedUserOrThrow(manager: User, id: string) {
    if (!isPlatformAdministrator(manager)) {
      return this.findCompanyUserOrThrow(manager.companyId, id);
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userProfileSelect,
    });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  private assertRoleCanBeAssigned(manager: User, role?: Role) {
    if (role !== undefined && manager.role !== Role.ADMIN) {
      throw new ForbiddenException('Only an admin can assign user roles.');
    }
  }

  private assertCanManageTarget(manager: User, target: User) {
    if (manager.role === Role.HR_MANAGER && target.role !== Role.USER) {
      throw new ForbiddenException(
        'HR managers can only update standard users.',
      );
    }
  }
}
