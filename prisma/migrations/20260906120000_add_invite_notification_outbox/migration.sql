CREATE TYPE "InviteNotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP');

CREATE TYPE "InviteNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "InviteNotificationJob" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "channel" "InviteNotificationChannel" NOT NULL,
    "status" "InviteNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InviteNotificationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteNotificationJob_inviteId_channel_key"
ON "InviteNotificationJob"("inviteId", "channel");

CREATE INDEX "InviteNotificationJob_status_nextAttemptAt_idx"
ON "InviteNotificationJob"("status", "nextAttemptAt");

ALTER TABLE "InviteNotificationJob"
ADD CONSTRAINT "InviteNotificationJob_inviteId_fkey"
FOREIGN KEY ("inviteId") REFERENCES "EmployeeInvite"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
