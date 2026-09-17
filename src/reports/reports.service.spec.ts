import { Role, LessonType } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

const manager: User = {
  id: 'manager_1',
  companyId: 'company_1',
  name: 'RH',
  email: 'rh@example.com',
  role: Role.HR_MANAGER,
  position: null,
  department: null,
  phone: null,
  hireDate: null,
  isActive: true,
};

describe('ReportsService course start metrics', () => {
  const prisma = {
    course: { findFirst: jest.fn() },
    company: { findUnique: jest.fn() },
    userCourseAccess: { findMany: jest.fn() },
    employeeInvite: { findMany: jest.fn() },
    lessonProgress: { findMany: jest.fn() },
    moduleGameResult: { findMany: jest.fn() },
    lessonQuizResult: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.course.findFirst.mockResolvedValue({
      id: 'course_1',
      title: 'Programa Líder em Ação',
      description: 'Curso corporativo',
      category: 'Liderança',
      author: 'Lilian Arruda',
      modules: [
        {
          id: 'module_1',
          title: 'Diagnóstico',
          order: 0,
          gameType: null,
          lessons: [
            {
              id: 'lesson_1',
              title: 'Aula 1',
              order: 0,
              type: LessonType.VIDEO,
              duration: 10,
              minimumWatchSeconds: 60,
              quizConfig: null,
            },
          ],
        },
      ],
    });
    prisma.company.findUnique.mockResolvedValue({
      id: 'company_1',
      name: 'Empresa Teste',
    });
    prisma.userCourseAccess.findMany.mockResolvedValue(
      Array.from({ length: 17 }, (_, index) => ({
        userId: `user_${index + 1}`,
        user: {
          id: `user_${index + 1}`,
          name: `Colaborador ${index + 1}`,
          email: `user${index + 1}@example.com`,
          position: null,
          department: null,
          isActive: true,
        },
      })),
    );
    prisma.employeeInvite.findMany.mockResolvedValue([]);
    prisma.lessonProgress.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        id: `progress_${index + 1}`,
        userId: `user_${index + 1}`,
        lessonId: 'lesson_1',
        lastTime: index < 5 ? 10 : 0,
        watchedSeconds: index < 5 ? 10 : 0,
        isCompleted: false,
        lastEventType: index < 5 ? 'PLAYING' : 'SEEK',
        updatedAt: new Date('2026-09-17T12:00:00.000Z'),
      })),
    );
    prisma.moduleGameResult.findMany.mockResolvedValue([]);
    prisma.lessonQuizResult.findMany.mockResolvedValue([]);
  });

  it('counts only collaborators with meaningful learning activity as started', async () => {
    const service = new ReportsService(prisma as unknown as PrismaService);

    const report = await service.buildCourseReport(manager, 'course_1');

    expect(report.summary.collaboratorsAssigned).toBe(17);
    expect(report.summary.collaboratorsStarted).toBe(5);
    expect(report.modules[0].lessons[0].startedCount).toBe(5);
    expect(
      report.collaborators.filter(
        (collaborator) => collaborator.status === 'IN_PROGRESS',
      ),
    ).toHaveLength(5);
    expect(report.insights[0]).toBe(
      '29% dos colaboradores atribuídos já iniciaram o curso.',
    );
    expect(report.insights.at(-1)).toBe(
      '12 colaboradores ainda não iniciaram o programa.',
    );
  });
});
