import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CollaboratorReport,
  CourseProgressReport,
  ModuleReport,
  ProgressStatus,
} from './course-report.types';

const percent = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 100) : 0;

const average = (values: number[]) =>
  values.length > 0
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;

function statusFor(started: boolean, completed: number, total: number): ProgressStatus {
  if (total > 0 && completed === total) return 'COMPLETED';
  if (started || completed > 0) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCourses(manager: User) {
    const courses = await this.prisma.course.findMany({
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        _count: {
          select: {
            modules: true,
            userAccesses: {
              where: {
                user: { companyId: manager.companyId },
              },
            },
            inviteAccesses: {
              where: {
                invite: {
                  companyId: manager.companyId,
                  status: 'PENDING',
                  claimedByUserId: null,
                  expiresAt: { gt: new Date() },
                },
              },
            },
          },
        },
        modules: { select: { _count: { select: { lessons: true } } } },
      },
    });

    return courses.map((course) => ({
      id: course.id,
      title: course.title,
      description: course.description,
      category: course.category,
      collaboratorsAssigned:
        course._count.userAccesses + course._count.inviteAccesses,
      totalModules: course._count.modules,
      totalLessons: course.modules.reduce(
        (total, module) => total + module._count.lessons,
        0,
      ),
    }));
  }

  async buildCourseReport(manager: User, courseId: string): Promise<CourseProgressReport> {
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
      },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          include: { lessons: { orderBy: { order: 'asc' } } },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Curso não encontrado.');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: manager.companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada.');

    const [userAccesses, pendingInvites] = await Promise.all([
      this.prisma.userCourseAccess.findMany({
        where: {
          courseId,
          user: { companyId: manager.companyId },
        },
        orderBy: { user: { name: 'asc' } },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              position: true,
              department: true,
              isActive: true,
            },
          },
        },
      }),
      this.prisma.employeeInvite.findMany({
        where: {
          companyId: manager.companyId,
          status: 'PENDING',
          claimedByUserId: null,
          expiresAt: { gt: new Date() },
          courseAccesses: { some: { courseId } },
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          position: true,
          department: true,
        },
      }),
    ]);
    const accesses = [
      ...userAccesses,
      ...pendingInvites.map((invite) => ({
        userId: `invite:${invite.id}`,
        user: {
          id: `invite:${invite.id}`,
          name: invite.name,
          email: invite.email,
          position: invite.position,
          department: invite.department,
          isActive: false,
        },
      })),
    ].sort((first, second) =>
      first.user.name.localeCompare(second.user.name, 'pt-BR'),
    );

    const lessonIds = course.modules.flatMap((module) =>
      module.lessons.map((lesson) => lesson.id),
    );
    const moduleIds = course.modules.map((module) => module.id);
    const userIds = accesses.map((access) => access.userId);
    const progressRows =
      lessonIds.length > 0 && userIds.length > 0
        ? await this.prisma.lessonProgress.findMany({
            where: {
              userId: { in: userIds },
              lessonId: { in: lessonIds },
            },
          })
        : [];
    const gameResults =
      moduleIds.length > 0 && userIds.length > 0
        ? await this.prisma.moduleGameResult.findMany({
            where: {
              employeeId: { in: userIds },
              moduleId: { in: moduleIds },
            },
            select: {
              employeeId: true,
              moduleId: true,
              gameType: true,
              finalScore: true,
              timeSpentSeconds: true,
              completedAt: true,
            },
          })
        : [];

    const progressByUserAndLesson = new Map(
      progressRows.map((row) => [`${row.userId}:${row.lessonId}`, row]),
    );

    const collaborators: CollaboratorReport[] = accesses.map(({ user }) => {
      const userRows = progressRows.filter((row) => row.userId === user.id);
      const completedLessons = userRows.filter((row) => row.isCompleted).length;
      const modules = course.modules.map((module) => {
        const rows = module.lessons
          .map((lesson) => progressByUserAndLesson.get(`${user.id}:${lesson.id}`))
          .filter((row) => row !== undefined);
        const completed = rows.filter((row) => row.isCompleted).length;
        return {
          moduleId: module.id,
          title: module.title,
          completedLessons: completed,
          totalLessons: module.lessons.length,
          progress: percent(completed, module.lessons.length),
          status: statusFor(rows.length > 0, completed, module.lessons.length),
          evaluation: (() => {
            const result = gameResults.find(
              (item) =>
                item.employeeId === user.id && item.moduleId === module.id,
            );
            return result
              ? {
                  gameType: result.gameType,
                  finalScore: result.finalScore,
                  timeSpentSeconds: result.timeSpentSeconds,
                  completedAt: result.completedAt.toISOString(),
                }
              : null;
          })(),
        };
      });
      const lastActivity = userRows.reduce<Date | null>(
        (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
        null,
      );

      return {
        ...user,
        completedLessons,
        totalLessons: lessonIds.length,
        overallProgress: percent(completedLessons, lessonIds.length),
        status: statusFor(userRows.length > 0, completedLessons, lessonIds.length),
        lastActivity: lastActivity?.toISOString() ?? null,
        modules,
      };
    });

    const modules: ModuleReport[] = course.modules.map((module) => {
      const lessons = module.lessons.map((lesson, lessonIndex) => {
        const rows = accesses
          .map((access) =>
            progressByUserAndLesson.get(`${access.userId}:${lesson.id}`),
          )
          .filter((row) => row !== undefined);
        const completedCount = rows.filter((row) => row.isCompleted).length;
        return {
          id: lesson.id,
          title: lesson.title.trim() || `Aula ${lessonIndex + 1}`,
          order: lesson.order,
          type: lesson.type,
          durationMinutes: lesson.duration,
          startedCount: rows.length,
          completedCount,
          completionRate: percent(completedCount, accesses.length),
        };
      });
      const totalPossible = module.lessons.length * accesses.length;
      const completed = lessons.reduce(
        (total, lesson) => total + lesson.completedCount,
        0,
      );
      return {
        id: module.id,
        title: module.title,
        order: module.order,
        totalLessons: module.lessons.length,
        averageProgress: percent(completed, totalPossible),
        completionRate: percent(
          collaborators.filter(
            (collaborator) =>
              collaborator.modules.find((item) => item.moduleId === module.id)
                ?.status === 'COMPLETED',
          ).length,
          collaborators.length,
        ),
        evaluation: module.gameType
          ? (() => {
              const results = gameResults.filter(
                (result) => result.moduleId === module.id,
              );
              return {
                gameType: module.gameType,
                completedCount: results.length,
                participationRate: percent(results.length, collaborators.length),
                averageScore: average(
                  results.map((result) => result.finalScore),
                ),
                averageTimeSpentSeconds: average(
                  results.map((result) => result.timeSpentSeconds),
                ),
              };
            })()
          : null,
        lessons,
      };
    });

    const collaboratorsStarted = collaborators.filter(
      (collaborator) => collaborator.status !== 'NOT_STARTED',
    ).length;
    const collaboratorsCompleted = collaborators.filter(
      (collaborator) => collaborator.status === 'COMPLETED',
    ).length;
    const averageProgress = average(
      collaborators.map((collaborator) => collaborator.overallProgress),
    );
    const configuredModules = modules.filter((module) => module.evaluation);
    const expectedEvaluations = configuredModules.length * collaborators.length;

    return {
      generatedAt: new Date().toISOString(),
      company,
      course: {
        id: course.id,
        title: course.title,
        description: course.description,
        category: course.category,
        author: course.author,
      },
      summary: {
        collaboratorsAssigned: collaborators.length,
        collaboratorsStarted,
        collaboratorsCompleted,
        averageProgress,
        completionRate: percent(collaboratorsCompleted, collaborators.length),
        totalModules: course.modules.length,
        totalLessons: lessonIds.length,
        totalEstimatedMinutes: course.modules.reduce(
          (total, module) =>
            total + module.lessons.reduce((sum, lesson) => sum + lesson.duration, 0),
          0,
        ),
        evaluationsConfigured: configuredModules.length,
        evaluationsCompleted: gameResults.length,
        evaluationParticipationRate: percent(
          gameResults.length,
          expectedEvaluations,
        ),
        averageEvaluationScore: average(
          gameResults.map((result) => result.finalScore),
        ),
      },
      modules,
      collaborators,
      insights: this.buildInsights(
        collaborators,
        modules,
        collaboratorsStarted,
        averageProgress,
        gameResults.length,
        expectedEvaluations,
      ),
    };
  }

  private buildInsights(
    collaborators: CollaboratorReport[],
    modules: ModuleReport[],
    collaboratorsStarted: number,
    averageProgress: number,
    evaluationsCompleted: number,
    expectedEvaluations: number,
  ) {
    if (collaborators.length === 0) {
      return ['Ainda não existem colaboradores atribuídos a este curso.'];
    }

    const insights = [
      `${percent(collaboratorsStarted, collaborators.length)}% dos colaboradores atribuídos já iniciaram o curso.`,
      `O progresso médio da empresa no curso é de ${averageProgress}%.`,
    ];
    if (expectedEvaluations > 0) {
      insights.push(
        `${percent(evaluationsCompleted, expectedEvaluations)}% das avaliações previstas nos módulos foram concluídas.`,
      );
    }
    const orderedModules = [...modules].sort(
      (first, second) => second.averageProgress - first.averageProgress,
    );
    const strongest = orderedModules[0];
    const attention = orderedModules.at(-1);
    if (strongest) {
      insights.push(
        `Maior avanço: ${strongest.title}, com ${strongest.averageProgress}% de progresso médio.`,
      );
    }
    if (attention && attention.id !== strongest?.id) {
      insights.push(
        `Ponto de atenção: ${attention.title}, com ${attention.averageProgress}% de progresso médio.`,
      );
    }
    const notStarted = collaborators.filter(
      (collaborator) => collaborator.status === 'NOT_STARTED',
    ).length;
    if (notStarted > 0) {
      insights.push(
        `${notStarted} colaborador${notStarted === 1 ? '' : 'es'} ainda não iniciou${notStarted === 1 ? 'u' : 'ram'} o programa.`,
      );
    }
    return insights;
  }
}
