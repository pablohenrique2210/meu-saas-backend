import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { RolesGuard } from '../auth/roles.guard';
import { EmployeeInvitationsController } from './employee-invitations.controller';
import { EmployeeInvitationsService } from './employee-invitations.service';
import { RhAccessGuard } from '../auth/rh-access.guard';

@Module({
  // Rotas estáticas como /invitations e /programs precisam ser registradas
  // antes de /users/:id para não serem interpretadas como IDs de utilizador.
  controllers: [EmployeeInvitationsController, UsersController],
  providers: [
    UsersService,
    EmployeeInvitationsService,
    PrismaService,
    ClerkAuthGuard,
    DatabaseUserGuard,
    RolesGuard,
    RhAccessGuard,
  ],
})
export class UsersModule {}
