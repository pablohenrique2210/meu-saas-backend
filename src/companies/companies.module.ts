import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompaniesController } from './companies.controller';
import { PrismaService } from '../prisma/prisma.service'; // 👈 Importa aqui
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { RhAccessGuard } from '../auth/rh-access.guard';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [CompaniesController],
  providers: [
    CompaniesService,
    PrismaService,
    ClerkAuthGuard,
    DatabaseUserGuard,
    RolesGuard,
    RhAccessGuard,
  ],
})
export class CompaniesModule {}
