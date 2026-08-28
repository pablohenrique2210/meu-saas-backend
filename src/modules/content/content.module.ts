import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { DatabaseUserGuard } from '../../auth/database-user.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { RhAccessGuard } from '../../auth/rh-access.guard';
import { UploadService } from './upload.service';

@Module({
  controllers: [ContentController],
  providers: [
    ContentService,
    PrismaService,
    ClerkAuthGuard,
    DatabaseUserGuard,
    RolesGuard,
    RhAccessGuard,
    UploadService,
  ],
})
export class ContentModule {}
