ALTER TABLE "Lesson"
ADD COLUMN "minimumWatchSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "LessonProgress"
ADD COLUMN "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Existing video lessons initially require the duration already configured by
-- the course administrator. The value can be adjusted per lesson afterwards.
UPDATE "Lesson"
SET "minimumWatchSeconds" = "duration" * 60
WHERE "type" = 'VIDEO'
  AND "duration" > 0
  AND (
    LOWER(COALESCE("contentUrl", '')) LIKE '%.mp4%'
    OR LOWER(COALESCE("contentUrl", '')) LIKE '%.webm%'
  );
