import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ModuleGameType } from '../game-types';

export class ListGameResultsDto {
  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsUUID()
  @IsOptional()
  moduleId?: string;

  @IsEnum(ModuleGameType)
  @IsOptional()
  gameType?: ModuleGameType;
}
