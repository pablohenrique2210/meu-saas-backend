import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Role } from '@prisma/client';
import { CourseReportPdfService } from '../src/reports/course-report-pdf.service';
import { ReportsService } from '../src/reports/reports.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const manager = await prisma.user.findFirst({
      where: { role: Role.ADMIN, isActive: true },
      orderBy: { name: 'asc' },
    });
    if (!manager) throw new Error('Nenhum administrador ativo foi encontrado.');

    const access = await prisma.userCourseAccess.findFirst({
      where: {
        user: { companyId: manager.companyId, role: { not: Role.ADMIN } },
      },
      orderBy: { grantedAt: 'asc' },
    });
    if (!access) {
      throw new Error('Nenhum curso com colaborador atribuído foi encontrado.');
    }

    const report = await new ReportsService(prisma).buildCourseReport(
      manager,
      access.courseId,
    );
    const pdf = await new CourseReportPdfService().generate(report);
    const outputDirectory = join(process.cwd(), 'output', 'pdf');
    await mkdir(outputDirectory, { recursive: true });
    const outputPath = join(
      outputDirectory,
      'diagnostico-programa-lider-em-acao.pdf',
    );
    await writeFile(outputPath, pdf);
    process.stdout.write(`${outputPath}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
