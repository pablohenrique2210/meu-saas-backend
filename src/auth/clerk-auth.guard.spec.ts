import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { ClerkAuthGuard } from './clerk-auth.guard';

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

const mockVerifyToken = jest.mocked(verifyToken);

function createContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ClerkAuthGuard', () => {
  let guard: ClerkAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_SECRET_KEY = 'sk_test_for_unit_tests';
    delete process.env.CLERK_JWT_KEY;
    delete process.env.CLERK_AUTHORIZED_PARTIES;
    guard = new ClerkAuthGuard();
  });

  it('accepts a valid Clerk session token from the frontend', async () => {
    mockVerifyToken.mockResolvedValue({ sub: 'user_123' });
    const request = {
      headers: { authorization: 'Bearer valid-token' },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(mockVerifyToken).toHaveBeenCalledWith('valid-token', {
      secretKey: 'sk_test_for_unit_tests',
      authorizedParties: ['http://localhost:3000'],
    });
    expect(request).toHaveProperty('auth.userId', 'user_123');
  });

  it('uses the local Clerk public key without a network request', async () => {
    process.env.CLERK_JWT_KEY =
      '-----BEGIN PUBLIC KEY-----\\npublic-key-for-unit-tests\\n-----END PUBLIC KEY-----';
    mockVerifyToken.mockResolvedValue({ sub: 'user_456' });

    await expect(
      guard.canActivate(
        createContext({ headers: { authorization: 'Bearer local-token' } }),
      ),
    ).resolves.toBe(true);

    expect(mockVerifyToken).toHaveBeenCalledWith('local-token', {
      jwtKey:
        '-----BEGIN PUBLIC KEY-----\npublic-key-for-unit-tests\n-----END PUBLIC KEY-----',
      authorizedParties: ['http://localhost:3000'],
    });
  });

  it('rejects a request without a bearer token', async () => {
    await expect(
      guard.canActivate(createContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid Clerk token', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Invalid token'));

    await expect(
      guard.canActivate(
        createContext({ headers: { authorization: 'Bearer invalid-token' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
