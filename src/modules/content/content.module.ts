import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClerkAuthGuard } from '../../auth/clerk-auth.guard';
import { DatabaseUserGuard } from '../../auth/database-user.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { RhAccessGuard } from '../../auth/rh-access.guard';
import { UploadService } from './upload.service';
import { AssetStorageService } from './asset-storage.service';
import { MediaController } from './media.controller';

@Module({
  controllers: [ContentController, MediaController],
  providers: [
    ContentService,
    PrismaService,
    ClerkAuthGuard,
    DatabaseUserGuard,
    RolesGuard,
    RhAccessGuard,
    UploadService,
    AssetStorageService,
  ],
})
export class ContentModule {}
