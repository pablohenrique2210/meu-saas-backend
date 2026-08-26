import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LessonType, Role } from '@prisma/client';
import type { User } from '@prisma/client';
import type {
  ModuleGameType as ModuleGameTypeValue,
  Prisma,
} from '../../../generated/prisma';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { ModuleGameType } from '../../games/game-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { uploadsRootPath } from '../../config/storage';

type AccessibleLesson = {
  id: string;
  type: LessonType;
  duration: number;
  minimumWatchSeconds: number;
  module: {
    course: {
      modules: Array<{
        id: string;
        gameType: ModuleGameTypeValue | null;
        lessons: Array<{ id: string }>;
      }>;
    };
  };
};

@Injectable()
export class ContentService {
  constructor(private prisma: PrismaService) {}

  // ==========================================
  // 🍿 MOTOR DE PROGRESSO (NETFLIX STYLE)
  // ==========================================
  // ==========================================
  // 🍿 MOTOR DE PROGRESSO (NETFLIX STYLE)
  // ==========================================
  async updateProgress(
    user: User,
    lessonId: string,
    lastTime: number,
    isCompleted?: boolean,
  ) {
    const lesson = await this.assertCanAccessLesson(user, lessonId);
    await this.assertLessonIsUnlocked(user, lesson);

    const existingProgress = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
    });
    const maximumVideoTime = lesson.duration > 0 ? lesson.duration * 60 : null;
    const safeLastTime = Math.max(
      0,
      maximumVideoTime === null
        ? lastTime
        : Math.min(lastTime, maximumVideoTime),
    );
    const watchedIncrement = this.calculateWatchedIncrement(
      existingProgress,
      safeLastTime,
    );
    const requiredSeconds = this.requiredWatchSeconds(user, lesson);
    const predictedWatchedSeconds =
      (existingProgress?.watchedSeconds ?? 0) + watchedIncrement;
    const shouldComplete =
      existingProgress?.isCompleted === true ||
      (isCompleted === true && predictedWatchedSeconds >= requiredSeconds);

    const progress = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      update: {
        lastTime: safeLastTime,
        watchedSeconds: { increment: watchedIncrement },
        ...(shouldComplete && { isCompleted: true }),
      },
      create: {
        userId: user.id,
        lessonId,
        lastTime: safeLastTime,
        watchedSeconds: watchedIncrement,
        isCompleted: shouldComplete,
      },
    });

    if (isCompleted === true && !progress.isCompleted) {
      const remainingSeconds = Math.max(
        0,
        Math.ceil(requiredSeconds - progress.watchedSeconds),
      );
      throw new ForbiddenException({
        code: 'MINIMUM_WATCH_TIME_NOT_REACHED',
        message: `Assista mais ${remainingSeconds} segundos antes de concluir esta aula.`,
        minimumWatchSeconds: requiredSeconds,
        watchedSeconds: progress.watchedSeconds,
        remainingSeconds,
      });
    }

    return this.withProgressRequirement(progress, requiredSeconds);
  }

  async getProgress(user: User, lessonId: string) {
    const lesson = await this.assertCanAccessLesson(user, lessonId);
    await this.assertLessonIsUnlocked(user, lesson);

    const progress = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
    });

    return this.withProgressRequirement(
      progress,
      this.requiredWatchSeconds(user, lesson),
    );
  }

  // ==========================================
  // 📚 CRIAÇÃO E LEITURA DE CURSOS
  // ==========================================
  async createCourse(dto: CreateCourseDto) {
    const { modules, ...courseData } = dto;
    return this.prisma.course.create({
      data: {
        ...courseData,
        modules: {
          create: modules?.map((mod, modIndex) => ({
            title: mod.title || `Módulo ${modIndex + 1}`,
            order: modIndex,
            ...this.moduleGameDataFor(mod),
            lessons: {
              create: mod.lessons?.map((lesson, lessonIndex) => ({
                title: lesson.title || `Aula ${lessonIndex + 1}`,
                type: lesson.type,
                contentUrl: lesson.contentUrl || '',
                duration: Number(lesson.duration) || 0,
                minimumWatchSeconds: this.minimumWatchSecondsFor(lesson),
                order: lessonIndex,
                attachments: {
                  create: lesson.attachments?.map((att) => ({
                    title: att.title || 'Material',
                    type: att.type,
                    url: att.url || '',
                  })),
                },
              })),
            },
          })),
        },
      },
      include: {
        modules: { include: { lessons: { include: { attachments: true } } } },
      },
    });
  }

  // ==========================================
  // 📚 LEITURA DE CURSOS E PROGRESSO
  // ==========================================
  async findAvailableCourses(user: User) {
    return this.prisma.course.findMany({
      where:
        user.role === Role.ADMIN || user.role === Role.HR_MANAGER
          ? undefined
          : { userAccesses: { some: { userId: user.id } } },
      include: {
        // 🚀 Trazemos os IDs das aulas para o Frontend conseguir fazer as contas do progresso!
        modules: {
          include: {
            lessons: { select: { id: true } },
            gameResults: {
              where: { employeeId: user.id },
              select: { gameType: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 🚀 NOVA FUNÇÃO: Busca tudo o que o aluno já assistiu
  async getUserProgressAll(user: User) {
    return this.prisma.lessonProgress.findMany({
      where: { userId: user.id },
    });
  }

  async getFullCourse(user: User, courseId: string) {
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        ...(user.role === Role.ADMIN || user.role === Role.HR_MANAGER
          ? {}
          : { userAccesses: { some: { userId: user.id } } }),
      },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              include: { attachments: true },
            },
            gameResults: {
              where: { employeeId: user.id },
              select: { gameType: true },
            },
          },
        },
      },
    });

    if (!course) {
      throw new NotFoundException('Curso não encontrado ou sem acesso.');
    }

    return course;
  }

  async getDownloadableMaterial(user: User, requestedFilename: string) {
    const filename = basename(requestedFilename);
    if (!filename || filename !== requestedFilename) {
      throw new BadRequestException('Nome de arquivo inválido.');
    }
    const uploadedUrl = `/uploads/${filename}`;
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        OR: [
          { contentUrl: { endsWith: uploadedUrl } },
          { attachments: { some: { url: { endsWith: uploadedUrl } } } },
        ],
        ...(user.role === Role.ADMIN || user.role === Role.HR_MANAGER
          ? {}
          : {
              module: {
                course: { userAccesses: { some: { userId: user.id } } },
              },
            }),
      },
      select: {
        title: true,
        contentUrl: true,
        attachments: {
          where: { url: { endsWith: uploadedUrl } },
          select: { title: true },
          take: 1,
        },
      },
    });
    if (!lesson) {
      throw new NotFoundException('Material não encontrado ou sem acesso.');
    }

    const path = join(uploadsRootPath(), filename);
    if (!existsSync(path)) {
      throw new NotFoundException('O arquivo deste material não está disponível.');
    }
    const title = lesson.attachments[0]?.title?.trim() || lesson.title.trim() || 'material';
    const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
    return {
      path,
      downloadName: `${safeTitle}${extname(filename)}`,
    };
  }
  // ==========================================
  // ✏️ ATUALIZAR INFORMAÇÕES DO CURSO
  // ==========================================
  // ==========================================
  // ✏️ ATUALIZAR INFORMAÇÕES E MÓDULOS DO CURSO
  // ==========================================
  async updateCourse(courseId: string, data: any) {
    const { modules, ...courseData } = data;

    // 1. Apanhar os IDs reais que chegaram do Frontend (Ignorar os IDs temporários)
    const incomingModuleIds =
      modules
        ?.filter((m: any) => !m.id.startsWith('temp_'))
        .map((m: any) => m.id) || [];

    return this.prisma.course.update({
      where: { id: courseId },
      data: {
        ...courseData,
        // 2. O Motor de Sincronização Inteligente do Prisma
        modules: modules
          ? {
              // Apaga os módulos que o admin excluiu na tela
              deleteMany: { id: { notIn: incomingModuleIds } },

              // Para cada módulo que chegou:
              upsert: modules.map((mod: any, modIndex: number) => {
                const incomingLessonIds =
                  mod.lessons
                    ?.filter((l: any) => !l.id.startsWith('temp_'))
                    .map((l: any) => l.id) || [];
                const isNewMod = mod.id.startsWith('temp_');

                return {
                  // Truque: Se for novo, usamos um UUID falso para forçar a criação. Se não for, atualiza o ID real.
                  where: {
                    id: isNewMod
                      ? '00000000-0000-0000-0000-000000000000'
                      : mod.id,
                  },

                  // Se for módulo novo, cria tudo do zero:
                  create: {
                    title: mod.title,
                    order: modIndex,
                    ...this.moduleGameDataFor(mod),
                    lessons: {
                      create: mod.lessons?.map(
                        (lesson: any, lessonIndex: number) => ({
                          title: lesson.title,
                          type: lesson.type,
                          contentUrl: lesson.contentUrl || '',
                          duration: Number(lesson.duration) || 0,
                          minimumWatchSeconds:
                            this.minimumWatchSecondsFor(lesson),
                          order: lessonIndex,
                          attachments: {
                            create: lesson.attachments?.map((att: any) => ({
                              title: att.title,
                              type: att.type,
                              url: att.url || '',
                            })),
                          },
                        }),
                      ),
                    },
                  },

                  // Se o módulo já existia, atualiza os seus dados e sincroniza as aulas:
                  update: {
                    title: mod.title,
                    order: modIndex,
                    ...this.moduleGameDataFor(mod),
                    lessons: {
                      deleteMany: { id: { notIn: incomingLessonIds } }, // Apaga aulas que o admin removeu
                      upsert: mod.lessons?.map(
                        (lesson: any, lessonIndex: number) => {
                          const incomingAttIds =
                            lesson.attachments
                              ?.filter((a: any) => !a.id.startsWith('temp_'))
                              .map((a: any) => a.id) || [];
                          const isNewLesson = lesson.id.startsWith('temp_');

                          return {
                            where: {
                              id: isNewLesson
                                ? '00000000-0000-0000-0000-000000000000'
                                : lesson.id,
                            },
                            create: {
                              title: lesson.title,
                              type: lesson.type,
                              contentUrl: lesson.contentUrl || '',
                              duration: Number(lesson.duration) || 0,
                              minimumWatchSeconds:
                                this.minimumWatchSecondsFor(lesson),
                              order: lessonIndex,
                              attachments: {
                                create: lesson.attachments?.map((att: any) => ({
                                  title: att.title,
                                  type: att.type,
                                  url: att.url || '',
                                })),
                              },
                            },
                            update: {
                              title: lesson.title,
                              type: lesson.type,
                              contentUrl: lesson.contentUrl || '',
                              duration: Number(lesson.duration) || 0,
                              minimumWatchSeconds:
                                this.minimumWatchSecondsFor(lesson),
                              order: lessonIndex,
                              attachments: {
                                deleteMany: { id: { notIn: incomingAttIds } },
                                upsert: lesson.attachments?.map((att: any) => {
                                  const isNewAtt = att.id.startsWith('temp_');
                                  return {
                                    where: {
                                      id: isNewAtt
                                        ? '00000000-0000-0000-0000-000000000000'
                                        : att.id,
                                    },
                                    create: {
                                      title: att.title,
                                      type: att.type,
                                      url: att.url || '',
                                    },
                                    update: {
                                      title: att.title,
                                      type: att.type,
                                      url: att.url || '',
                                    },
                                  };
                                }),
                              },
                            },
                          };
                        },
                      ),
                    },
                  },
                };
              }),
            }
          : undefined,
      },
    });
  }

  // ==========================================
  // 🗑️ EXCLUIR CURSO
  // ==========================================
  async deleteCourse(courseId: string) {
    // Como os dados estão interligados, o Prisma apaga o curso e tudo o que está dentro dele
    // (Aviso: Se der erro de "Foreign Key", teremos de adicionar 'onDelete: Cascade' no teu schema.prisma)
    return this.prisma.course.delete({
      where: { id: courseId },
    });
  }

  private async assertCanAccessLesson(
    user: User,
    lessonId: string,
  ): Promise<AccessibleLesson> {
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        ...(user.role === Role.ADMIN || user.role === Role.HR_MANAGER
          ? {}
          : {
              module: {
                course: { userAccesses: { some: { userId: user.id } } },
              },
            }),
      },
      select: {
        id: true,
        type: true,
        duration: true,
        minimumWatchSeconds: true,
        module: {
          select: {
            course: {
              select: {
                modules: {
                  orderBy: { order: 'asc' },
                  select: {
                    id: true,
                    gameType: true,
                    lessons: {
                      orderBy: { order: 'asc' },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      throw new NotFoundException('Aula não encontrada ou sem acesso.');
    }

    return lesson;
  }

  private async assertLessonIsUnlocked(
    user: User,
    lesson: AccessibleLesson,
  ) {
    if (user.role !== Role.USER) return;

    const orderedLessons = lesson.module.course.modules.flatMap(
      (courseModule) =>
        courseModule.lessons.map((courseLesson) => ({
          ...courseLesson,
          moduleId: courseModule.id,
        })),
    );
    const lessonIndex = orderedLessons.findIndex(
      (candidate) => candidate.id === lesson.id,
    );
    if (lessonIndex <= 0) return;

    const previousLesson = orderedLessons[lessonIndex - 1];
    const previousProgress = await this.prisma.lessonProgress.findUnique({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId: previousLesson.id,
        },
      },
      select: { isCompleted: true },
    });

    if (!previousProgress?.isCompleted) {
      throw new ForbiddenException({
        code: 'PREVIOUS_LESSON_NOT_COMPLETED',
        message: 'Conclua a aula anterior antes de avançar.',
      });
    }

    const currentLesson = orderedLessons[lessonIndex];
    if (previousLesson.moduleId === currentLesson.moduleId) return;

    const previousModule = lesson.module.course.modules.find(
      (courseModule) => courseModule.id === previousLesson.moduleId,
    );
    if (!previousModule?.gameType) return;

    const gameResult = await this.prisma.moduleGameResult.findUnique({
      where: {
        employeeId_moduleId_gameType: {
          employeeId: user.id,
          moduleId: previousModule.id,
          gameType: previousModule.gameType,
        },
      },
      select: { id: true },
    });

    if (!gameResult) {
      throw new ForbiddenException({
        code: 'MODULE_GAME_NOT_COMPLETED',
        message: 'Conclua a avaliação do módulo anterior antes de avançar.',
        moduleId: previousModule.id,
      });
    }
  }

  private requiredWatchSeconds(
    user: User,
    lesson: { type: LessonType; minimumWatchSeconds: number },
  ) {
    if (user.role !== Role.USER || lesson.type !== LessonType.VIDEO) return 0;
    return Math.max(0, lesson.minimumWatchSeconds);
  }

  private calculateWatchedIncrement(
    progress: {
      lastTime: number;
      watchedSeconds: number;
      updatedAt: Date;
    } | null,
    currentTime: number,
  ) {
    if (!progress) return Math.min(currentTime, 10);

    const videoAdvance = Math.max(0, currentTime - progress.lastTime);
    const elapsedSeconds = Math.max(
      0,
      (Date.now() - progress.updatedAt.getTime()) / 1000,
    );

    // A tolerância absorve atrasos do navegador, mas impede saltos artificiais.
    return Math.min(videoAdvance, elapsedSeconds + 2, 15);
  }

  private withProgressRequirement(
    progress: {
      id: string;
      userId: string;
      lessonId: string;
      lastTime: number;
      watchedSeconds: number;
      isCompleted: boolean;
      updatedAt: Date;
    } | null,
    minimumWatchSeconds: number,
  ) {
    const watchedSeconds = progress?.watchedSeconds ?? 0;
    const remainingSeconds = Math.max(
      0,
      Math.ceil(minimumWatchSeconds - watchedSeconds),
    );

    return {
      ...(progress ?? {
        lastTime: 0,
        watchedSeconds: 0,
        isCompleted: false,
      }),
      minimumWatchSeconds,
      remainingSeconds,
      canComplete: progress?.isCompleted === true || remainingSeconds === 0,
    };
  }

  private minimumWatchSecondsFor(lesson: {
    type?: LessonType | string;
    duration?: number | string;
    minimumWatchSeconds?: number | string;
    contentUrl?: string;
  }) {
    if (lesson.type !== LessonType.VIDEO && lesson.type !== 'VIDEO') return 0;
    if (!/\.(mp4|webm)(?:$|[?#])/i.test(lesson.contentUrl ?? '')) return 0;

    if (lesson.minimumWatchSeconds !== undefined) {
      return Math.max(0, Math.round(Number(lesson.minimumWatchSeconds) || 0));
    }

    return Math.max(0, Math.round((Number(lesson.duration) || 0) * 60));
  }

  private moduleGameDataFor(courseModule: {
    gameType?: unknown;
    gameConfig?: unknown;
  }) {
    if (!courseModule.gameType) {
      return { gameType: null };
    }

    if (
      typeof courseModule.gameType !== 'string' ||
      !Object.values(ModuleGameType).includes(
        courseModule.gameType as ModuleGameTypeValue,
      )
    ) {
      throw new BadRequestException('Tipo de avaliação inválido.');
    }

    if (
      !courseModule.gameConfig ||
      typeof courseModule.gameConfig !== 'object' ||
      Array.isArray(courseModule.gameConfig)
    ) {
      throw new BadRequestException(
        'Configure o conteúdo da avaliação do módulo.',
      );
    }

    return {
      gameType: courseModule.gameType as ModuleGameTypeValue,
      gameConfig: courseModule.gameConfig as Prisma.InputJsonValue,
    };
  }
}
