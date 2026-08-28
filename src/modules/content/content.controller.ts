import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import {
  IsBoolean,
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IsInt, Matches, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { diskStorage, memoryStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'node:crypto';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { DatabaseUserGuard } from '../../auth/database-user.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { RhAccessGuard } from '../../auth/rh-access.guard';
import { ContentService } from './content.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { ensureUploadsRootPath, publicUploadUrl } from '../../config/storage';
import { UploadService } from './upload.service';
import { issueUploadSessionToken } from '../../auth/upload-session-token';

export class UpdateProgressDto {
  @IsString()
  lessonId: string;

  @IsNumber()
  @Min(0)
  lastTime: number;

  @IsBoolean()
  @IsOptional()
  isCompleted?: boolean;
}

export class UploadChunkDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9-]{8,80}$/)
  uploadId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  chunkIndex: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  totalChunks: number;

  @IsString()
  originalName: string;

  @IsString()
  @IsOptional()
  mimeType?: string;
}

export class LessonQuizAnswerDto {
  @IsString()
  questionId: string;

  @IsString()
  selectedOptionId: string;
}

export class SubmitLessonQuizDto {
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LessonQuizAnswerDto)
  answers: LessonQuizAnswerDto[];
}

export class SaveLessonNoteDto {
  @IsString()
  @MaxLength(20_000)
  content: string;
}

@Controller('courses')
@UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard)
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly uploadService: UploadService,
  ) {}

  @Post('progress')
  updateProgress(@CurrentUser() user: User, @Body() dto: UpdateProgressDto) {
    return this.contentService.updateProgress(
      user,
      dto.lessonId,
      dto.lastTime,
      dto.isCompleted,
    );
  }

  @Get('user-progress')
  getUserProgressAll(@CurrentUser() user: User) {
    return this.contentService.getUserProgressAll(user);
  }

  @Get('progress/:lessonId')
  async getProgress(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
  ) {
    return this.contentService.getProgress(user, lessonId);
  }

  @Get('lessons/:lessonId/quiz')
  getLessonQuiz(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
  ) {
    return this.contentService.getLessonQuiz(user, lessonId);
  }

  @Post('lessons/:lessonId/quiz')
  submitLessonQuiz(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
    @Body() dto: SubmitLessonQuizDto,
  ) {
    return this.contentService.submitLessonQuiz(user, lessonId, dto.answers);
  }

  @Get('lessons/:lessonId/note')
  getLessonNote(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
  ) {
    return this.contentService.getLessonNote(user, lessonId);
  }

  @Put('lessons/:lessonId/note')
  saveLessonNote(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
    @Body() dto: SaveLessonNoteDto,
  ) {
    return this.contentService.saveLessonNote(user, lessonId, dto.content);
  }

  @Post('upload')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          try {
            callback(null, ensureUploadsRootPath());
          } catch (error) {
            callback(
              error instanceof Error
                ? error
                : new Error('A pasta de uploads não está disponível.'),
              '',
            );
          }
        },
        filename: (_request, file, callback) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          callback(null, uniqueSuffix + extname(file.originalname));
        },
      }),
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo foi recebido.');
    return {
      url: publicUploadUrl(file.filename),
      originalName: file.originalname,
      mimeType: file.mimetype,
      materialType: this.uploadService.materialTypeFor(
        file.mimetype,
        file.originalname,
      ),
    };
  }

  @Post('upload/chunk')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  uploadChunk(
    @Body() body: UploadChunkDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.uploadService.storeChunk(body, file);
  }

  @Post('upload/session')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  createUploadSession(@CurrentUser() user: User) {
    const uploadId = randomUUID();
    return {
      uploadId,
      uploadToken: issueUploadSessionToken(uploadId, user.id),
      expiresInSeconds: 2 * 60 * 60,
    };
  }

  @Get('materials/:filename/download')
  async downloadMaterial(
    @CurrentUser() user: User,
    @Param('filename') filename: string,
    @Res() response: Response,
  ) {
    const material = await this.contentService.getDownloadableMaterial(
      user,
      filename,
    );
    response.download(material.path, material.downloadName);
  }

  @Put(':id')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  updateCourse(@Param('id') id: string, @Body() body: unknown) {
    return this.contentService.updateCourse(id, body);
  }

  @Post()
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  createCourse(@Body() dto: CreateCourseDto) {
    return this.contentService.createCourse(dto);
  }

  @Get()
  getCourses(@CurrentUser() user: User) {
    return this.contentService.findAvailableCourses(user);
  }

  @Get(':id')
  getCourseById(@CurrentUser() user: User, @Param('id') id: string) {
    return this.contentService.getFullCourse(user, id);
  }

  @Delete(':id')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  deleteCourse(@Param('id') id: string) {
    return this.contentService.deleteCourse(id);
  }
}
