import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeInvitationsService } from './employee-invitations.service';

jest.mock('@clerk/backend', () => ({ createClerkClient: jest.fn() }));

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

const hrManager: User = { ...admin, id: 'hr_1', role: Role.HR_MANAGER };

describe('EmployeeInvitationsService', () => {
  const course = {
    id: 'c4c09451-c660-4c66-95b9-da27d06dc96e',
    title: 'Programa Líder em Ação',
    isPublished: true,
  };
  const baseInvite = {
    id: 'invite_1',
    name: 'Maria Silva',
    email: 'maria@example.com',
    cpfLast4: '4725',
    role: Role.USER,
    position: null,
    department: null,
    phone: null,
    hireDate: null,
    status: 'PENDING',
    expiresAt: new Date('2026-09-20T00:00:00.000Z'),
    createdAt: new Date('2026-08-21T00:00:00.000Z'),
    courseAccesses: [{ course }],
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    employeeInvite: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    course: { findMany: jest.fn() },
  };
  const invitations = { createInvitation: jest.fn() };
  let service: EmployeeInvitationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_SECRET_KEY = 'sk_test_unit';
    process.env.CPF_HASH_SECRET = 'cpf_hash_unit_secret';
    jest.mocked(createClerkClient).mockReturnValue({
      invitations,
    } as unknown as ClerkClient);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.employeeInvite.findFirst.mockResolvedValue(null);
    prisma.course.findMany.mockResolvedValue([{ id: course.id }]);
    prisma.employeeInvite.create.mockResolvedValue(baseInvite);
    invitations.createInvitation.mockResolvedValue({ id: 'inv_clerk_1' });
    prisma.employeeInvite.update.mockResolvedValue(baseInvite);
    service = new EmployeeInvitationsService(
      prisma as unknown as PrismaService,
    );
  });

  it('stores only a CPF hash and the last four digits', async () => {
    await service.create(admin, {
      name: 'Maria Silva',
      email: 'MARIA@example.com',
      cpf: '529.982.247-25',
      courseIds: [course.id],
    });

    const createCall = prisma.employeeInvite.create.mock.calls[0][0];
    expect(createCall.data).toEqual(
      expect.objectContaining({
        companyId: admin.companyId,
        email: 'maria@example.com',
        cpfLast4: '4725',
        cpfHash: expect.any(String),
      }),
    );
    expect(createCall.data).not.toHaveProperty('cpf');
    expect(invitations.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: 'maria@example.com',
        redirectUrl: 'http://localhost:3000/ativar-acesso',
      }),
    );
  });

  it('prevents an HR manager from inviting another manager', async () => {
    await expect(
      service.create(hrManager, {
        name: 'Manager',
        email: 'manager@example.com',
        cpf: '529.982.247-25',
        role: Role.HR_MANAGER,
        courseIds: [course.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.employeeInvite.create).not.toHaveBeenCalled();
  });
});
