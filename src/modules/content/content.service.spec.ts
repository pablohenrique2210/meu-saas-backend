import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LessonType, Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';
import { BunnyStreamService } from './bunny-stream.service';

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

const administrator: User = {
  ...employee,
  id: 'user_admin',
  name: 'Administrator',
  email: 'admin@example.com',
  role: Role.ADMIN,
};

function accessibleLesson(
  overrides: Partial<{
    id: string;
    duration: number;
    minimumWatchSeconds: number;
    availableAt: Date | null;
    courseAvailableAt: Date | null;
    lessonAvailableAt: Date | null;
    quizConfig: Record<string, unknown> | null;
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
    availableAt: overrides.lessonAvailableAt ?? null,
    type: LessonType.VIDEO,
    duration: overrides.duration ?? 10,
    minimumWatchSeconds: overrides.minimumWatchSeconds ?? 0,
    quizConfig: overrides.quizConfig ?? null,
    module: {
      availableAt: overrides.availableAt ?? null,
      course: {
        availableAt: overrides.courseAvailableAt ?? null,
        modules: overrides.modules
          ? overrides.modules.map((courseModule) => ({
              id: courseModule.id,
              gameType: courseModule.gameType,
              lessons: courseModule.lessonIds.map((lessonId) => ({
                id: lessonId,
                availableAt: null,
                type: LessonType.VIDEO,
                duration: overrides.duration ?? 10,
                minimumWatchSeconds: 0,
              })),
            }))
          : [
              {
                id: 'module_1',
                gameType: null,
                lessons: (overrides.orderedLessonIds ?? [id]).map(
                  (lessonId) => ({
                    id: lessonId,
                    availableAt: null,
                    type: LessonType.VIDEO,
                    duration: overrides.duration ?? 10,
                    minimumWatchSeconds:
                      lessonId === id
                        ? (overrides.minimumWatchSeconds ?? 0)
                        : 0,
                  }),
                ),
              },
            ],
      },
    },
  };
}

describe('ContentService access control', () => {
  const prisma = {
    $transaction: jest.fn(),
    course: { create: jest.fn(), findMany: jest.fn() },
    lesson: { findFirst: jest.fn(), findMany: jest.fn() },
    lessonProgress: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    lessonQuizResult: { findUnique: jest.fn(), upsert: jest.fn() },
    moduleGameResult: { findUnique: jest.fn() },
  };
  let service: ContentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (operation: (client: typeof prisma) => unknown) =>
        operation(prisma),
    );
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

  it('blocks a collaborator from opening a module before its scheduled release', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({ availableAt: new Date(Date.now() + 60_000) }),
    );

    await expect(
      service.getProgress(employee, 'lesson_1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONTENT_NOT_AVAILABLE_YET' }),
    });
  });

  it('blocks a collaborator before the course release', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({ courseAvailableAt: new Date(Date.now() + 60_000) }),
    );

    await expect(
      service.getProgress(employee, 'lesson_1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONTENT_NOT_AVAILABLE_YET' }),
    });
  });

  it('blocks a collaborator before the lesson release', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({ lessonAvailableAt: new Date(Date.now() + 60_000) }),
    );

    await expect(
      service.getProgress(employee, 'lesson_1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CONTENT_NOT_AVAILABLE_YET' }),
    });
  });

  it('allows an administrator to open a module before its scheduled release', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({ availableAt: new Date(Date.now() + 60_000) }),
    );

    await expect(
      service.getProgress(administrator, 'lesson_1'),
    ).resolves.toMatchObject({ lastTime: 0, isCompleted: false });
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

  it('also enforces the minimum watch time in administrator course playback', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({ minimumWatchSeconds: 60 }),
    );
    prisma.lessonProgress.findUnique.mockResolvedValue({
      id: 'progress_admin',
      userId: administrator.id,
      lessonId: 'lesson_1',
      lastTime: 0,
      watchedSeconds: 0,
      isCompleted: true,
      updatedAt: new Date(),
    });

    const progress = await service.getProgress(administrator, 'lesson_1');

    expect(progress).toEqual(
      expect.objectContaining({
        isCompleted: false,
        minimumWatchSeconds: 60,
        remainingSeconds: 60,
        canComplete: false,
      }),
    );
  });

  it('revokes a stale completion when the required watch time increased', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({ minimumWatchSeconds: 60 }),
    );
    prisma.lessonProgress.findUnique.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 10,
      watchedSeconds: 10,
      isCompleted: true,
      updatedAt: new Date(),
    });
    prisma.lessonProgress.upsert.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 10,
      watchedSeconds: 10,
      isCompleted: false,
      updatedAt: new Date(),
    });

    const progress = await service.updateProgress(employee, 'lesson_1', 10);
    expect(
      prisma.lessonProgress.upsert.mock.calls[0][0].update.isCompleted,
    ).toBe(false);
    expect(progress).toEqual(
      expect.objectContaining({ isCompleted: false, remainingSeconds: 50 }),
    );
  });

  it('does not report a stale course completion below the current minimum', async () => {
    prisma.lessonProgress.findMany.mockResolvedValue([
      {
        id: 'progress_1',
        userId: employee.id,
        lessonId: 'lesson_1',
        lastTime: 10,
        watchedSeconds: 10,
        isCompleted: true,
        updatedAt: new Date(),
      },
    ]);
    prisma.lesson.findMany.mockResolvedValue([
      {
        id: 'lesson_1',
        type: LessonType.VIDEO,
        minimumWatchSeconds: 60,
        quizConfig: null,
      },
    ]);

    await expect(service.getUserProgressAll(employee)).resolves.toEqual([
      expect.objectContaining({ lessonId: 'lesson_1', isCompleted: false }),
    ]);
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

  it('does not trust retroactive time on the first progress request', async () => {
    prisma.lessonProgress.upsert.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 500,
      watchedSeconds: 0,
      isCompleted: false,
      updatedAt: new Date(),
    });

    await service.updateProgress(employee, 'lesson_1', 500);

    const create = prisma.lessonProgress.upsert.mock.calls[0][0].create;
    expect(create.watchedSeconds).toBe(0);
    expect(create.isCompleted).toBe(false);
  });

  it('does not accumulate a fixed tolerance when requests are repeated rapidly', async () => {
    prisma.lessonProgress.findUnique.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 10,
      watchedSeconds: 10,
      isCompleted: false,
      updatedAt: new Date(),
    });
    prisma.lessonProgress.upsert.mockResolvedValue({
      id: 'progress_1',
      userId: employee.id,
      lessonId: 'lesson_1',
      lastTime: 12,
      watchedSeconds: 10,
      isCompleted: false,
      updatedAt: new Date(),
    });

    await service.updateProgress(employee, 'lesson_1', 12);

    const update = prisma.lessonProgress.upsert.mock.calls[0][0].update;
    expect(update.watchedSeconds.increment).toBeLessThan(0.25);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
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

  it('rejects an empty visual quiz before persisting the course', async () => {
    await expect(
      service.createCourse({
        title: 'Curso',
        category: 'Liderança',
        modules: [
          {
            title: 'Módulo 1',
            lessons: [
              {
                title: 'Aula 1',
                type: 'VIDEO',
                quizConfig: { formatVersion: 2, questions: [] },
              },
            ],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.course.create).not.toHaveBeenCalled();
  });

  it('does not expose correct answers or feedback when loading a lesson quiz', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({
        duration: 0,
        quizConfig: {
          title: 'Quiz',
          questions: [
            {
              id: 'q1',
              prompt: 'Pergunta',
              type: 'single',
              options: [
                {
                  id: 'a1',
                  label: 'Correta',
                  correct: true,
                  feedback: 'Justificativa',
                },
                { id: 'a2', label: 'Incorreta', correct: false },
              ],
            },
          ],
        },
      }),
    );
    prisma.lessonQuizResult.findUnique.mockResolvedValue(null);

    const quiz = await service.getLessonQuiz(employee, 'lesson_1');

    expect(quiz.questions[0].correctOptionCount).toBe(1);
    expect(quiz.questions[0].options[0]).toEqual({
      id: 'a1',
      label: 'Correta',
    });
  });

  it('grades all selected options in a multiple-answer lesson quiz', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      accessibleLesson({
        duration: 0,
        quizConfig: {
          title: 'Quiz',
          questions: [
            {
              id: 'q1',
              prompt: 'Pergunta',
              type: 'multiple',
              options: [
                { id: 'a1', label: 'Primeira', correct: true },
                {
                  id: 'a2',
                  label: 'Segunda',
                  correct: true,
                  feedback: 'Boa escolha.',
                },
                { id: 'a3', label: 'Terceira', correct: false },
              ],
            },
          ],
        },
      }),
    );
    prisma.lessonQuizResult.upsert.mockResolvedValue({ id: 'result_1' });

    const result = await service.submitLessonQuiz(employee, 'lesson_1', [
      { questionId: 'q1', selectedOptionIds: ['a1', 'a2'] },
    ]);

    expect(result.questionFeedback).toEqual([
      { questionId: 'q1', correct: true, feedback: 'Boa escolha.' },
    ]);
    expect(prisma.lessonQuizResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ correctAnswers: 1 }),
      }),
    );
  });

  it('accepts a visual module assessment with multiple correct answers', async () => {
    prisma.course.create.mockResolvedValue({ id: 'course_1' });

    await service.createCourse({
      title: 'Curso',
      category: 'Liderança',
      modules: [
        {
          title: 'Módulo 1',
          gameType: 'CORRIDA',
          gameConfig: {
            formatVersion: 2,
            title: 'Avaliação',
            questions: [
              {
                id: 'q1',
                prompt: 'Quais atitudes são adequadas?',
                type: 'multiple',
                correctOptionIds: ['a1', 'a2'],
                options: [
                  { id: 'a1', label: 'Ouvir', correct: true },
                  { id: 'a2', label: 'Orientar', correct: true },
                ],
              },
            ],
          },
          lessons: [],
        },
      ],
    });

    expect(prisma.course.create).toHaveBeenCalledTimes(1);
  });
});

describe('ContentService course editing', () => {
  it('does not query Bunny again when an existing canonical video is unchanged', async () => {
    const bunny = {
      metadata: jest.fn().mockRejectedValue(new Error('Bunny unavailable')),
    };
    const service = new ContentService(
      {} as PrismaService,
      undefined,
      bunny as unknown as BunnyStreamService,
    );
    const normalize = (
      service as unknown as {
        normalizeBunnyModules: (modules: unknown[]) => Promise<any[]>;
      }
    ).normalizeBunnyModules.bind(service);

    const modules = await normalize([
      {
        id: 'module_1',
        lessons: [
          {
            id: 'lesson_1',
            type: LessonType.VIDEO,
            contentUrl:
              'bunny://123/808a965b-96d9-49a0-9e29-fb6379468984',
            duration: 11,
            minimumWatchSeconds: 643,
            availableAt: '2026-09-04T16:00:00.000Z',
          },
        ],
      },
    ]);

    expect(bunny.metadata).not.toHaveBeenCalled();
    expect(modules[0].lessons[0]).toEqual(
      expect.objectContaining({
        minimumWatchSeconds: 643,
        availableAt: '2026-09-04T16:00:00.000Z',
      }),
    );
  });
});
