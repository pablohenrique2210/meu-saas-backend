import { Module } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CourseReportPdfService } from './course-report-pdf.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { RhAccessGuard } from '../auth/rh-access.guard';

@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    CourseReportPdfService,
    PrismaService,
    ClerkAuthGuard,
    DatabaseUserGuard,
    RolesGuard,
    RhAccessGuard,
  ],
  exports: [ReportsService, CourseReportPdfService],
})
export class ReportsModule {}
