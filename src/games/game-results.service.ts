import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LessonType, Role } from '@prisma/client';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListGameResultsDto } from './dto/list-game-results.dto';
import { SubmitGameResultDto } from './dto/submit-game-result.dto';
import { minimumRequiredWatchSeconds } from '../modules/content/watch-time';

const resultInclude = {
  employee: {
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      position: true,
    },
  },
  module: {
    select: {
      id: true,
      title: true,
      course: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.ModuleGameResultInclude;

@Injectable()
export class GameResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: User, dto: SubmitGameResultDto) {
    if (user.role !== Role.USER) {
      throw new ForbiddenException(
        'Somente colaboradores podem registrar resultados de avaliações.',
      );
    }

    if (dto.employeeId !== user.id) {
      throw new ForbiddenException(
        'O resultado deve pertencer ao colaborador autenticado.',
      );
    }

    const serializedMetrics = JSON.stringify(dto.metrics);
    if (Buffer.byteLength(serializedMetrics, 'utf8') > 20_000) {
      throw new BadRequestException(
        'As métricas do minigame excedem o limite permitido.',
      );
    }

    const courseModule = await this.prisma.module.findFirst({
      where: {
        id: dto.moduleId,
        course: { userAccesses: { some: { userId: user.id } } },
      },
      select: {
        id: true,
        availableAt: true,
        gameType: true,
        gameConfig: true,
        lessons: {
          select: {
            id: true,
            type: true,
            duration: true,
            minimumWatchSeconds: true,
          },
        },
      },
    });

    if (!courseModule) {
      throw new NotFoundException('Módulo não encontrado ou sem acesso.');
    }

    this.assertModuleAvailable(user, courseModule.availableAt);

    if (!courseModule.gameType || !courseModule.gameConfig) {
      throw new NotFoundException(
        'Nenhuma avaliação foi configurada para este módulo.',
      );
    }

    if (courseModule.gameType !== dto.gameType) {
      throw new BadRequestException(
        'O tipo de jogo enviado não corresponde à avaliação do módulo.',
      );
    }

    await this.assertModuleLessonsCompleted(user, courseModule.lessons);

    const result = await this.prisma.moduleGameResult.upsert({
      where: {
        employeeId_moduleId_gameType: {
          employeeId: user.id,
          moduleId: dto.moduleId,
          gameType: dto.gameType,
        },
      },
      create: {
        employeeId: user.id,
        moduleId: dto.moduleId,
        gameType: dto.gameType,
        finalScore: dto.finalScore,
        timeSpentSeconds: dto.timeSpentSeconds,
        metrics: dto.metrics as Prisma.InputJsonValue,
      },
      update: {
        finalScore: dto.finalScore,
        timeSpentSeconds: dto.timeSpentSeconds,
        metrics: dto.metrics as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
      include: resultInclude,
    });

    return this.toDiagnosticResult(result);
  }

  async getModuleGame(user: User, moduleId: string) {
    const courseModule = await this.prisma.module.findFirst({
      where: {
        id: moduleId,
        ...(user.role === Role.ADMIN || user.role === Role.HR_MANAGER
          ? {}
          : { course: { userAccesses: { some: { userId: user.id } } } }),
      },
      select: {
        id: true,
        title: true,
        availableAt: true,
        gameType: true,
        gameConfig: true,
        lessons: {
          select: {
            id: true,
            type: true,
            duration: true,
            minimumWatchSeconds: true,
          },
        },
        course: { select: { id: true, title: true } },
      },
    });

    if (!courseModule?.gameType || !courseModule.gameConfig) {
      throw new NotFoundException(
        'Nenhuma avaliação foi configurada para este módulo.',
      );
    }

    this.assertModuleAvailable(user, courseModule.availableAt);

    if (user.role === Role.USER) {
      await this.assertModuleLessonsCompleted(user, courseModule.lessons);
    }

    const completedResult =
      user.role === Role.USER
        ? await this.prisma.moduleGameResult.findUnique({
            where: {
              employeeId_moduleId_gameType: {
                employeeId: user.id,
                moduleId,
                gameType: courseModule.gameType,
              },
            },
            select: {
              finalScore: true,
              timeSpentSeconds: true,
              completedAt: true,
            },
          })
        : null;

    return {
      moduleId: courseModule.id,
      moduleTitle: courseModule.title,
      courseId: courseModule.course.id,
      courseTitle: courseModule.course.title,
      gameType: courseModule.gameType,
      config: courseModule.gameConfig,
      completedResult,
    };
  }

  async listForHR(manager: User, filters: ListGameResultsDto) {
    const results = await this.prisma.moduleGameResult.findMany({
      where: {
        employee: {
          companyId: manager.companyId,
          ...(filters.employeeId ? { id: filters.employeeId } : {}),
        },
        ...(filters.moduleId ? { moduleId: filters.moduleId } : {}),
        ...(filters.gameType ? { gameType: filters.gameType } : {}),
      },
      include: resultInclude,
      orderBy: { completedAt: 'desc' },
    });

    return results.map((result) => this.toDiagnosticResult(result));
  }

  private async assertModuleLessonsCompleted(
    user: User,
    lessons: Array<{
      id: string;
      type: LessonType;
      duration: number;
      minimumWatchSeconds: number;
    }>,
  ) {
    const lessonIds = lessons.map((lesson) => lesson.id);
    const completedLessons =
      lessonIds.length === 0
        ? []
        : await this.prisma.lessonProgress.findMany({
            where: {
              userId: user.id,
              lessonId: { in: lessonIds },
              isCompleted: true,
            },
            select: {
              lessonId: true,
              watchedSeconds: true,
            },
          });
    const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const completedLessonCount = completedLessons.filter((progress) => {
      const lesson = lessonById.get(progress.lessonId);
      if (!lesson) return false;
      return (
        lesson.type !== LessonType.VIDEO ||
        progress.watchedSeconds >= minimumRequiredWatchSeconds(lesson)
      );
    }).length;

    if (completedLessonCount !== lessonIds.length) {
      throw new ForbiddenException(
        'Conclua todas as aulas do módulo antes de acessar a avaliação.',
      );
    }
  }

  private assertModuleAvailable(user: User, availableAt: Date | null) {
    if (
      user.role === Role.USER &&
      availableAt &&
      availableAt.getTime() > Date.now()
    ) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_AVAILABLE_YET',
        message: 'Este módulo ainda não está disponível.',
        availableAt: availableAt.toISOString(),
      });
    }
  }

  private toDiagnosticResult(
    result: Prisma.ModuleGameResultGetPayload<{
      include: typeof resultInclude;
    }>,
  ) {
    return {
      id: result.id,
      employeeId: result.employeeId,
      moduleId: result.moduleId,
      gameType: result.gameType,
      finalScore: result.finalScore,
      timeSpentSeconds: result.timeSpentSeconds,
      metrics: result.metrics,
      completedAt: result.completedAt,
      employee: result.employee,
      module: {
        id: result.module.id,
        title: result.module.title,
        courseId: result.module.course.id,
        courseTitle: result.module.course.title,
      },
    };
  }
}
