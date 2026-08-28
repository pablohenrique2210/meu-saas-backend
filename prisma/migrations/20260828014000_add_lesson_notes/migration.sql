CREATE TABLE "LessonNote" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LessonNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LessonNote_employeeId_lessonId_key"
ON "LessonNote"("employeeId", "lessonId");

CREATE INDEX "LessonNote_lessonId_idx"
ON "LessonNote"("lessonId");

ALTER TABLE "LessonNote"
ADD CONSTRAINT "LessonNote_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonNote"
ADD CONSTRAINT "LessonNote_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
