import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { hasRhEmailAccess } from '../auth/rh-access';
import { RhAccessGuard } from '../auth/rh-access.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMyProfile(@CurrentUser() user: User) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  updateMyProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Get('me/rh-access')
  getMyRhAccess(@CurrentUser() user: User) {
    return {
      allowed:
        hasRhEmailAccess(user) &&
        (user.role === Role.ADMIN || user.role === Role.HR_MANAGER),
    };
  }

  @Post()
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  createUser(@CurrentUser() manager: User, @Body() dto: CreateUserDto) {
    return this.usersService.createManagedUser(manager, dto);
  }

  @Get()
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  listUsers(
    @CurrentUser() manager: User,
    @Query('companyId') companyId?: string,
  ) {
    return this.usersService.findEmployeesForHR(manager, companyId);
  }

  @Get(':id')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  getUser(@CurrentUser() manager: User, @Param('id') id: string) {
    return this.usersService.findEmployeeForHR(manager, id);
  }

  @Patch(':id')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  updateUser(
    @CurrentUser() manager: User,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(manager, id, dto);
  }

  @Delete(':id')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  removeUser(@CurrentUser() manager: User, @Param('id') id: string) {
    return this.usersService.remove(manager, id);
  }
}
