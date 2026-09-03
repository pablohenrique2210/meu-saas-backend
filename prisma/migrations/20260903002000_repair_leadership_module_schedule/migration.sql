-- Reaplica a agenda usando uma correspondência tolerante ao título e à
-- numeração armazenada. A migração anterior dependia de título e order exatos.
WITH target_courses AS (
  SELECT course."id"
  FROM "Course" AS course
  WHERE LOWER(BTRIM(course."title")) LIKE '%líder em ação%'
     OR LOWER(BTRIM(course."title")) LIKE '%lider em acao%'
),
ranked_modules AS (
  SELECT
    module."id",
    ROW_NUMBER() OVER (
      PARTITION BY module."courseId"
      ORDER BY module."order" ASC, module."id" ASC
    ) - 1 AS "scheduleOrder"
  FROM "Module" AS module
  INNER JOIN target_courses AS course ON course."id" = module."courseId"
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
