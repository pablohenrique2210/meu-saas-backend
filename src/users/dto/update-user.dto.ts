import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class UpdateUserDto {
  @IsUUID('4')
  @IsOptional()
  companyId?: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  courseIds?: string[];

  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsString()
  @IsOptional()
  position?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  hireDate?: Date;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
