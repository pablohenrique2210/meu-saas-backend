import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LessonType, Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';

const employee: User = {
  id: 'user_employee',
  companyId: 'company_1',
  name: 'Employee',
  email: 'employee@example.com',
  role: Role.USER,
  position: null,
  department: null,
  phone: null,
  hireDate: null,
  isActive: true,
};

function accessibleLesson(
  overrides: Partial<{
    id: string;
    duration: number;
    minimumWatchSeconds: number;
    orderedLessonIds: string[];
    modules: Array<{
      id: string;
      gameType: 'DILEMA' | 'INSPECAO' | 'CORRIDA' | null;
      lessonIds: string[];
    }>;
  }> = {},
) {
  const id = overrides.id ?? 'lesson_1';
  return {
    id,
    type: LessonType.VIDEO,
    duration: overrides.duration ?? 10,
    minimumWatchSeconds: overrides.minimumWatchSeconds ?? 0,
    module: {
      course: {
        modules: overrides.modules
          ? overrides.modules.map((courseModule) => ({
              id: courseModule.id,
              gameType: courseModule.gameType,
              lessons: courseModule.lessonIds.map((lessonId) => ({
                id: lessonId,
              })),
            }))
          : [
              {
                id: 'module_1',
                gameType: null,
                lessons: (overrides.orderedLessonIds ?? [id]).map(
                  (lessonId) => ({ id: lessonId }),
                ),
              },
            ],
      },
    },
  };
}

describe('ContentService access control', () => {
  const prisma = {
    course: { findMany: jest.fn() },
    lesson: { findFirst: jest.fn() },
    lessonProgress: { findUnique: jest.fn(), upsert: jest.fn() },
    moduleGameResult: { findUnique: jest.fn() },
  };
  let service: ContentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.lesson.findFirst.mockResolvedValue(accessibleLesson());
    prisma.lessonProgress.findUnique.mockResolvedValue(null);
    service = new ContentService(prisma as unknown as PrismaService);
  });

  it('lists only courses granted to a standard user', async () => {
    prisma.course.findMany.mockResolvedValue([]);

    await service.findAvailableCourses(employee);

    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userAccesses: { some: { userId: employee.id } } },
      }),
    );
  });

  it('uses the authenticated user when saving progress', async () => {
    prisma.lessonProgress.upsert.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 42,
      watchedSeconds: 10,
      isCompleted: true,
      updatedAt: new Date(),
    });

    await service.updateProgress(employee, 'lesson_1', 42, true);

    expect(prisma.lessonProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_lessonId: { userId: employee.id, lessonId: 'lesson_1' },
        },
      }),
    );
  });

  it('blocks progress for a lesson outside the granted course', async () => {
    prisma.lesson.findFirst.mockResolvedValue(null);

    await expect(
      service.updateProgress(employee, 'external_lesson', 10),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
  });

  it('does not complete a video before the minimum watch time', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({ minimumWatchSeconds: 60 }),
    );
    prisma.lessonProgress.findUnique.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 20,
      watchedSeconds: 20,
      isCompleted: false,
      updatedAt: new Date(Date.now() - 5_000),
    });
    prisma.lessonProgress.upsert.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 25,
      watchedSeconds: 25,
      isCompleted: false,
      updatedAt: new Date(),
    });

    await expect(
      service.updateProgress(employee, 'lesson_1', 25, true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not count a large seek as watched time', async () => {
    prisma.lessonProgress.findUnique.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 10,
      watchedSeconds: 10,
      isCompleted: false,
      updatedAt: new Date(Date.now() - 1_000),
    });
    prisma.lessonProgress.upsert.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 500,
      watchedSeconds: 13,
      isCompleted: false,
      updatedAt: new Date(),
    });

    await service.updateProgress(employee, 'lesson_1', 500);

    const update = prisma.lessonProgress.upsert.mock.calls[0][0].update;
    expect(update.watchedSeconds.increment).toBeLessThanOrEqual(3.1);
  });

  it('blocks a lesson while the previous lesson is incomplete', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({
        id: 'lesson_2',
        orderedLessonIds: ['lesson_1', 'lesson_2'],
      }),
    );
    prisma.lessonProgress.findUnique.mockResolvedValue({
      isCompleted: false,
    });

    await expect(
      service.updateProgress(employee, 'lesson_2', 1),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
  });

  it('blocks the next module until the previous module assessment is complete', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({
        id: 'lesson_2',
        modules: [
          {
            id: 'module_1',
            gameType: 'CORRIDA',
            lessonIds: ['lesson_1'],
          },
          { id: 'module_2', gameType: null, lessonIds: ['lesson_2'] },
        ],
      }),
    );
    prisma.lessonProgress.findUnique.mockResolvedValue({ isCompleted: true });
    prisma.moduleGameResult.findUnique.mockResolvedValue(null);

    await expect(
      service.updateProgress(employee, 'lesson_2', 1),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
  });
});
