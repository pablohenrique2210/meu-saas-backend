-- Add the HR-managed profile fields declared in the Prisma schema.
ALTER TABLE "User"
ADD COLUMN "position" TEXT,
ADD COLUMN "department" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "hireDate" TIMESTAMP(3),
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
