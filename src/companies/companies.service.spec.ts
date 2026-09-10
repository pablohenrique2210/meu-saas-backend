import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Role, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from './companies.service';

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

describe('CompaniesService', () => {
  const transaction = {
    alert: { deleteMany: jest.fn() },
    company: { delete: jest.fn() },
  };
  const prisma = {
    company: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  let service: CompaniesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CompaniesService(prisma as unknown as PrismaService);
  });

  it('lists every company for any user configured as an administrator', async () => {
    prisma.company.findMany.mockResolvedValue([]);

    await service.findAvailable(admin);

    expect(prisma.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('allows any administrator to create a company', async () => {
    prisma.company.findFirst.mockResolvedValue(null);
    prisma.company.create.mockResolvedValue({ id: 'company_2', name: 'Nova' });

    await service.create(admin, { name: ' Nova ' });

    expect(prisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Nova' } }),
    );
  });

  it('prevents an administrator from deleting their own company', async () => {
    await expect(service.remove(admin, admin.companyId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('prevents deleting a company that still has collaborators', async () => {
    prisma.company.findUnique.mockResolvedValue({
      id: 'company_2',
      name: 'Empresa ocupada',
      _count: { users: 1, employeeInvites: 0 },
      employeeInvites: [],
    });

    await expect(service.remove(admin, 'company_2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('prevents deleting a company that still has a pending invitation', async () => {
    prisma.company.findUnique.mockResolvedValue({
      id: 'company_2',
      name: 'Empresa com convite',
      _count: { users: 0, employeeInvites: 1 },
      employeeInvites: [{ id: 'invite_1' }],
    });

    await expect(service.remove(admin, 'company_2')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes an empty company and its dependent alerts', async () => {
    prisma.company.findUnique.mockResolvedValue({
      id: 'company_2',
      name: 'Empresa vazia',
      _count: { users: 0, employeeInvites: 2 },
      employeeInvites: [],
    });

    await expect(service.remove(admin, 'company_2')).resolves.toEqual({
      id: 'company_2',
      name: 'Empresa vazia',
      deleted: true,
    });
    expect(transaction.alert.deleteMany).toHaveBeenCalledWith({
      where: { companyId: 'company_2' },
    });
    expect(transaction.company.delete).toHaveBeenCalledWith({
      where: { id: 'company_2' },
    });
  });
});
