import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DatabaseUserGuard } from '../auth/database-user.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RhAccessGuard } from '../auth/rh-access.guard';
import { CourseReportPdfService } from './course-report-pdf.service';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(ClerkAuthGuard, DatabaseUserGuard, RolesGuard, RhAccessGuard)
@Roles(Role.ADMIN, Role.HR_MANAGER)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly pdfService: CourseReportPdfService,
  ) {}

  @Get('courses')
  listCourses(@CurrentUser() manager: User) {
    return this.reportsService.listCourses(manager);
  }

  @Get('courses/:courseId/preview')
  preview(
    @CurrentUser() manager: User,
    @Param('courseId') courseId: string,
  ) {
    return this.reportsService.buildCourseReport(manager, courseId);
  }

  @Get('courses/:courseId/pdf')
  async download(
    @CurrentUser() manager: User,
    @Param('courseId') courseId: string,
    @Res() response: Response,
  ) {
    const report = await this.reportsService.buildCourseReport(manager, courseId);
    const pdf = await this.pdfService.generate(report);
    const filename = `diagnostico-${this.slug(report.company.name)}-${this.slug(report.course.title)}.pdf`;
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', pdf.length);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    response.send(pdf);
  }

  private slug(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 80);
  }
}
