import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  CourseProgressReport,
  ProgressStatus,
} from './course-report.types';

const COLORS = {
  wine: '#641C32',
  wineLight: '#8F3651',
  ink: '#241A1D',
  muted: '#776A6E',
  paper: '#FAF7F4',
  blush: '#F5EFEC',
  border: '#E9E0E2',
  green: '#2E6B57',
  amber: '#A66A26',
  white: '#FFFFFF',
};

const statusLabel: Record<ProgressStatus, string> = {
  NOT_STARTED: 'Não iniciado',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluído',
};

const gameLabel = {
  DILEMA: 'O Dilema do Gestor',
  INSPECAO: 'Inspeção de Risco',
  CORRIDA: 'Corrida do Conhecimento',
};

@Injectable()
export class CourseReportPdfService {
  generate(report: CourseProgressReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 42, right: 42, bottom: 48, left: 42 },
        bufferPages: true,
        info: {
          Title: `Diagnóstico de aprendizagem e desempenho - ${report.course.title}`,
          Author: 'Lilian Arruda',
          Subject:
            'Relatório de progresso e desempenho nas avaliações por módulo',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.drawCover(doc, report);
      this.drawModuleAnalysis(doc, report);
      this.drawAssessmentAnalysis(doc, report);
      this.drawCollaborators(doc, report);
      this.addFooters(doc, report);
      doc.end();
    });
  }

  private drawCover(doc: PDFKit.PDFDocument, report: CourseProgressReport) {
    doc.rect(0, 0, doc.page.width, 210).fill(COLORS.wine);
    doc
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('LILIAN ARRUDA  •  EDUCAÇÃO CORPORATIVA', 42, 42, {
        characterSpacing: 1.2,
      });
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#E8CED6')
      .text('DIAGNÓSTICO DE APRENDIZAGEM E DESEMPENHO', 42, 84, {
        characterSpacing: 1.1,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(29)
      .fillColor(COLORS.white)
      .text(report.course.title, 42, 108, { width: 500, lineGap: 2 });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#E8CED6')
      .text(
        `${report.company.name}  •  Gerado em ${this.formatDate(report.generatedAt)}`,
        42,
        180,
      );

    doc.y = 238;
    this.sectionTitle(
      doc,
      'Visão executiva',
      'Progresso consolidado do programa',
    );
    const cardY = doc.y + 4;
    const cards = [
      ['Progresso médio', `${report.summary.averageProgress}%`],
      ['Atribuídos', String(report.summary.collaboratorsAssigned)],
      ['Iniciaram', String(report.summary.collaboratorsStarted)],
      ['Concluíram', String(report.summary.collaboratorsCompleted)],
    ];
    cards.forEach(([label, value], index) => {
      const width = 119;
      const x = 42 + index * 128;
      doc.roundedRect(x, cardY, width, 78, 12).fill(COLORS.blush);
      doc
        .font('Helvetica-Bold')
        .fontSize(22)
        .fillColor(COLORS.wine)
        .text(value, x + 13, cardY + 15, { width: width - 26 });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(label.toUpperCase(), x + 13, cardY + 50, {
          width: width - 26,
          characterSpacing: 0.5,
        });
    });

    doc.y = cardY + 94;
    this.sectionTitle(
      doc,
      'Progresso por módulo',
      'Percentual médio de aulas concluídas',
    );
    doc.y += 10;
    report.modules.forEach((module, index) => {
      this.ensureSpace(doc, 26);
      const y = doc.y;
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(COLORS.ink)
        .text(`${index + 1}. ${module.title}`, 42, y, {
          width: 310,
          ellipsis: true,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(COLORS.wine)
        .text(`${module.averageProgress}%`, 500, y, {
          width: 50,
          align: 'right',
        });
      this.progressBar(doc, 42, y + 13, 508, module.averageProgress, 7);
      doc.y = y + 24;
    });

    this.ensureSpace(doc, 118);
    doc.y += 5;
    this.sectionTitle(
      doc,
      'Leitura do diagnóstico',
      'Sinais que merecem atenção do RH',
    );
    doc.y += 8;
    report.insights.forEach((insight) => {
      const y = doc.y;
      doc.circle(48, y + 6, 3).fill(COLORS.wine);
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(COLORS.ink)
        .text(insight, 60, y, { width: 485, lineGap: 2 });
      doc.y += 8;
    });
  }

  private drawModuleAnalysis(
    doc: PDFKit.PDFDocument,
    report: CourseProgressReport,
  ) {
    doc.addPage();
    this.pageHeading(doc, 'Análise por módulo e aula', report.course.title);

    report.modules.forEach((module, moduleIndex) => {
      const height = 74 + Math.max(module.lessons.length, 1) * 24;
      this.ensureSpace(doc, Math.min(height, 330));
      const startY = doc.y;
      doc.roundedRect(42, startY, 508, 56, 12).fill(COLORS.blush);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(COLORS.ink)
        .text(`${moduleIndex + 1}. ${module.title}`, 56, startY + 12, {
          width: 340,
          ellipsis: true,
        });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(
          `${module.totalLessons} aula${module.totalLessons === 1 ? '' : 's'}`,
          56,
          startY + 33,
        );
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(COLORS.wine)
        .text(`${module.averageProgress}%`, 455, startY + 17, {
          width: 78,
          align: 'right',
        });
      doc.y = startY + 67;

      if (module.lessons.length === 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor(COLORS.muted)
          .text('Este módulo ainda não possui aulas cadastradas.', 56, doc.y);
        doc.y += 28;
      } else {
        module.lessons.forEach((lesson, lessonIndex) => {
          this.ensureSpace(doc, 30);
          const y = doc.y;
          doc
            .font('Helvetica')
            .fontSize(8.5)
            .fillColor(COLORS.ink)
            .text(`${lessonIndex + 1}. ${lesson.title}`, 56, y, {
              width: 275,
              ellipsis: true,
            });
          this.progressBar(doc, 342, y + 1, 145, lesson.completionRate, 6);
          doc
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .fillColor(COLORS.wine)
            .text(`${lesson.completionRate}%`, 497, y - 1, {
              width: 36,
              align: 'right',
            });
          doc.y = y + 24;
        });
      }
      doc.y += 12;
    });
  }

  private drawCollaborators(
    doc: PDFKit.PDFDocument,
    report: CourseProgressReport,
  ) {
    doc.addPage();
    this.pageHeading(doc, 'Progresso por colaborador', report.course.title);

    if (report.collaborators.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor(COLORS.muted)
        .text('Nenhum colaborador atribuído ao curso.', 42, doc.y + 20);
      return;
    }

    report.collaborators.forEach((collaborator) => {
      const cardHeight = 104 + collaborator.modules.length * 30;
      this.ensureSpace(doc, Math.min(cardHeight, 410));
      const startY = doc.y;
      doc
        .roundedRect(42, startY, 508, cardHeight, 14)
        .lineWidth(1)
        .fillAndStroke(COLORS.white, COLORS.border);
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(COLORS.ink)
        .text(collaborator.name, 58, startY + 16, {
          width: 325,
          ellipsis: true,
        });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(
          [collaborator.position, collaborator.department]
            .filter(Boolean)
            .join(' • ') || 'Cargo e departamento não informados',
          58,
          startY + 36,
          { width: 325, ellipsis: true },
        );
      const statusColor =
        collaborator.status === 'COMPLETED'
          ? COLORS.green
          : collaborator.status === 'IN_PROGRESS'
            ? COLORS.amber
            : COLORS.muted;
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(statusColor)
        .text(
          statusLabel[collaborator.status].toUpperCase(),
          395,
          startY + 18,
          {
            width: 137,
            align: 'right',
            characterSpacing: 0.5,
          },
        );
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(COLORS.wine)
        .text(`${collaborator.overallProgress}%`, 462, startY + 37, {
          width: 70,
          align: 'right',
        });
      doc
        .moveTo(58, startY + 68)
        .lineTo(534, startY + 68)
        .strokeColor(COLORS.border)
        .stroke();
      doc.y = startY + 82;

      collaborator.modules.forEach((module, index) => {
        const y = doc.y;
        const moduleHasEvaluation = report.modules.some(
          (reportModule) =>
            reportModule.id === module.moduleId &&
            Boolean(reportModule.evaluation),
        );
        doc
          .font('Helvetica')
          .fontSize(8.2)
          .fillColor(COLORS.ink)
          .text(`${index + 1}. ${module.title}`, 58, y, {
            width: 210,
            ellipsis: true,
          });
        if (module.evaluation) {
          doc
            .font('Helvetica-Bold')
            .fontSize(7.5)
            .fillColor(COLORS.green)
            .text(`Avaliação: ${module.evaluation.finalScore} pts`, 270, y, {
              width: 112,
              align: 'right',
            });
        } else if (moduleHasEvaluation) {
          doc
            .font('Helvetica')
            .fontSize(7.5)
            .fillColor(COLORS.muted)
            .text('Avaliação pendente', 270, y, { width: 112, align: 'right' });
        } else {
          doc
            .font('Helvetica')
            .fontSize(7.5)
            .fillColor(COLORS.muted)
            .text('Sem avaliação', 270, y, { width: 112, align: 'right' });
        }
        this.progressBar(doc, 392, y + 1, 90, module.progress, 6);
        doc
          .font('Helvetica-Bold')
          .fontSize(8.2)
          .fillColor(COLORS.wine)
          .text(`${module.progress}%`, 492, y - 1, {
            width: 40,
            align: 'right',
          });
        doc.y = y + 30;
      });
      doc.y = startY + cardHeight + 14;
    });
  }

  private drawAssessmentAnalysis(
    doc: PDFKit.PDFDocument,
    report: CourseProgressReport,
  ) {
    doc.addPage();
    this.pageHeading(
      doc,
      'Desempenho nas avaliações',
      `${report.course.title} - Empresa ${report.company.name}`,
    );

    const cards = [
      ['Avaliações configuradas', String(report.summary.evaluationsConfigured)],
      ['Resultados recebidos', String(report.summary.evaluationsCompleted)],
      ['Participação', `${report.summary.evaluationParticipationRate}%`],
      ['Aproveitamento médio', `${report.summary.averageEvaluationScore}%`],
    ];
    const cardY = doc.y;
    cards.forEach(([label, value], index) => {
      const width = 119;
      const x = 42 + index * 128;
      doc.roundedRect(x, cardY, width, 76, 12).fill(COLORS.blush);
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(COLORS.wine)
        .text(value, x + 12, cardY + 14, { width: width - 24 });
      doc
        .font('Helvetica')
        .fontSize(7.7)
        .fillColor(COLORS.muted)
        .text(label.toUpperCase(), x + 12, cardY + 48, {
          width: width - 24,
          characterSpacing: 0.35,
        });
    });
    doc.y = cardY + 100;

    const configured = report.modules.filter((module) => module.evaluation);
    const configuredLessonQuizzes = report.modules.flatMap((module) =>
      module.lessons
        .filter((lesson) => lesson.quizConfigured)
        .map((lesson) => ({ moduleTitle: module.title, lesson })),
    );
    if (configured.length === 0 && configuredLessonQuizzes.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.muted)
        .text(
          'Ainda não existem avaliações configuradas nos módulos deste curso.',
          42,
          doc.y + 12,
        );
      return;
    }

    configured.forEach((module, index) => {
      const evaluation = module.evaluation!;
      this.ensureSpace(doc, 92);
      const y = doc.y;
      doc
        .roundedRect(42, y, 508, 78, 12)
        .lineWidth(1)
        .fillAndStroke(COLORS.white, COLORS.border);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(COLORS.ink)
        .text(`${index + 1}. ${module.title}`, 56, y + 13, {
          width: 285,
          ellipsis: true,
        });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(gameLabel[evaluation.gameType], 56, y + 33, { width: 285 });
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(COLORS.wine)
        .text(`${evaluation.completedCount} resultado(s)`, 365, y + 15, {
          width: 165,
          align: 'right',
        });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(
          `Média: ${evaluation.averageScore} pts | Tempo: ${this.formatDuration(evaluation.averageTimeSpentSeconds)}`,
          330,
          y + 35,
          { width: 200, align: 'right' },
        );
      this.progressBar(doc, 56, y + 57, 474, evaluation.participationRate, 7);
      doc.y = y + 92;
    });

    if (configuredLessonQuizzes.length > 0) {
      this.ensureSpace(doc, 54);
      this.sectionTitle(
        doc,
        'Quizzes ao final das aulas',
        'Aproveitamento objetivo registrado imediatamente para o RH.',
      );
      configuredLessonQuizzes.forEach(({ moduleTitle, lesson }, index) => {
        this.ensureSpace(doc, 82);
        const y = doc.y;
        doc
          .roundedRect(42, y, 508, 68, 12)
          .lineWidth(1)
          .fillAndStroke(COLORS.white, COLORS.border);
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(COLORS.ink)
          .text(`${index + 1}. ${lesson.title}`, 56, y + 12, {
            width: 285,
            ellipsis: true,
          });
        doc
          .font('Helvetica')
          .fontSize(7.8)
          .fillColor(COLORS.muted)
          .text(moduleTitle, 56, y + 31, { width: 285, ellipsis: true });
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .fillColor(COLORS.wine)
          .text(
            `${lesson.quizCompletedCount} resultado(s) • média ${lesson.averageQuizScore}%`,
            340,
            y + 14,
            { width: 190, align: 'right' },
          );
        this.progressBar(doc, 56, y + 50, 474, lesson.quizParticipationRate, 7);
        doc.y = y + 82;
      });
    }
  }

  private pageHeading(
    doc: PDFKit.PDFDocument,
    title: string,
    subtitle: string,
  ) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.wine)
      .text('DIAGNÓSTICO DE APRENDIZAGEM E DESEMPENHO', 42, 42, {
        characterSpacing: 0.9,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(23)
      .fillColor(COLORS.ink)
      .text(title, 42, 68);
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(COLORS.muted)
      .text(subtitle, 42, 101, { width: 508, ellipsis: true });
    doc.moveTo(42, 124).lineTo(550, 124).strokeColor(COLORS.border).stroke();
    doc.y = 146;
  }

  private sectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
    subtitle: string,
  ) {
    const y = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(COLORS.ink)
      .text(title, 42, y);
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.muted)
      .text(subtitle, 42, y + 23);
    doc.y = y + 36;
  }

  private progressBar(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    value: number,
    height = 8,
  ) {
    const safeValue = Math.max(0, Math.min(100, value));
    doc.roundedRect(x, y, width, height, height / 2).fill(COLORS.border);
    if (safeValue > 0) {
      doc
        .roundedRect(
          x,
          y,
          Math.max(height, (width * safeValue) / 100),
          height,
          height / 2,
        )
        .fill(COLORS.wineLight);
    }
  }

  private ensureSpace(doc: PDFKit.PDFDocument, height: number) {
    if (doc.y + height > doc.page.height - 58) {
      doc.addPage();
      doc.y = 48;
    }
  }

  private addFooters(doc: PDFKit.PDFDocument, report: CourseProgressReport) {
    const range = doc.bufferedPageRange();
    for (
      let index = range.start;
      index < range.start + range.count;
      index += 1
    ) {
      doc.switchToPage(index);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(
          `Documento confidencial • ${report.company.name}`,
          42,
          doc.page.height - 62,
          { width: 390 },
        );
      doc.text(`${index + 1} / ${range.count}`, 485, doc.page.height - 62, {
        width: 65,
        align: 'right',
      });
    }
  }

  private formatDate(value: string) {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'long',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(value));
  }

  private formatDuration(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return minutes > 0 ? `${minutes}min ${remaining}s` : `${remaining}s`;
  }
}
