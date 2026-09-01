import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { CompaniesService } from './companies.service';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { RhAccessGuard } from '../auth/rh-access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('companies')
@UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard, RhAccessGuard)
@Roles(Role.ADMIN, Role.HR_MANAGER)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  findAvailable(@CurrentUser() manager: User) {
    return this.companiesService.findAvailable(manager);
  }
}
