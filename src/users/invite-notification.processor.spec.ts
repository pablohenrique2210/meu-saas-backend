import { createClerkClient, type ClerkClient } from '@clerk/backend';
import {
  EmployeeInviteStatus,
  InviteNotificationChannel,
  InviteNotificationStatus,
} from '@prisma/client';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import { InviteNotificationProcessor } from './invite-notification.processor';

jest.mock('@clerk/backend', () => ({ createClerkClient: jest.fn() }));
jest.mock('resend', () => ({ Resend: jest.fn() }));

describe('InviteNotificationProcessor', () => {
  const emailSend = jest.fn();
  const clerkInvitations = {
    createInvitation: jest.fn(),
    getInvitationList: jest.fn(),
  };
  const job = {
    id: 'job_1',
    inviteId: 'invite_1',
    channel: InviteNotificationChannel.EMAIL,
    status: InviteNotificationStatus.PENDING,
    attempts: 0,
    nextAttemptAt: new Date(),
    lockedAt: null,
    sentAt: null,
    providerMessageId: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    invite: {
      id: 'invite_1',
      name: 'Maria Silva',
      email: 'maria@example.com',
      phone: null,
      status: EmployeeInviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 86_400_000),
      clerkInvitationId: null,
      company: { name: 'Empresa Exemplo' },
      courseAccesses: [{ course: { title: 'Programa de Liderança' } }],
    },
  };
  const prisma = {
    inviteNotificationJob: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    employeeInvite: { update: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLERK_SECRET_KEY = 'sk_test_unit';
    process.env.RESEND_API_KEY = 're_test_unit';
    process.env.RESEND_FROM = 'La Evolui <convites@laevolui.education>';
    process.env.FRONTEND_URL = 'https://app.laevolui.education';
    jest.mocked(createClerkClient).mockReturnValue({
      invitations: clerkInvitations,
    } as unknown as ClerkClient);
    jest
      .mocked(Resend)
      .mockImplementation(
        () => ({ emails: { send: emailSend } }) as unknown as Resend,
      );
    clerkInvitations.createInvitation.mockResolvedValue({
      id: 'clerk_invite_1',
      url: 'https://clerk.example/activate',
    });
    emailSend.mockResolvedValue({ data: { id: 'email_1' }, error: null });
    prisma.inviteNotificationJob.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.inviteNotificationJob.findMany
      .mockResolvedValueOnce([job])
      .mockResolvedValueOnce([]);
    prisma.inviteNotificationJob.update.mockResolvedValue(job);
    prisma.employeeInvite.update.mockResolvedValue(job.invite);
  });

  it('creates a silent Clerk link and sends an idempotent email', async () => {
    const processor = new InviteNotificationProcessor(
      prisma as unknown as PrismaService,
    );

    await processor.wake();

    expect(clerkInvitations.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: job.invite.email,
        notify: false,
        redirectUrl: 'https://app.laevolui.education/ativar-acesso',
      }),
    );
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [job.invite.email],
        subject: 'Seu acesso à plataforma La Evolui',
      }),
      { idempotencyKey: 'employee-invite/email/invite_1' },
    );
    expect(prisma.inviteNotificationJob.update).toHaveBeenLastCalledWith({
      where: { id: job.id },
      data: expect.objectContaining({
        status: InviteNotificationStatus.SENT,
        providerMessageId: 'email_1',
      }),
    });
  });

  it('falls back to Clerk email delivery when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    const processor = new InviteNotificationProcessor(
      prisma as unknown as PrismaService,
    );

    await processor.wake();

    expect(clerkInvitations.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: job.invite.email,
        notify: true,
      }),
    );
    expect(emailSend).not.toHaveBeenCalled();
    expect(prisma.inviteNotificationJob.update).toHaveBeenLastCalledWith({
      where: { id: job.id },
      data: expect.objectContaining({
        status: InviteNotificationStatus.SENT,
        providerMessageId: 'clerk:clerk_invite_1',
      }),
    });
  });

  it('keeps a transient provider failure pending for a later retry', async () => {
    emailSend.mockResolvedValue({
      data: null,
      error: { message: 'Temporary outage' },
    });
    const processor = new InviteNotificationProcessor(
      prisma as unknown as PrismaService,
    );

    await processor.wake();

    expect(prisma.inviteNotificationJob.update).toHaveBeenLastCalledWith({
      where: { id: job.id },
      data: expect.objectContaining({
        status: InviteNotificationStatus.PENDING,
        lastError: expect.stringContaining('Temporary outage'),
        nextAttemptAt: expect.any(Date),
      }),
    });
  });
});
