import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModuleGameType } from './game-types';
import { GameResultsService } from './game-results.service';

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

const admin: User = {
  ...employee,
  id: 'admin_1',
  email: 'admin@example.com',
  role: Role.ADMIN,
};

const moduleId = '2d47ef22-b132-4d58-b2b8-27f3afca9a80';
const dto = {
  employeeId: employee.id,
  moduleId,
  gameType: ModuleGameType.CORRIDA,
  finalScore: 850,
  timeSpentSeconds: 72,
  metrics: { maxCombo: 4, correctAnswers: 8 },
};

function persistedResult() {
  return {
    id: 'result_1',
    ...dto,
    completedAt: new Date('2026-08-22T12:00:00.000Z'),
    updatedAt: new Date('2026-08-22T12:00:00.000Z'),
    employee: {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      department: employee.department,
      position: employee.position,
    },
    module: {
      id: moduleId,
      title: 'Comunicação',
      course: { id: 'course_1', title: 'Líder em Ação' },
    },
  };
}

describe('GameResultsService', () => {
  const prisma = {
    module: { findFirst: jest.fn() },
    lessonProgress: { findMany: jest.fn() },
    moduleGameResult: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  let service: GameResultsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.module.findFirst.mockResolvedValue({
      id: moduleId,
      title: 'Comunicação',
      gameType: ModuleGameType.CORRIDA,
      gameConfig: { questions: [] },
      lessons: [
        { id: 'lesson_1', type: 'VIDEO', minimumWatchSeconds: 60 },
        { id: 'lesson_2', type: 'TEXT', minimumWatchSeconds: 0 },
      ],
      course: { id: 'course_1', title: 'Líder em Ação' },
    });
    prisma.lessonProgress.findMany.mockResolvedValue([
      {
        lessonId: 'lesson_1',
        watchedSeconds: 60,
      },
      {
        lessonId: 'lesson_2',
        watchedSeconds: 0,
      },
    ]);
    prisma.moduleGameResult.upsert.mockResolvedValue(persistedResult());
    service = new GameResultsService(prisma as unknown as PrismaService);
  });

  it('persists a normalized result after all module lessons are complete', async () => {
    await expect(service.submit(employee, dto)).resolves.toEqual(
      expect.objectContaining({
        employeeId: employee.id,
        moduleId,
        gameType: ModuleGameType.CORRIDA,
        finalScore: 850,
      }),
    );

    expect(prisma.moduleGameResult.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employeeId_moduleId_gameType: {
            employeeId: employee.id,
            moduleId,
            gameType: ModuleGameType.CORRIDA,
          },
        },
      }),
    );
  });

  it('rejects an employeeId different from the authenticated user', async () => {
    await expect(
      service.submit(employee, { ...dto, employeeId: 'another_user' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.moduleGameResult.upsert).not.toHaveBeenCalled();
  });

  it('rejects a result while the module still has incomplete lessons', async () => {
    prisma.lessonProgress.findMany.mockResolvedValue([
      {
        lessonId: 'lesson_1',
        watchedSeconds: 59,
      },
      {
        lessonId: 'lesson_2',
        watchedSeconds: 0,
      },
    ]);

    await expect(service.submit(employee, dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.moduleGameResult.upsert).not.toHaveBeenCalled();
  });

  it('limits the HR query to the manager company', async () => {
    prisma.moduleGameResult.findMany.mockResolvedValue([]);

    await service.listForHR(admin, { gameType: ModuleGameType.CORRIDA });

    expect(prisma.moduleGameResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          employee: { companyId: admin.companyId },
          gameType: ModuleGameType.CORRIDA,
        },
      }),
    );
  });

  it('returns the configured assessment after all lessons are complete', async () => {
    prisma.moduleGameResult.findUnique.mockResolvedValue(null);

    await expect(service.getModuleGame(employee, moduleId)).resolves.toEqual(
      expect.objectContaining({
        moduleId,
        gameType: ModuleGameType.CORRIDA,
        config: { questions: [] },
        completedResult: null,
      }),
    );
  });
});
