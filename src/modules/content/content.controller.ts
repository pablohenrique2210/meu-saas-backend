import {
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
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import * as fs from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { DatabaseUserGuard } from '../../auth/database-user.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { RhAccessGuard } from '../../auth/rh-access.guard';
import { ContentService } from './content.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { publicUploadUrl, uploadsRootPath } from '../../config/storage';

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

@Controller('courses')
@UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

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

  @Post('upload')
  @UseGuards(RhAccessGuard)
  @Roles(Role.ADMIN, Role.HR_MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_request, _file, callback) => {
          const uploadPath = uploadsRootPath();
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          callback(null, uploadPath);
        },
        filename: (_request, file, callback) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          callback(null, uniqueSuffix + extname(file.originalname));
        },
      }),
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) return { url: '' };
    return {
      url: publicUploadUrl(file.filename),
      originalName: file.originalname,
      mimeType: file.mimetype,
      materialType: this.materialTypeFor(file),
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

  private materialTypeFor(file: Express.Multer.File) {
    const mime = file.mimetype.toLowerCase();
    const extension = extname(file.originalname).toLowerCase();
    if (mime.startsWith('image/')) return 'IMAGE';
    if (mime === 'application/pdf' || extension === '.pdf') return 'PDF';
    if (/word|document/.test(mime) || ['.doc', '.docx'].includes(extension))
      return 'WORD';
    if (/excel|spreadsheet|csv/.test(mime) || ['.xls', '.xlsx', '.csv'].includes(extension))
      return 'SPREADSHEET';
    if (/powerpoint|presentation/.test(mime) || ['.ppt', '.pptx'].includes(extension))
      return 'PRESENTATION';
    if (['.zip', '.rar', '.7z'].includes(extension)) return 'ARCHIVE';
    return 'FILE';
  }
}
