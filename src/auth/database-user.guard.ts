import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUserRequest } from './current-user.decorator';
import { ClerkAuthenticatedRequest } from './clerk-auth.guard';
import { getRhAllowedEmails } from './rh-access';

type UserRequest = ClerkAuthenticatedRequest & AuthenticatedUserRequest;

@Injectable()
export class DatabaseUserGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<UserRequest>();
    const clerkUserId = request.auth?.userId;

    if (!clerkUserId) {
      throw new ForbiddenException('Authenticated user was not resolved.');
    }

    let user = await this.prisma.user.findUnique({
      where: { id: clerkUserId },
    });

    if (!user) {
      user = await this.bootstrapFirstUser(clerkUserId);
    }

    if (!user) {
      user = await this.provisionAllowedRhUser(clerkUserId);
    }

    if (!user) {
      throw new ForbiddenException(
        'Your user profile has not been provisioned.',
      );
    }

    if (!user.isActive) {
      throw new ForbiddenException('Your user profile is inactive.');
    }

    request.currentUser = user;
    return true;
  }

  private async bootstrapFirstUser(clerkUserId: string) {
    if ((await this.prisma.user.count()) > 0) return null;

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new InternalServerErrorException(
        'Authentication is not configured.',
      );
    }

    const clerkClient = createClerkClient({ secretKey });
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const primaryEmail = clerkUser.emailAddresses.find(
      (email) => email.id === clerkUser.primaryEmailAddressId,
    );

    if (!primaryEmail) {
      throw new ForbiddenException(
        'Your Clerk account needs a primary email address.',
      );
    }

    const fullName = [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(' ');
    const name = fullName || primaryEmail.emailAddress.split('@')[0];

    return this.prisma.$transaction(async (transaction) => {
      const existingUser = await transaction.user.findUnique({
        where: { id: clerkUserId },
      });
      if (existingUser) return existingUser;

      if ((await transaction.user.count()) > 0) return null;

      const company = await transaction.company.create({
        data: { name: `Workspace de ${name}` },
      });

      return transaction.user.create({
        data: {
          id: clerkUserId,
          companyId: company.id,
          name,
          email: primaryEmail.emailAddress,
          phone:
            clerkUser.phoneNumbers.find(
              (phone) => phone.id === clerkUser.primaryPhoneNumberId,
            )?.phoneNumber ?? null,
          role: Role.ADMIN,
        },
      });
    });
  }

  private async provisionAllowedRhUser(clerkUserId: string) {
    const allowedEmails = getRhAllowedEmails();
    if (allowedEmails.length === 0) return null;

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new InternalServerErrorException(
        'CLERK_SECRET_KEY is required to provision an authorized RH user.',
      );
    }

    const clerkClient = createClerkClient({ secretKey });
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const primaryEmail = clerkUser.emailAddresses.find(
      (email) => email.id === clerkUser.primaryEmailAddressId,
    );
    const normalizedEmail = primaryEmail?.emailAddress.trim().toLowerCase();
    const allowedEmailIndex = normalizedEmail
      ? allowedEmails.indexOf(normalizedEmail)
      : -1;

    if (!primaryEmail || allowedEmailIndex < 0) return null;

    const workspaceOwner = await this.prisma.user.findFirst({
      where: {
        email: { equals: allowedEmails[0], mode: 'insensitive' },
        isActive: true,
      },
    });

    if (!workspaceOwner) {
      throw new ForbiddenException(
        'The RH workspace owner has not been provisioned.',
      );
    }

    const fullName = [clerkUser.firstName, clerkUser.lastName]
      .filter(Boolean)
      .join(' ');
    const name = fullName || primaryEmail.emailAddress.split('@')[0];

    return this.prisma.$transaction(async (transaction) => {
      const existingUser = await transaction.user.findUnique({
        where: { id: clerkUserId },
      });
      if (existingUser) return existingUser;

      const existingEmail = await transaction.user.findUnique({
        where: { email: primaryEmail.emailAddress },
      });
      if (existingEmail) return existingEmail;

      return transaction.user.create({
        data: {
          id: clerkUserId,
          companyId: workspaceOwner.companyId,
          name,
          email: primaryEmail.emailAddress,
          phone:
            clerkUser.phoneNumbers.find(
              (phone) => phone.id === clerkUser.primaryPhoneNumberId,
            )?.phoneNumber ?? null,
          role: allowedEmailIndex === 0 ? Role.ADMIN : Role.HR_MANAGER,
        },
      });
    });
  }
}
