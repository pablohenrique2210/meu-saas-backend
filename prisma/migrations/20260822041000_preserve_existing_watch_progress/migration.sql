UPDATE "LessonProgress"
SET "watchedSeconds" = GREATEST(0, "lastTime")
WHERE "watchedSeconds" = 0 AND "lastTime" > 0;
