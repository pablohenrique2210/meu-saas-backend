import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateEmployeeInviteDto {
  @IsUUID('4')
  @IsOptional()
  companyId?: string;

  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  cpf: string;

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

  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione pelo menos um programa.' })
  @ArrayUnique()
  @IsUUID('4', { each: true })
  courseIds: string[];
}
