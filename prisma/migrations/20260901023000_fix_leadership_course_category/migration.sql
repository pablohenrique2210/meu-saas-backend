-- Corrige somente o curso legado que foi classificado como estresse durante a
-- criação inicial. Novos cursos já usam LEADERSHIP_DEVELOPMENT no editor.
UPDATE "Course"
SET "category" = 'LEADERSHIP_DEVELOPMENT'
WHERE "title" = 'Programa Líder em Ação'
  AND "category" = 'STRESS_BURNOUT';
