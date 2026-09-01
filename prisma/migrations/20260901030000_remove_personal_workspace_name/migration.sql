-- Remove o nome pessoal criado automaticamente nas instalações iniciais.
-- Empresas já cadastradas com um nome corporativo permanecem inalteradas.
UPDATE "Company"
SET "name" = 'Empresa principal'
WHERE "name" LIKE 'Workspace de %';
