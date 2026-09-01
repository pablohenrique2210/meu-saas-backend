import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentClerkUserId } from '../auth/current-clerk-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RhAccessGuard } from '../auth/rh-access.guard';
import { ClaimEmployeeInviteDto } from './dto/claim-employee-invite.dto';
import { CreateEmployeeInviteDto } from './dto/create-employee-invite.dto';
import { EmployeeInvitationsService } from './employee-invitations.service';

@Controller('users')
export class EmployeeInvitationsController {
  constructor(
    private readonly employeeInvitationsService: EmployeeInvitationsService,
  ) {}

  @Post('claim')
  @UseGuards(ClerkAuthGuard)
  claim(
    @CurrentClerkUserId() clerkUserId: string,
    @Body() dto: ClaimEmployeeInviteDto,
  ) {
    return this.employeeInvitationsService.claim(clerkUserId, dto);
  }

  @Get('claim/status')
  @UseGuards(ClerkAuthGuard)
  getClaimStatus(@CurrentClerkUserId() clerkUserId: string) {
    return this.employeeInvitationsService.getActivationStatus(clerkUserId);
  }

  @Get('programs')
  @UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard, RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  listPrograms() {
    return this.employeeInvitationsService.listPrograms();
  }

  @Get('invitations')
  @UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard, RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  listInvitations(
    @CurrentUser() manager: User,
    @Query('companyId') companyId?: string,
  ) {
    return this.employeeInvitationsService.list(manager, companyId);
  }

  @Post('invitations')
  @UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard, RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  createInvitation(
    @CurrentUser() manager: User,
    @Body() dto: CreateEmployeeInviteDto,
  ) {
    return this.employeeInvitationsService.create(manager, dto);
  }

  @Post('invitations/:id/revoke')
  @UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard, RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  revokeInvitation(@CurrentUser() manager: User, @Param('id') id: string) {
    return this.employeeInvitationsService.revoke(manager, id);
  }

  @Get('invitations/:id/link')
  @UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard, RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  getInvitationLink(@CurrentUser() manager: User, @Param('id') id: string) {
    return this.employeeInvitationsService.getInvitationLink(manager, id);
  }
}
