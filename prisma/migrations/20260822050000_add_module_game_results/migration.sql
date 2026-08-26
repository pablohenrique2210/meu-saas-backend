CREATE TYPE "ModuleGameType" AS ENUM ('DILEMA', 'INSPECAO', 'CORRIDA');

CREATE TABLE "ModuleGameResult" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "gameType" "ModuleGameType" NOT NULL,
  "finalScore" INTEGER NOT NULL,
  "timeSpentSeconds" INTEGER NOT NULL,
  "metrics" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ModuleGameResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModuleGameResult_employeeId_moduleId_gameType_key"
ON "ModuleGameResult"("employeeId", "moduleId", "gameType");

CREATE INDEX "ModuleGameResult_moduleId_gameType_idx"
ON "ModuleGameResult"("moduleId", "gameType");

CREATE INDEX "ModuleGameResult_completedAt_idx"
ON "ModuleGameResult"("completedAt");

ALTER TABLE "ModuleGameResult"
ADD CONSTRAINT "ModuleGameResult_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ModuleGameResult"
ADD CONSTRAINT "ModuleGameResult_moduleId_fkey"
FOREIGN KEY ("moduleId") REFERENCES "Module"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
