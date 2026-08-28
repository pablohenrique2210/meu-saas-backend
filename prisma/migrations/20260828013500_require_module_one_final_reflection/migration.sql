-- Resultados anteriores pertenciam ao questionário único de 11 perguntas.
-- Eles não podem liberar o próximo módulo sem a nova reflexão final.
DELETE FROM "ModuleGameResult" AS result
USING "Module" AS module, "Course" AS course
WHERE result."moduleId" = module."id"
  AND module."courseId" = course."id"
  AND module."order" = 0
  AND course."title" = 'Programa Líder em Ação';
