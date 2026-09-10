import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Role, type User } from '@prisma/client';
import { RhAccessGuard } from './rh-access.guard';

const user: User = {
  id: 'user_1',
  companyId: 'company_1',
  name: 'Pablo',
  email: 'pablo@example.com',
  role: Role.ADMIN,
  position: null,
  department: null,
  phone: null,
  hireDate: null,
  isActive: true,
};

function contextFor(currentUser?: User) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ currentUser }) }),
  } as unknown as ExecutionContext;
}

describe('RhAccessGuard', () => {
  const originalValue = process.env.RH_ALLOWED_EMAILS;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.RH_ALLOWED_EMAILS;
    else process.env.RH_ALLOWED_EMAILS = originalValue;
  });

  it('accepts an allowlisted email regardless of casing or whitespace', () => {
    process.env.RH_ALLOWED_EMAILS =
      ' CONSULTORA@example.com, pablo@EXAMPLE.com ';

    expect(
      new RhAccessGuard().canActivate(
        contextFor({ ...user, role: Role.HR_MANAGER }),
      ),
    ).toBe(true);
  });

  it('accepts administrators even when they are outside the allowlist', () => {
    process.env.RH_ALLOWED_EMAILS = 'consultora@example.com';

    expect(new RhAccessGuard().canActivate(contextFor(user))).toBe(true);
  });

  it('accepts administrators when the allowlist variable is missing', () => {
    delete process.env.RH_ALLOWED_EMAILS;

    expect(new RhAccessGuard().canActivate(contextFor(user))).toBe(true);
  });

  it('rejects an HR manager outside the allowlist', () => {
    process.env.RH_ALLOWED_EMAILS = 'consultora@example.com';

    expect(() =>
      new RhAccessGuard().canActivate(
        contextFor({ ...user, role: Role.HR_MANAGER }),
      ),
    ).toThrow(ForbiddenException);
  });
});
