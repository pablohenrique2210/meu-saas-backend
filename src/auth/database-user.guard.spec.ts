import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { createClerkClient, type ClerkClient } from '@clerk/backend';
import { Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseUserGuard } from './database-user.guard';

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

const mockCreateClerkClient = jest.mocked(createClerkClient);
const mockClerkUsers = {
  getUser: jest.fn(),
};

const existingAdmin: User = {
  id: 'user_admin',
  companyId: 'company_1',
  name: 'Admin User',
  email: 'admin@example.com',
  role: Role.ADMIN,
  position: null,
  department: null,
  phone: null,
  hireDate: null,
  isActive: true,
};

function createContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('DatabaseUserGuard', () => {
  const transaction = {
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    company: {
      create: jest.fn(),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(
      (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };

  let guard: DatabaseUserGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_SECRET_KEY = 'sk_test_for_unit_tests';
    process.env.RH_ALLOWED_EMAILS = '';
    mockCreateClerkClient.mockReturnValue({
      users: mockClerkUsers,
    } as unknown as ClerkClient);
    guard = new DatabaseUserGuard(prisma as unknown as PrismaService);
  });

  it('attaches an existing active user to the request', async () => {
    prisma.user.findUnique.mockResolvedValue(existingAdmin);
    const request = { auth: { userId: existingAdmin.id } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty('currentUser', existingAdmin);
  });

  it('bootstraps the first Clerk user as an admin', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(0);
    transaction.user.findUnique.mockResolvedValue(null);
    transaction.user.count.mockResolvedValue(0);
    transaction.company.create.mockResolvedValue({ id: 'company_1' });
    transaction.user.create.mockResolvedValue(existingAdmin);
    mockClerkUsers.getUser.mockResolvedValue({
      firstName: 'Admin',
      lastName: 'User',
      primaryEmailAddressId: 'email_1',
      primaryPhoneNumberId: null,
      emailAddresses: [{ id: 'email_1', emailAddress: 'admin@example.com' }],
      phoneNumbers: [],
    } as unknown as Awaited<ReturnType<ClerkClient['users']['getUser']>>);
    const request = { auth: { userId: existingAdmin.id } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(transaction.user.create).toHaveBeenCalledWith({
      // Jest's asymmetric matcher is intentionally nested inside the call shape.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        id: existingAdmin.id,
        role: Role.ADMIN,
        companyId: 'company_1',
      }),
    });
  });

  it('keeps blocking unprovisioned users after bootstrap', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(1);

    await expect(
      guard.canActivate(createContext({ auth: { userId: 'user_unknown' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Jest needs the mocked method reference for this assertion.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(mockClerkUsers.getUser).not.toHaveBeenCalled();
  });

  it('provisions the second allowlisted email as an RH manager', async () => {
    process.env.RH_ALLOWED_EMAILS =
      'admin@example.com,consultoria@example.com';
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.count.mockResolvedValue(1);
    prisma.user.findFirst.mockResolvedValue(existingAdmin);
    transaction.user.findUnique.mockResolvedValue(null);
    transaction.user.create.mockResolvedValue({
      ...existingAdmin,
      id: 'user_consultoria',
      email: 'consultoria@example.com',
      role: Role.HR_MANAGER,
    });
    mockClerkUsers.getUser.mockResolvedValue({
      firstName: 'Lilian',
      lastName: 'Arruda',
      primaryEmailAddressId: 'email_consultoria',
      primaryPhoneNumberId: null,
      emailAddresses: [
        {
          id: 'email_consultoria',
          emailAddress: 'consultoria@example.com',
        },
      ],
      phoneNumbers: [],
    } as unknown as Awaited<ReturnType<ClerkClient['users']['getUser']>>);
    const request = { auth: { userId: 'user_consultoria' } };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: existingAdmin.companyId,
        email: 'consultoria@example.com',
        role: Role.HR_MANAGER,
      }),
    });
  });
});
