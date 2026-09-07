import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';
import {
  EmployeeInviteStatus,
  InviteNotificationChannel,
  InviteNotificationStatus,
} from '@prisma/client';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;
const MAX_BATCHES_PER_RUN = 5;
const LOCK_TIMEOUT_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

@Injectable()
export class InviteNotificationProcessor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InviteNotificationProcessor.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const intervalMs = this.positiveInteger(
      process.env.INVITE_NOTIFICATION_POLL_INTERVAL_MS,
      15_000,
    );
    this.timer = setInterval(() => void this.wake(), intervalMs);
    this.timer.unref();
    void this.wake();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  wake() {
    if (!this.running) {
      this.running = this.processPendingJobs()
        .catch((error) => {
          this.logger.error(
            `Invite notification processor failed (${this.errorName(error)}).`,
          );
        })
        .finally(() => {
          this.running = undefined;
        });
    }
    return this.running;
  }

  private async processPendingJobs() {
    const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS);
    await this.prisma.inviteNotificationJob.updateMany({
      where: {
        status: InviteNotificationStatus.PROCESSING,
        lockedAt: { lte: staleBefore },
      },
      data: {
        status: InviteNotificationStatus.PENDING,
        lockedAt: null,
        nextAttemptAt: new Date(),
      },
    });

    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const jobs = await this.prisma.inviteNotificationJob.findMany({
        where: {
          status: InviteNotificationStatus.PENDING,
          nextAttemptAt: { lte: new Date() },
          attempts: { lt: MAX_ATTEMPTS },
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
        include: {
          invite: {
            include: {
              company: { select: { name: true } },
              courseAccesses: {
                select: { course: { select: { title: true } } },
              },
            },
          },
        },
      });
      if (jobs.length === 0) return;

      for (const job of jobs) {
        const claimed = await this.prisma.inviteNotificationJob.updateMany({
          where: {
            id: job.id,
            status: InviteNotificationStatus.PENDING,
            nextAttemptAt: { lte: new Date() },
          },
          data: {
            status: InviteNotificationStatus.PROCESSING,
            lockedAt: new Date(),
            attempts: { increment: 1 },
          },
        });
        if (claimed.count !== 1) continue;

        try {
          const providerMessageId = await this.deliver(job);
          await this.prisma.inviteNotificationJob.update({
            where: { id: job.id },
            data: {
              status: InviteNotificationStatus.SENT,
              sentAt: new Date(),
              lockedAt: null,
              lastError: null,
              providerMessageId,
            },
          });
        } catch (error) {
          await this.recordFailure(job.id, job.attempts + 1, error);
        }
      }
    }
  }

  private async deliver(job: {
    id: string;
    channel: InviteNotificationChannel;
    invite: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      status: EmployeeInviteStatus;
      expiresAt: Date;
      clerkInvitationId: string | null;
      company: { name: string };
      courseAccesses: Array<{ course: { title: string } }>;
    };
  }) {
    if (
      job.invite.status !== EmployeeInviteStatus.PENDING ||
      job.invite.expiresAt <= new Date()
    ) {
      throw new PermanentDeliveryError('Convite inativo ou expirado.');
    }

    const useClerkEmailFallback =
      job.channel === InviteNotificationChannel.EMAIL &&
      !this.isResendConfigured();
    const activation = await this.ensureClerkInvitation(
      job.invite,
      useClerkEmailFallback,
    );
    if (job.channel === InviteNotificationChannel.EMAIL) {
      return useClerkEmailFallback
        ? `clerk:${activation.invitationId}`
        : this.sendEmail(job.invite, activation.url);
    }
    return this.sendWhatsApp(job.invite, activation.url);
  }

  private async ensureClerkInvitation(
    invite: {
      id: string;
      email: string;
      clerkInvitationId: string | null;
    },
    notify: boolean,
  ) {
    const clerk = this.getClerkClient();
    if (invite.clerkInvitationId) {
      const existing = await clerk.invitations.getInvitationList({
        query: invite.clerkInvitationId,
        limit: 10,
      });
      const pending = existing.data.find(
        (candidate) =>
          candidate.id === invite.clerkInvitationId &&
          candidate.status === 'pending' &&
          candidate.url,
      );
      if (pending?.url) {
        return { url: pending.url, invitationId: pending.id };
      }
    }

    const frontendUrl = (
      process.env.FRONTEND_URL ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    const created = await clerk.invitations.createInvitation({
      emailAddress: invite.email,
      redirectUrl: `${frontendUrl}/ativar-acesso`,
      expiresInDays: 30,
      ignoreExisting: true,
      notify,
      publicMetadata: { employeeInviteId: invite.id },
    });
    if (!created.url) {
      throw new Error('Clerk invitation did not return an activation URL.');
    }
    await this.prisma.employeeInvite.update({
      where: { id: invite.id },
      data: { clerkInvitationId: created.id },
    });
    return { url: created.url, invitationId: created.id };
  }

  private async sendEmail(
    invite: {
      id: string;
      name: string;
      email: string;
      company: { name: string };
      courseAccesses: Array<{ course: { title: string } }>;
    },
    activationUrl: string,
  ) {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM?.trim();
    if (!apiKey || !from) {
      throw new Error('Resend is not configured.');
    }
    const programs = invite.courseAccesses.map(({ course }) => course.title);
    const safeName = this.escapeHtml(invite.name);
    const safeCompany = this.escapeHtml(invite.company.name);
    const safeUrl = this.escapeHtml(activationUrl);
    const programList = programs.length
      ? `<p><strong>Programas:</strong> ${programs.map((title) => this.escapeHtml(title)).join(', ')}</p>`
      : '';
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send(
      {
        from,
        to: [invite.email],
        subject: 'Seu acesso à plataforma La Evolui',
        html: `<p>Olá, ${safeName}.</p><p>${safeCompany} convidou você para acessar a plataforma La Evolui.</p>${programList}<p><a href="${safeUrl}">Ativar meu acesso</a></p><p>Este convite é pessoal e expira em 30 dias.</p>`,
        text: `Olá, ${invite.name}. ${invite.company.name} convidou você para acessar a plataforma La Evolui.${programs.length ? ` Programas: ${programs.join(', ')}.` : ''} Ative seu acesso: ${activationUrl}`,
      },
      { idempotencyKey: `employee-invite/email/${invite.id}` },
    );
    if (error) throw new Error(`Resend rejected the email: ${error.message}`);
    return data?.id ?? null;
  }

  private async sendWhatsApp(
    invite: { id: string; name: string; phone: string | null },
    activationUrl: string,
  ) {
    if (!invite.phone) throw new PermanentDeliveryError('Telefone ausente.');
    const apiUrl = process.env.WHATSAPP_API_URL?.trim();
    const token = process.env.WHATSAPP_API_TOKEN?.trim();
    if (!apiUrl || !token) {
      throw new Error('WhatsApp API is not configured.');
    }
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `employee-invite/whatsapp/${invite.id}`,
      },
      body: JSON.stringify({
        to: this.normalizePhone(invite.phone),
        template: process.env.WHATSAPP_INVITE_TEMPLATE ?? 'convite_colaborador',
        language: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'pt_BR',
        variables: { name: invite.name, activationUrl },
        externalId: `employee-invite/whatsapp/${invite.id}`,
      }),
      signal: AbortSignal.timeout(
        this.positiveInteger(process.env.WHATSAPP_TIMEOUT_MS, 10_000),
      ),
    });
    if (!response.ok) {
      throw new Error(`WhatsApp API returned status ${response.status}.`);
    }
    const payload = (await response.json().catch(() => null)) as {
      id?: string;
      messageId?: string;
      messages?: Array<{ id?: string }>;
    } | null;
    return (
      payload?.messageId ?? payload?.id ?? payload?.messages?.[0]?.id ?? null
    );
  }

  private async recordFailure(jobId: string, attempt: number, error: unknown) {
    const permanent = error instanceof PermanentDeliveryError;
    const exhausted = attempt >= MAX_ATTEMPTS;
    const message = this.errorMessage(error).slice(0, 1_000);
    await this.prisma.inviteNotificationJob.update({
      where: { id: jobId },
      data:
        permanent || exhausted
          ? {
              status: InviteNotificationStatus.FAILED,
              lockedAt: null,
              lastError: message,
            }
          : {
              status: InviteNotificationStatus.PENDING,
              lockedAt: null,
              lastError: message,
              nextAttemptAt: new Date(
                Date.now() +
                  RETRY_DELAYS_MS[
                    Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)
                  ],
              ),
            },
    });
    this.logger.warn(
      `Invite notification job ${jobId} failed on attempt ${attempt} (${this.errorName(error)}).`,
    );
  }

  private getClerkClient() {
    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    if (!secretKey) throw new Error('Clerk is not configured.');
    return createClerkClient({ secretKey });
  }

  private isResendConfigured() {
    return Boolean(
      process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM?.trim(),
    );
  }

  private normalizePhone(phone: string) {
    const trimmed = phone.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) throw new PermanentDeliveryError('Telefone inválido.');
    if (trimmed.startsWith('+')) return `+${digits}`;
    const countryCode = (
      process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? '55'
    ).replace(/\D/g, '');
    return `+${digits.startsWith(countryCode) ? digits : `${countryCode}${digits}`}`;
  }

  private escapeHtml(value: string) {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        })[character] ?? character,
    );
  }

  private positiveInteger(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private errorName(error: unknown) {
    return error instanceof Error ? error.name : 'unknown';
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown delivery error.';
  }
}

class PermanentDeliveryError extends Error {}
