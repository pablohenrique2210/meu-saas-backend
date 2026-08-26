import { Module } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { GameResultsController } from './game-results.controller';
import { GameResultsService } from './game-results.service';
import { RhAccessGuard } from '../auth/rh-access.guard';

@Module({
  controllers: [GameResultsController],
  providers: [
    GameResultsService,
    PrismaService,
    ClerkAuthGuard,
    DatabaseUserGuard,
    RolesGuard,
    RhAccessGuard,
  ],
})
export class GamesModule {}
