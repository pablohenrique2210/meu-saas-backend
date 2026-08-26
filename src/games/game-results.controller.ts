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
import { CurrentUser } from '../auth/current-user.decorator';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RhAccessGuard } from '../auth/rh-access.guard';
import { ListGameResultsDto } from './dto/list-game-results.dto';
import { SubmitGameResultDto } from './dto/submit-game-result.dto';
import { GameResultsService } from './game-results.service';

@Controller('game-results')
@UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard)
export class GameResultsController {
  constructor(private readonly gameResultsService: GameResultsService) {}

  @Post()
  submitResult(@CurrentUser() user: User, @Body() dto: SubmitGameResultDto) {
    return this.gameResultsService.submit(user, dto);
  }

  @Get('modules/:moduleId')
  getModuleGame(
    @CurrentUser() user: User,
    @Param('moduleId') moduleId: string,
  ) {
    return this.gameResultsService.getModuleGame(user, moduleId);
  }

  @Get()
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  listForHR(
    @CurrentUser() manager: User,
    @Query() filters: ListGameResultsDto,
  ) {
    return this.gameResultsService.listForHR(manager, filters);
  }
}
