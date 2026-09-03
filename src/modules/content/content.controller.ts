import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
  IsIn,
  IsArray,
  ArrayMinSize,
  IsNumber,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IsInt, Matches, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { DatabaseUserGuard } from '../../auth/database-user.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { RhAccessGuard } from '../../auth/rh-access.guard';
import { ContentService } from './content.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UploadService } from './upload.service';
import { AssetStorageService } from './asset-storage.service';
import { issueUploadSessionToken } from '../../auth/upload-session-token';
import { publicUploadUrl } from '../../config/storage';

export class UpdateProgressDto {
  @IsString()
  lessonId: string;

  @IsNumber()
  @Min(0)
  @Max(24 * 60 * 60)
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
  @IsOptional()
  selectedOptionId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsOptional()
  selectedOptionIds?: string[];
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

export class CourseScheduleLessonDto {
  @IsString()
  id: string;

  @IsISO8601()
  @IsOptional()
  availableAt?: string | null;
}

export class CourseScheduleModuleDto {
  @IsString()
  id: string;

  @IsISO8601()
  @IsOptional()
  availableAt?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseScheduleLessonDto)
  lessons: CourseScheduleLessonDto[];
}

export class UpdateCourseScheduleDto {
  @IsISO8601()
  @IsOptional()
  availableAt?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseScheduleModuleDto)
  modules: CourseScheduleModuleDto[];
}

export class LinkLessonVideoDto {
  @IsString()
  @MaxLength(1024)
  contentUrl: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  @IsOptional()
  durationSeconds?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  @IsOptional()
  minimumWatchSeconds?: number;
}

export class DirectUploadSessionDto {
  @IsString()
  @MaxLength(255)
  originalName: string;

  @IsString()
  @MaxLength(150)
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024 * 1024)
  size: number;
}

export class CompleteDirectUploadDto {
  @IsString()
  @MaxLength(1024)
  uploadId: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]{1,12})?$/)
  filename: string;

  @IsString()
  @MaxLength(255)
  originalName: string;

  @IsString()
  @MaxLength(150)
  mimeType: string;

  @IsString()
  @IsIn(['MATERIAL', 'COVER'])
  @IsOptional()
  purpose?: 'MATERIAL' | 'COVER';
}

export class AbortDirectUploadDto {
  @IsString()
  @MaxLength(1024)
  uploadId: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]{1,12})?$/)
  filename: string;
}

@Controller('courses')
@UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard)
export class ContentController {
  constructor(
    private readonly contentService: ContentService,
    private readonly uploadService: UploadService,
    private readonly assets: AssetStorageService,
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

  @Get('lessons/:lessonId/playback')
  @Header('Cache-Control', 'private, no-store')
  getLessonPlayback(
    @CurrentUser() user: User,
    @Param('lessonId') lessonId: string,
  ) {
    return this.contentService.getLessonPlayback(user, lessonId);
  }

  @Put('lessons/:lessonId/video')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  linkLessonVideo(
    @Param('lessonId') lessonId: string,
    @Body() dto: LinkLessonVideoDto,
  ) {
    return this.contentService.linkLessonVideo(
      lessonId,
      dto.contentUrl,
      dto.durationSeconds,
      dto.minimumWatchSeconds,
    );
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
      limits: { fileSize: 8 * 1024 * 1024 },
      storage: memoryStorage(),
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.storeFile(file);
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

  @Post('upload/direct/session')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  createDirectUploadSession(@Body() dto: DirectUploadSessionDto) {
    return this.assets.createDirectUpload(
      dto.originalName,
      dto.mimeType,
      dto.size,
    );
  }

  @Post('upload/direct/complete')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  async completeDirectUpload(@Body() dto: CompleteDirectUploadDto) {
    await this.assets.completeDirectUpload(dto.filename, dto.uploadId);
    return {
      complete: true,
      // Materiais ficam atrás da autenticação. Capas precisam ser públicas
      // para aparecer no catálogo, mas continuam armazenadas no Bunny Storage.
      url:
        dto.purpose === 'COVER'
          ? publicUploadUrl(dto.filename)
          : `/api/courses/materials/${encodeURIComponent(dto.filename)}/download`,
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      materialType: this.uploadService.materialTypeFor(
        dto.mimeType,
        dto.originalName,
      ),
    };
  }

  @Post('upload/direct/abort')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  async abortDirectUpload(@Body() dto: AbortDirectUploadDto) {
    await this.assets.abortDirectUpload(dto.filename, dto.uploadId);
    return { aborted: true };
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
    if (material.signedUrl) {
      response.setHeader('Cache-Control', 'private, no-store');
      response.redirect(302, material.signedUrl);
      return;
    }
    if (!material.asset) {
      throw new BadRequestException('Material sem fonte de download.');
    }
    response.setHeader('Content-Type', material.asset.contentType);
    response.setHeader('Content-Length', String(material.asset.contentLength));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(material.downloadName)}`,
    );
    material.asset.body.pipe(response);
  }

  @Put(':id')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  updateCourse(@Param('id') id: string, @Body() body: unknown) {
    return this.contentService.updateCourse(id, body);
  }

  @Put(':id/schedule')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  updateCourseSchedule(
    @Param('id') id: string,
    @Body() dto: UpdateCourseScheduleDto,
  ) {
    return this.contentService.updateCourseSchedule(id, dto);
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
