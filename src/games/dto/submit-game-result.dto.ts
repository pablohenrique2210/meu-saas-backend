import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ModuleGameType } from '../game-types';

export class SubmitGameResultDto {
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @IsUUID()
  moduleId: string;

  @IsEnum(ModuleGameType)
  gameType: ModuleGameType;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  finalScore: number;

  @IsInt()
  @Min(1)
  @Max(21_600)
  timeSpentSeconds: number;

  @IsObject()
  metrics: Record<string, unknown>;
}
