import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  IsISO8601,
} from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsOptional()
  author?: string;

  @IsString()
  @IsOptional()
  coverUrl?: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @IsISO8601()
  @IsOptional()
  availableAt?: string | null;

  // 👇 ESTA É A LINHA QUE FALTA PARA O ERRO DESAPARECER!
  @IsArray()
  @IsOptional()
  modules?: any[];
}
