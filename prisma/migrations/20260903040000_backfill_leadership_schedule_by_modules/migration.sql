-- Identifica o Programa Líder em Ação pela estrutura de módulos. Assim, o
-- backfill não depende do título do curso nem dos números salvos em "order".
WITH target_courses AS (
  SELECT module."courseId"
  FROM "Module" AS module
  GROUP BY module."courseId"
  HAVING COUNT(*) >= 8
     AND BOOL_OR(LOWER(module."title") LIKE '%diagn%')
     AND BOOL_OR(LOWER(module."title") LIKE '%papel do l%')
     AND BOOL_OR(LOWER(module."title") LIKE '%comunica%')
     AND BOOL_OR(LOWER(module."title") LIKE '%feedback%')
     AND BOOL_OR(LOWER(module."title") LIKE '%delega%')
     AND BOOL_OR(LOWER(module."title") LIKE '%gest%pessoas%')
     AND BOOL_OR(LOWER(module."title") LIKE '%intelig%emocional%')
     AND BOOL_OR(LOWER(module."title") LIKE '%gest%conflitos%')
),
ranked_modules AS (
  SELECT
    module."id",
    ROW_NUMBER() OVER (
      PARTITION BY module."courseId"
      ORDER BY module."order" ASC, module."id" ASC
    ) - 1 AS "scheduleOrder"
  FROM "Module" AS module
  INNER JOIN target_courses AS course ON course."courseId" = module."courseId"
),
schedule("order", "availableAt") AS (
  VALUES
    (0::BIGINT, TIMESTAMP '2026-09-04 16:00:00'),
    (1::BIGINT, TIMESTAMP '2026-09-11 16:00:00'),
    (2::BIGINT, TIMESTAMP '2026-09-25 16:00:00'),
    (3::BIGINT, TIMESTAMP '2026-10-02 16:00:00'),
    (4::BIGINT, TIMESTAMP '2026-10-09 16:00:00'),
    (5::BIGINT, TIMESTAMP '2026-10-16 16:00:00'),
    (6::BIGINT, TIMESTAMP '2026-10-23 16:00:00'),
    (7::BIGINT, TIMESTAMP '2026-10-30 16:00:00')
)
UPDATE "Module" AS module
SET "availableAt" = schedule."availableAt"
FROM ranked_modules, schedule
WHERE module."id" = ranked_modules."id"
  AND ranked_modules."scheduleOrder" = schedule."order";
