-- CreateEnum
CREATE TYPE "EmployeeInviteStatus" AS ENUM ('PENDING', 'CLAIMED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "EmployeeInvite" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cpfHash" TEXT NOT NULL,
    "cpfLast4" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "position" TEXT,
    "department" TEXT,
    "phone" TEXT,
    "hireDate" TIMESTAMP(3),
    "status" "EmployeeInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "clerkInvitationId" TEXT,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeInviteCourse" (
    "inviteId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,

    CONSTRAINT "EmployeeInviteCourse_pkey" PRIMARY KEY ("inviteId","courseId")
);

-- CreateTable
CREATE TABLE "UserCourseAccess" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCourseAccess_pkey" PRIMARY KEY ("userId","courseId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeInvite_clerkInvitationId_key" ON "EmployeeInvite"("clerkInvitationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeInvite_claimedByUserId_key" ON "EmployeeInvite"("claimedByUserId");

-- CreateIndex
CREATE INDEX "EmployeeInvite_companyId_status_idx" ON "EmployeeInvite"("companyId", "status");

-- CreateIndex
CREATE INDEX "EmployeeInvite_email_status_idx" ON "EmployeeInvite"("email", "status");

-- CreateIndex
CREATE INDEX "UserCourseAccess_courseId_idx" ON "UserCourseAccess"("courseId");

-- AddForeignKey
ALTER TABLE "EmployeeInvite" ADD CONSTRAINT "EmployeeInvite_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInviteCourse" ADD CONSTRAINT "EmployeeInviteCourse_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "EmployeeInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeInviteCourse" ADD CONSTRAINT "EmployeeInviteCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCourseAccess" ADD CONSTRAINT "UserCourseAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCourseAccess" ADD CONSTRAINT "UserCourseAccess_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
