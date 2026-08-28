ALTER TABLE "Lesson"
ADD COLUMN "quizConfig" JSONB;

CREATE TABLE "LessonQuizResult" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "finalScore" INTEGER NOT NULL,
  "correctAnswers" INTEGER NOT NULL,
  "totalQuestions" INTEGER NOT NULL,
  "metrics" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LessonQuizResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LessonQuizResult_employeeId_lessonId_key"
ON "LessonQuizResult"("employeeId", "lessonId");

CREATE INDEX "LessonQuizResult_lessonId_idx"
ON "LessonQuizResult"("lessonId");

CREATE INDEX "LessonQuizResult_completedAt_idx"
ON "LessonQuizResult"("completedAt");

ALTER TABLE "LessonQuizResult"
ADD CONSTRAINT "LessonQuizResult_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonQuizResult"
ADD CONSTRAINT "LessonQuizResult_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- As cinco primeiras perguntas ficam ao final da Aula 1 e as cinco
-- seguintes ao final da Aula 2.
UPDATE "Lesson" AS lesson
SET "quizConfig" = jsonb_build_object(
  'title', CASE
    WHEN lesson."order" = 0 THEN 'Quiz 1 — Autoconhecimento na Liderança'
    ELSE 'Quiz 2 — Competências de Liderança'
  END,
  'questions', (
    SELECT jsonb_agg(question.value ORDER BY question.ordinality)
    FROM jsonb_array_elements(module."gameConfig"->'questions')
      WITH ORDINALITY AS question(value, ordinality)
    WHERE question.ordinality BETWEEN
      CASE WHEN lesson."order" = 0 THEN 1 ELSE 6 END
      AND CASE WHEN lesson."order" = 0 THEN 5 ELSE 10 END
  )
)
FROM "Module" AS module
JOIN "Course" AS course ON course."id" = module."courseId"
WHERE lesson."moduleId" = module."id"
  AND lesson."order" IN (0, 1)
  AND module."order" = 0
  AND course."title" = 'Programa Líder em Ação';

-- A pergunta 11 permanece como a única avaliação final do módulo.
UPDATE "Module" AS module
SET
  "gameType" = 'CORRIDA'::"ModuleGameType",
  "gameConfig" = jsonb_build_object(
    'questions', jsonb_build_array(module."gameConfig"->'questions'->10)
  )
WHERE module."order" = 0
  AND EXISTS (
    SELECT 1
    FROM "Course" AS course
    WHERE course."id" = module."courseId"
      AND course."title" = 'Programa Líder em Ação'
  );
