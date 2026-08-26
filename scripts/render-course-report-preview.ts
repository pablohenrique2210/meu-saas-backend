import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CourseReportPdfService } from '../src/reports/course-report-pdf.service';
import { ReportsService } from '../src/reports/reports.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const manager = await prisma.user.findFirstOrThrow({
      where: { role: { in: ['ADMIN', 'HR_MANAGER'] } },
    });
    const result = await prisma.moduleGameResult.findFirstOrThrow({
      where: { employee: { companyId: manager.companyId } },
      select: { module: { select: { courseId: true } } },
    });
    const report = await new ReportsService(prisma).buildCourseReport(
      manager,
      result.module.courseId,
    );
    const pdf = await new CourseReportPdfService().generate(report);
    const outputDirectory = resolve('output', 'pdf');
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = resolve(outputDirectory, 'diagnostico-rosset.pdf');
    await writeFile(outputPath, pdf);
    process.stdout.write(outputPath);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
