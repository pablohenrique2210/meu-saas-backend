import type { User } from '@prisma/client';

export const RH_ALLOWED_EMAILS_ENV = 'RH_ALLOWED_EMAILS';

export function getRhAllowedEmails() {
  return (process.env[RH_ALLOWED_EMAILS_ENV] ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function hasRhEmailAccess(user: Pick<User, 'email'> | undefined) {
  if (!user?.email) return false;
  return getRhAllowedEmails().includes(user.email.trim().toLowerCase());
}
