import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

jest.mock('@clerk/backend', () => ({ createClerkClient: jest.fn() }));

const clerkUsers = { deleteUser: jest.fn() };

const admin: User = {
  id: 'admin_1',
  companyId: 'company_1',
  name: 'Admin',
  email: 'admin@example.com',
  role: Role.ADMIN,
  position: null,
  department: null,
  phone: null,
  hireDate: null,
  isActive: true,
};

const hrManager: User = {
  ...admin,
  id: 'hr_1',
  email: 'hr@example.com',
  role: Role.HR_MANAGER,
};

describe('UsersService', () => {
  const prisma = {
    user: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    employeeInvite: { deleteMany: jest.fn() },
    lessonProgress: { deleteMany: jest.fn() },
    userProgress: { deleteMany: jest.fn() },
    userGamification: { deleteMany: jest.fn() },
    checkIn: { deleteMany: jest.fn() },
    userGameProgress: { deleteMany: jest.fn() },
    userCourseAccess: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };

  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    jest.mocked(createClerkClient).mockReturnValue({
      users: clerkUsers,
    } as unknown as ReturnType<typeof createClerkClient>);
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('always lists users from the manager company', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.findEmployeesForHR(admin);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'company_1' } }),
    );
  });

  it('infers the company when an admin creates a user', async () => {
    prisma.user.create.mockResolvedValue({ id: 'user_1' });

    await service.createManagedUser(admin, {
      id: 'user_1',
      name: 'User',
      email: 'user@example.com',
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        // Jest's asymmetric matcher is intentionally nested inside the call shape.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          companyId: 'company_1',
          role: Role.USER,
        }),
      }),
    );
  });

  it('does not allow an HR manager to assign roles', async () => {
    await expect(
      service.createManagedUser(hrManager, {
        id: 'user_1',
        name: 'User',
        email: 'user@example.com',
        role: Role.ADMIN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('does not reveal or update a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.update(admin, 'external_user', { department: 'Finance' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'external_user', companyId: 'company_1' },
      }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not allow a manager to deactivate themselves', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);

    await expect(
      service.update(admin, admin.id, { isActive: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not allow an HR manager to update an admin', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);

    await expect(
      service.update(hrManager, admin.id, { department: 'Finance' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does not allow a manager to delete themselves', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);

    await expect(service.remove(admin, admin.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not allow an HR manager to delete an admin', async () => {
    prisma.user.findFirst.mockResolvedValue(admin);

    await expect(service.remove(hrManager, admin.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(clerkUsers.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes the employee profile, learning data and authentication account', async () => {
    const employee: User = {
      ...admin,
      id: 'user_1',
      email: 'user@example.com',
      role: Role.USER,
    };
    prisma.user.findFirst.mockResolvedValue(employee);
    prisma.user.delete.mockResolvedValue(employee);
    clerkUsers.deleteUser.mockResolvedValue(employee);
    process.env.CLERK_SECRET_KEY = 'sk_test_example';

    await expect(service.remove(admin, employee.id)).resolves.toEqual({
      id: employee.id,
      deleted: true,
      authenticationAccountDeleted: true,
    });

    expect(prisma.lessonProgress.deleteMany).toHaveBeenCalledWith({
      where: { userId: employee.id },
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: employee.id },
    });
    expect(clerkUsers.deleteUser).toHaveBeenCalledWith(employee.id);
  });
});
