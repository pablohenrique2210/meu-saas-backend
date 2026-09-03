ALTER TABLE "Module" ADD COLUMN "availableAt" TIMESTAMP(3);

-- 13h em America/Sao_Paulo corresponde a 16h UTC nestas datas.
UPDATE "Module" AS module
SET "availableAt" = schedule."availableAt"
FROM "Course" AS course,
  (VALUES
    (0, TIMESTAMP '2026-09-04 16:00:00'),
    (1, TIMESTAMP '2026-09-11 16:00:00'),
    (2, TIMESTAMP '2026-09-25 16:00:00'),
    (3, TIMESTAMP '2026-10-02 16:00:00'),
    (4, TIMESTAMP '2026-10-09 16:00:00'),
    (5, TIMESTAMP '2026-10-16 16:00:00'),
    (6, TIMESTAMP '2026-10-23 16:00:00'),
    (7, TIMESTAMP '2026-10-30 16:00:00')
  ) AS schedule("order", "availableAt")
WHERE module."courseId" = course."id"
  AND course."title" = 'Programa Líder em Ação'
  AND module."order" = schedule."order";
