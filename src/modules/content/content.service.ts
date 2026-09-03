import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LessonType, Role } from '@prisma/client';
import type {
  LessonProgress as LessonProgressRecord,
  ModuleGameType as ModuleGameTypeValue,
  Prisma,
  User,
} from '@prisma/client';
import { basename, extname } from 'node:path';
import { ModuleGameType } from '../../games/game-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { AssetStorageService } from './asset-storage.service';
import {
  BunnyStreamService,
  parseBunnyReference,
} from './bunny-stream.service';
import { minimumRequiredWatchSeconds } from './watch-time';

type AccessibleLesson = {
  id: string;
  availableAt: Date | null;
  contentUrl: string | null;
  type: LessonType;
  duration: number;
  minimumWatchSeconds: number;
  quizConfig: Prisma.JsonValue | null;
  module: {
    availableAt: Date | null;
    course: {
      availableAt: Date | null;
      modules: Array<{
        id: string;
        gameType: ModuleGameTypeValue | null;
        lessons: Array<{
          id: string;
          availableAt: Date | null;
          type: LessonType;
          duration: number;
          minimumWatchSeconds: number;
          quizConfig: Prisma.JsonValue | null;
        }>;
      }>;
    };
  };
};

@Injectable()
export class ContentService {
  constructor(
    private prisma: PrismaService,
    private readonly assets: AssetStorageService = new AssetStorageService(),
    private readonly bunny: BunnyStreamService = new BunnyStreamService(),
  ) {}

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
    const maximumVideoTime = lesson.duration > 0 ? lesson.duration * 60 : null;
    const safeLastTime = Math.max(
      0,
      maximumVideoTime === null
        ? lastTime
        : Math.min(lastTime, maximumVideoTime),
    );
    const requiredSeconds = this.requiredWatchSeconds(user, lesson);
    const quizRequired =
      user.role === Role.USER && this.hasLessonQuiz(lesson.quizConfig);
    let saved:
      | { progress: LessonProgressRecord; quizCompleted: boolean }
      | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        saved = await this.prisma.$transaction(
          async (transaction) => {
            const existingProgress =
              await transaction.lessonProgress.findUnique({
                where: { userId_lessonId: { userId: user.id, lessonId } },
              });
            const quizResult = quizRequired
              ? await transaction.lessonQuizResult.findUnique({
                  where: {
                    employeeId_lessonId: { employeeId: user.id, lessonId },
                  },
                  select: { id: true },
                })
              : null;
            const quizCompleted = !quizRequired || Boolean(quizResult);
            const watchedIncrement = this.calculateWatchedIncrement(
              existingProgress,
              safeLastTime,
            );
            const predictedWatchedSeconds =
              (existingProgress?.watchedSeconds ?? 0) + watchedIncrement;
            const shouldComplete =
              (existingProgress?.isCompleted === true ||
                isCompleted === true) &&
              predictedWatchedSeconds >= requiredSeconds &&
              quizCompleted;
            const progress = await transaction.lessonProgress.upsert({
              where: { userId_lessonId: { userId: user.id, lessonId } },
              update: {
                lastTime: safeLastTime,
                watchedSeconds: { increment: watchedIncrement },
                isCompleted: shouldComplete,
              },
              create: {
                userId: user.id,
                lessonId,
                lastTime: safeLastTime,
                watchedSeconds: watchedIncrement,
                isCompleted: shouldComplete,
              },
            });
            return { progress, quizCompleted };
          },
          { isolationLevel: 'Serializable' },
        );
        break;
      } catch (error) {
        if (!this.isTransactionConflict(error) || attempt === 2) throw error;
      }
    }
    if (!saved) throw new Error('Não foi possível gravar o progresso.');
    const { progress, quizCompleted } = saved;

    if (isCompleted === true && !progress.isCompleted) {
      const remainingSeconds = Math.max(
        0,
        Math.ceil(requiredSeconds - progress.watchedSeconds),
      );
      if (remainingSeconds > 0) {
        throw new ForbiddenException({
          code: 'MINIMUM_WATCH_TIME_NOT_REACHED',
          message: `Assista mais ${remainingSeconds} segundos antes de concluir esta aula.`,
          minimumWatchSeconds: requiredSeconds,
          watchedSeconds: progress.watchedSeconds,
          remainingSeconds,
        });
      }
      if (!quizCompleted) {
        throw new ForbiddenException({
          code: 'LESSON_QUIZ_REQUIRED',
          message: 'Conclua o quiz desta aula antes de avançar.',
          lessonId,
        });
      }
    }

    return this.withProgressRequirement(
      progress,
      requiredSeconds,
      quizRequired,
      quizCompleted,
    );
  }

  async getProgress(user: User, lessonId: string) {
    const lesson = await this.assertCanAccessLesson(user, lessonId);
    await this.assertLessonIsUnlocked(user, lesson);

    const progress = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
    });

    const quizRequired =
      user.role === Role.USER && this.hasLessonQuiz(lesson.quizConfig);
    const quizCompleted = quizRequired
      ? Boolean(
          await this.prisma.lessonQuizResult.findUnique({
            where: {
              employeeId_lessonId: { employeeId: user.id, lessonId },
            },
            select: { id: true },
          }),
        )
      : true;

    return this.withProgressRequirement(
      progress,
      this.requiredWatchSeconds(user, lesson),
      quizRequired,
      quizCompleted,
    );
  }

  async getLessonPlayback(user: User, lessonId: string) {
    const lesson = await this.assertCanAccessLesson(user, lessonId);
    await this.assertLessonIsUnlocked(user, lesson);
    if (
      lesson.type !== LessonType.VIDEO ||
      !parseBunnyReference(lesson.contentUrl ?? '')
    ) {
      throw new NotFoundException('Esta aula não possui um vídeo Bunny.');
    }
    const playback = await this.bunny.playback(lesson.contentUrl!);
    const progress = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      select: { lastTime: true },
    });
    return { ...playback, lastTime: progress?.lastTime ?? 0 };
  }

  async linkLessonVideo(
    lessonId: string,
    contentUrl: string,
    fallbackDurationSeconds = 0,
    requestedMinimumWatchSeconds?: number,
  ) {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, type: true },
    });
    if (!lesson) throw new NotFoundException('Aula não encontrada.');
    if (lesson.type !== LessonType.VIDEO) {
      throw new BadRequestException(
        'Somente aulas do tipo vídeo podem receber um vídeo Bunny.',
      );
    }

    const video = await this.bunny.metadata(contentUrl.trim());
    const inspectedDuration = Math.max(
      0,
      Math.round(Number(fallbackDurationSeconds) || 0),
    );
    const durationSeconds = video.durationSeconds || inspectedDuration;
    const requestedMinimum = Math.max(
      0,
      Math.round(Number(requestedMinimumWatchSeconds) || 0),
    );
    const minimumWatchSeconds =
      durationSeconds > 0
        ? Math.min(requestedMinimum || durationSeconds, durationSeconds)
        : requestedMinimum;

    return this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        contentUrl: video.reference,
        ...(durationSeconds > 0
          ? {
              duration: Math.ceil(durationSeconds / 60),
              minimumWatchSeconds,
            }
          : {}),
      },
      select: {
        id: true,
        contentUrl: true,
        duration: true,
        minimumWatchSeconds: true,
      },
    });
  }

  async getLessonQuiz(user: User, lessonId: string) {
    const lesson = await this.assertCanAccessLesson(user, lessonId);
    await this.assertLessonIsUnlocked(user, lesson);
    const config = this.lessonQuizConfigFor(lesson.quizConfig);
    const completedResult = await this.prisma.lessonQuizResult.findUnique({
      where: { employeeId_lessonId: { employeeId: user.id, lessonId } },
      select: {
        finalScore: true,
        correctAnswers: true,
        totalQuestions: true,
        completedAt: true,
      },
    });
    return {
      lessonId,
      title: config.title,
      questions: config.questions.map(({ correctOptionIds, ...question }) => ({
        ...question,
        options: question.options.map(
          ({ feedback: _feedback, correct: _correct, ...option }) => option,
        ),
        correctOptionCount: correctOptionIds.length,
      })),
      completedResult,
    };
  }

  async submitLessonQuiz(
    user: User,
    lessonId: string,
    answers: Array<{
      questionId: string;
      selectedOptionId?: string;
      selectedOptionIds?: string[];
    }>,
  ) {
    const lesson = await this.assertCanAccessLesson(user, lessonId);
    await this.assertLessonIsUnlocked(user, lesson);
    const config = this.lessonQuizConfigFor(lesson.quizConfig);
    const progress = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId } },
    });
    const requiredSeconds = this.requiredWatchSeconds(user, lesson);
    if ((progress?.watchedSeconds ?? 0) < requiredSeconds) {
      throw new ForbiddenException(
        'Cumpra o tempo mínimo da aula antes de responder ao quiz.',
      );
    }

    const submittedAnswers = new Map(
      answers.map((answer) => [
        answer.questionId,
        Array.isArray(answer.selectedOptionIds)
          ? answer.selectedOptionIds
          : answer.selectedOptionId
            ? [answer.selectedOptionId]
            : [],
      ]),
    );
    if (
      submittedAnswers.size !== config.questions.length ||
      answers.length !== config.questions.length
    ) {
      throw new BadRequestException('Responda todas as perguntas do quiz.');
    }

    let finalScore = 0;
    let correctAnswers = 0;
    const gradedAnswers = config.questions.map((question) => {
      const selectedOptionIds = submittedAnswers.get(question.id) ?? [];
      if (
        selectedOptionIds.length === 0 ||
        new Set(selectedOptionIds).size !== selectedOptionIds.length ||
        selectedOptionIds.some(
          (selectedOptionId) =>
            !question.options.some((option) => option.id === selectedOptionId),
        )
      ) {
        throw new BadRequestException('Uma resposta do quiz é inválida.');
      }
      const expected = new Set(question.correctOptionIds);
      const correct =
        selectedOptionIds.length === expected.size &&
        selectedOptionIds.every((optionId) => expected.has(optionId));
      const awardedPoints = correct ? (question.basePoints ?? 100) : 0;
      if (correct) {
        correctAnswers += 1;
        finalScore += awardedPoints;
      }
      const selectedFeedback = question.options.find(
        (option) =>
          selectedOptionIds.includes(option.id) && Boolean(option.feedback),
      )?.feedback;
      const correctFeedback = question.options.find(
        (option) =>
          question.correctOptionIds.includes(option.id) &&
          Boolean(option.feedback),
      )?.feedback;
      return {
        questionId: question.id,
        selectedOptionIds,
        correct,
        awardedPoints,
        feedback: selectedFeedback || correctFeedback || '',
      };
    });

    const result = await this.prisma.lessonQuizResult.upsert({
      where: { employeeId_lessonId: { employeeId: user.id, lessonId } },
      update: {
        finalScore,
        correctAnswers,
        totalQuestions: config.questions.length,
        metrics: {
          answers: gradedAnswers,
          wrongQuestionIds: gradedAnswers
            .filter((answer) => !answer.correct)
            .map((answer) => answer.questionId),
        },
        completedAt: new Date(),
      },
      create: {
        employeeId: user.id,
        lessonId,
        finalScore,
        correctAnswers,
        totalQuestions: config.questions.length,
        metrics: {
          answers: gradedAnswers,
          wrongQuestionIds: gradedAnswers
            .filter((answer) => !answer.correct)
            .map((answer) => answer.questionId),
        },
      },
    });
    return {
      ...result,
      questionFeedback: gradedAnswers.map((answer) => ({
        questionId: answer.questionId,
        correct: answer.correct,
        feedback: answer.feedback,
      })),
    };
  }

  async getLessonNote(user: User, lessonId: string) {
    await this.assertCanAccessLesson(user, lessonId);
    const note = await this.prisma.lessonNote.findUnique({
      where: { employeeId_lessonId: { employeeId: user.id, lessonId } },
      select: { content: true, updatedAt: true },
    });
    return {
      lessonId,
      content: note?.content ?? '',
      updatedAt: note?.updatedAt.toISOString() ?? null,
    };
  }

  async saveLessonNote(user: User, lessonId: string, content: string) {
    await this.assertCanAccessLesson(user, lessonId);
    const note = await this.prisma.lessonNote.upsert({
      where: { employeeId_lessonId: { employeeId: user.id, lessonId } },
      update: { content },
      create: { employeeId: user.id, lessonId, content },
      select: { content: true, updatedAt: true },
    });
    return {
      lessonId,
      content: note.content,
      updatedAt: note.updatedAt.toISOString(),
    };
  }

  // ==========================================
  // 📚 CRIAÇÃO E LEITURA DE CURSOS
  // ==========================================
  async createCourse(dto: CreateCourseDto) {
    const { modules: inputModules, availableAt, ...courseData } = dto;
    const modules = await this.normalizeBunnyModules(inputModules);
    return this.prisma.course.create({
      data: {
        ...courseData,
        availableAt: this.availableAtFor(availableAt),
        modules: {
          create: modules?.map((mod, modIndex) => ({
            title: mod.title || `Módulo ${modIndex + 1}`,
            order: modIndex,
            availableAt: this.availableAtFor(mod.availableAt),
            ...this.moduleGameDataFor(mod),
            lessons: {
              create: mod.lessons?.map((lesson, lessonIndex) => ({
                title: lesson.title || `Aula ${lessonIndex + 1}`,
                availableAt: this.availableAtFor(lesson.availableAt),
                type: lesson.type,
                contentUrl: lesson.contentUrl || '',
                duration: Number(lesson.duration) || 0,
                minimumWatchSeconds: this.minimumWatchSecondsFor(lesson),
                quizConfig: this.lessonQuizDataFor(lesson.quizConfig),
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
            lessons: { select: { id: true, title: true, availableAt: true } },
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
    const progressRows = await this.prisma.lessonProgress.findMany({
      where: { userId: user.id },
    });
    const quizRequirementsApply = user.role === Role.USER;

    const lessons = await this.prisma.lesson.findMany({
      where: { id: { in: progressRows.map(({ lessonId }) => lessonId) } },
      select: {
        id: true,
        type: true,
        duration: true,
        minimumWatchSeconds: true,
        quizConfig: true,
      },
    });
    const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

    const quizLessonIds = quizRequirementsApply
      ? progressRows
          .filter(({ lessonId }) =>
            this.hasLessonQuiz(lessonById.get(lessonId)?.quizConfig ?? null),
          )
          .map(({ lessonId }) => lessonId)
      : [];
    const quizResults =
      quizLessonIds.length > 0
        ? await this.prisma.lessonQuizResult.findMany({
            where: {
              employeeId: user.id,
              lessonId: { in: quizLessonIds },
            },
            select: { lessonId: true },
          })
        : [];
    const completedQuizLessonIds = new Set(
      quizResults.map(({ lessonId }) => lessonId),
    );

    return progressRows.map((progress) => ({
      ...progress,
      isCompleted:
        progress.isCompleted &&
        progress.watchedSeconds >=
          (lessonById.get(progress.lessonId)?.type === LessonType.VIDEO
            ? minimumRequiredWatchSeconds(
                lessonById.get(progress.lessonId) ?? {
                  type: LessonType.VIDEO,
                },
              )
            : 0) &&
        (!quizRequirementsApply ||
          !this.hasLessonQuiz(
            lessonById.get(progress.lessonId)?.quizConfig ?? null,
          ) ||
          completedQuizLessonIds.has(progress.lessonId)),
    }));
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

    if (user.role !== Role.USER) return course;

    const now = new Date();
    const courseUnavailable = Boolean(
      course.availableAt && course.availableAt > now,
    );
    return {
      ...course,
      modules: course.modules.map((courseModule) => {
        const moduleUnavailable = Boolean(
          courseUnavailable ||
            (courseModule.availableAt && courseModule.availableAt > now),
        );
        return {
          ...courseModule,
          lessons: courseModule.lessons.map((lesson) => ({
            ...lesson,
            ...(moduleUnavailable ||
            (lesson.availableAt && lesson.availableAt > now)
              ? { contentUrl: '', attachments: [] }
              : {}),
          })),
        };
      }),
    };
  }

  async getDownloadableMaterial(user: User, requestedFilename: string) {
    const filename = basename(requestedFilename);
    if (!filename || filename !== requestedFilename) {
      throw new BadRequestException('Nome de arquivo inválido.');
    }
    const uploadedSuffix = `/${filename}`;
    const protectedDownloadSuffix = `/${filename}/download`;
    const storedMaterialUrl = {
      OR: [
        { url: { endsWith: uploadedSuffix } },
        { url: { endsWith: protectedDownloadSuffix } },
      ],
    } satisfies Prisma.AttachmentWhereInput;
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        OR: [
          { contentUrl: { endsWith: uploadedSuffix } },
          { contentUrl: { endsWith: protectedDownloadSuffix } },
          { attachments: { some: storedMaterialUrl } },
        ],
        ...(user.role === Role.ADMIN || user.role === Role.HR_MANAGER
          ? {}
          : {
              AND: [
                {
                  OR: [
                    { availableAt: null },
                    { availableAt: { lte: new Date() } },
                  ],
                },
              ],
              module: {
                course: {
                  userAccesses: { some: { userId: user.id } },
                  OR: [
                    { availableAt: null },
                    { availableAt: { lte: new Date() } },
                  ],
                },
                OR: [
                  { availableAt: null },
                  { availableAt: { lte: new Date() } },
                ],
              },
            }),
      },
      select: {
        title: true,
        contentUrl: true,
        attachments: {
          where: storedMaterialUrl,
          select: { title: true },
          take: 1,
        },
      },
    });
    if (!lesson) {
      throw new NotFoundException('Material não encontrado ou sem acesso.');
    }

    const signedUrl = await this.assets.createSignedDownloadUrl(filename);
    const asset = signedUrl ? null : await this.assets.open(filename);
    const title =
      lesson.attachments[0]?.title?.trim() || lesson.title.trim() || 'material';
    const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-');
    return {
      asset,
      signedUrl,
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
    const { modules: inputModules, availableAt, ...courseData } = data;
    const modules = await this.normalizeBunnyModules(inputModules);

    // 1. Apanhar os IDs reais que chegaram do Frontend (Ignorar os IDs temporários)
    const incomingModuleIds =
      modules
        ?.filter((m: any) => !m.id.startsWith('temp_'))
        .map((m: any) => m.id) || [];

    return this.prisma.course.update({
      where: { id: courseId },
      data: {
        ...courseData,
        availableAt: this.availableAtFor(availableAt),
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
                    availableAt: this.availableAtFor(mod.availableAt),
                    ...this.moduleGameDataFor(mod),
                    lessons: {
                      create: mod.lessons?.map(
                        (lesson: any, lessonIndex: number) => ({
                          title: lesson.title,
                          availableAt: this.availableAtFor(lesson.availableAt),
                          type: lesson.type,
                          contentUrl: lesson.contentUrl || '',
                          duration: Number(lesson.duration) || 0,
                          minimumWatchSeconds:
                            this.minimumWatchSecondsFor(lesson),
                          quizConfig: this.lessonQuizDataFor(lesson.quizConfig),
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
                    availableAt: this.availableAtFor(mod.availableAt),
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
                              availableAt: this.availableAtFor(
                                lesson.availableAt,
                              ),
                              type: lesson.type,
                              contentUrl: lesson.contentUrl || '',
                              duration: Number(lesson.duration) || 0,
                              minimumWatchSeconds:
                                this.minimumWatchSecondsFor(lesson),
                              quizConfig: this.lessonQuizDataFor(
                                lesson.quizConfig,
                              ),
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
                              availableAt: this.availableAtFor(
                                lesson.availableAt,
                              ),
                              type: lesson.type,
                              contentUrl: lesson.contentUrl || '',
                              duration: Number(lesson.duration) || 0,
                              minimumWatchSeconds:
                                this.minimumWatchSecondsFor(lesson),
                              quizConfig: this.lessonQuizDataFor(
                                lesson.quizConfig,
                              ),
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

  async updateCourseSchedule(
    courseId: string,
    schedule: {
      availableAt?: string | null;
      modules: Array<{
        id: string;
        availableAt?: string | null;
        lessons: Array<{ id: string; availableAt?: string | null }>;
      }>;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.course.update({
        where: { id: courseId },
        data: { availableAt: this.availableAtFor(schedule.availableAt) },
      });

      for (const courseModule of schedule.modules) {
        const moduleUpdate = await tx.module.updateMany({
          where: { id: courseModule.id, courseId },
          data: {
            availableAt: this.availableAtFor(courseModule.availableAt),
          },
        });
        if (moduleUpdate.count !== 1) {
          throw new BadRequestException(
            'Um dos módulos não pertence a este curso.',
          );
        }

        for (const lesson of courseModule.lessons) {
          const lessonUpdate = await tx.lesson.updateMany({
            where: { id: lesson.id, moduleId: courseModule.id },
            data: { availableAt: this.availableAtFor(lesson.availableAt) },
          });
          if (lessonUpdate.count !== 1) {
            throw new BadRequestException(
              'Uma das aulas não pertence ao módulo informado.',
            );
          }
        }
      }

      return { updated: true };
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
        availableAt: true,
        type: true,
        contentUrl: true,
        duration: true,
        minimumWatchSeconds: true,
        quizConfig: true,
        module: {
          select: {
            availableAt: true,
            course: {
              select: {
                availableAt: true,
                modules: {
                  orderBy: { order: 'asc' },
                  select: {
                    id: true,
                    gameType: true,
                    lessons: {
                      orderBy: { order: 'asc' },
                      select: {
                        id: true,
                        availableAt: true,
                        type: true,
                        duration: true,
                        minimumWatchSeconds: true,
                        quizConfig: true,
                      },
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

    const unavailableUntil = this.unavailableUntil(
      lesson.module.course.availableAt,
      lesson.module.availableAt,
      lesson.availableAt,
    );
    if (user.role === Role.USER && unavailableUntil) {
      throw new ForbiddenException({
        code: 'CONTENT_NOT_AVAILABLE_YET',
        message: 'Este conteúdo ainda não está disponível.',
        availableAt: unavailableUntil.toISOString(),
      });
    }

    return lesson;
  }

  private async assertLessonIsUnlocked(user: User, lesson: AccessibleLesson) {
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
    const [previousProgress, previousQuizResult] = await Promise.all([
      this.prisma.lessonProgress.findUnique({
        where: {
          userId_lessonId: {
            userId: user.id,
            lessonId: previousLesson.id,
          },
        },
        select: { isCompleted: true, watchedSeconds: true },
      }),
      this.hasLessonQuiz(previousLesson.quizConfig)
        ? this.prisma.lessonQuizResult.findUnique({
            where: {
              employeeId_lessonId: {
                employeeId: user.id,
                lessonId: previousLesson.id,
              },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    if (
      !previousProgress?.isCompleted ||
      previousProgress.watchedSeconds <
        (previousLesson.type === LessonType.VIDEO
          ? minimumRequiredWatchSeconds(previousLesson)
          : 0) ||
      (this.hasLessonQuiz(previousLesson.quizConfig) && !previousQuizResult)
    ) {
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
    _user: User,
    lesson: {
      type: LessonType;
      duration?: number | null;
      minimumWatchSeconds: number;
    },
  ) {
    if (lesson.type !== LessonType.VIDEO) return 0;
    return minimumRequiredWatchSeconds(lesson);
  }

  private calculateWatchedIncrement(
    progress: {
      lastTime: number;
      watchedSeconds: number;
      updatedAt: Date;
    } | null,
    currentTime: number,
  ) {
    // A primeira chamada apenas cria a âncora de tempo no servidor. Nenhum
    // tempo informado pelo navegador é aceito retroativamente.
    if (!progress) return 0;

    const videoAdvance = Math.max(0, currentTime - progress.lastTime);
    const elapsedSeconds = Math.max(
      0,
      (Date.now() - progress.updatedAt.getTime()) / 1000,
    );

    // O relógio do servidor é o limite: repetir chamadas, acelerar ou saltar
    // o player não pode acumular mais segundos do que o tempo real decorrido.
    return Math.min(videoAdvance, elapsedSeconds, 15);
  }

  private isTransactionConflict(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
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
    quizRequired = false,
    quizCompleted = true,
  ) {
    const watchedSeconds = progress?.watchedSeconds ?? 0;
    const remainingSeconds = Math.max(
      0,
      Math.ceil(minimumWatchSeconds - watchedSeconds),
    );
    const isCompleted =
      progress?.isCompleted === true &&
      watchedSeconds >= minimumWatchSeconds &&
      (!quizRequired || quizCompleted);

    return {
      ...(progress ?? {
        lastTime: 0,
        watchedSeconds: 0,
        isCompleted: false,
      }),
      isCompleted,
      minimumWatchSeconds,
      remainingSeconds,
      quizRequired,
      quizCompleted,
      canComplete: isCompleted || remainingSeconds === 0,
    };
  }

  private hasLessonQuiz(config: Prisma.JsonValue | null) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return false;
    }
    return Array.isArray((config as Prisma.JsonObject).questions);
  }

  private lessonQuizConfigFor(config: Prisma.JsonValue | null) {
    if (!this.hasLessonQuiz(config)) {
      throw new NotFoundException('Esta aula não possui quiz configurado.');
    }
    const raw = config as Prisma.JsonObject;
    const questions = (raw.questions as Prisma.JsonArray).map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException('Configuração de quiz inválida.');
      }
      const question = item as Prisma.JsonObject;
      const options = Array.isArray(question.options)
        ? question.options.map((optionItem) => {
            if (
              !optionItem ||
              typeof optionItem !== 'object' ||
              Array.isArray(optionItem)
            ) {
              throw new BadRequestException('Alternativa de quiz inválida.');
            }
            const option = optionItem as Prisma.JsonObject;
            return {
              id: String(option.id ?? ''),
              label: String(option.label ?? ''),
              correct: option.correct === true || option.correta === true,
              feedback:
                typeof option.feedback === 'string'
                  ? option.feedback
                  : undefined,
            };
          })
        : [];
      const declaredCorrectIds = Array.isArray(question.correctOptionIds)
        ? question.correctOptionIds.map(String)
        : question.correctOptionId
          ? [String(question.correctOptionId)]
          : options
              .filter((option) => option.correct)
              .map((option) => option.id);
      const rawType = String(question.type ?? question.tipo ?? 'single');
      const type =
        rawType === 'multiple' || rawType === 'multipla_escolha'
          ? 'multiple'
          : rawType === 'boolean' || rawType === 'verdadeiro_falso'
            ? 'boolean'
            : 'single';
      const parsed = {
        id: String(question.id ?? ''),
        prompt: String(question.prompt ?? question.pergunta ?? ''),
        category: String(
          question.category ??
            question.categoria ??
            question.sectionTitle ??
            '',
        ),
        type,
        correctOptionIds: [...new Set(declaredCorrectIds)],
        basePoints: Number(question.basePoints ?? 100),
        feedback:
          typeof question.feedback === 'string' ? question.feedback : undefined,
        options,
      };
      if (
        !parsed.id ||
        !parsed.prompt ||
        parsed.options.length < 2 ||
        parsed.options.some((option) => !option.id || !option.label) ||
        parsed.correctOptionIds.length === 0 ||
        (type !== 'multiple' && parsed.correctOptionIds.length !== 1) ||
        parsed.correctOptionIds.some(
          (optionId) =>
            !parsed.options.some((option) => option.id === optionId),
        )
      ) {
        throw new BadRequestException('Configuração de quiz incompleta.');
      }
      return parsed;
    });
    if (questions.length === 0) {
      throw new BadRequestException(
        'Adicione pelo menos uma pergunta ao quiz.',
      );
    }
    return {
      title: typeof raw.title === 'string' ? raw.title : 'Quiz da aula',
      questions,
    };
  }

  private lessonQuizDataFor(config: unknown) {
    if (config === null || config === undefined) return undefined;
    this.lessonQuizConfigFor(config as Prisma.JsonValue);
    return config as Prisma.InputJsonValue;
  }

  private async normalizeBunnyModules(modules?: any[]) {
    if (!modules) return modules;
    const normalized = [] as any[];
    const metadata = new Map<
      string,
      Awaited<ReturnType<BunnyStreamService['metadata']>>
    >();
    for (const mod of modules) {
      const lessons = [] as any[];
      for (const lesson of mod.lessons ?? []) {
        const url =
          typeof lesson.contentUrl === 'string' ? lesson.contentUrl.trim() : '';
        const ids = parseBunnyReference(url);
        if (!ids) {
          if (
            url.startsWith('bunny:') ||
            /^https:\/\/(iframe|player)\.mediadelivery\.net\//i.test(url)
          ) {
            throw new BadRequestException(
              'Referência Bunny inválida. Cole o endereço Embed completo, não o HTML do iframe.',
            );
          }
          lessons.push(lesson);
          continue;
        }
        if (lesson.type !== LessonType.VIDEO)
          throw new BadRequestException(
            'Vídeos Bunny devem usar o tipo VIDEO.',
          );
        const reference = `bunny://${ids.libraryId}/${ids.videoId}`;
        const storedDurationSeconds = Math.round(
          Number(lesson.minimumWatchSeconds) || Number(lesson.duration) * 60,
        );
        // Referências canônicas são geradas pelo próprio backend depois da
        // validação inicial. Ao editar apenas título, agenda ou materiais, não
        // devemos tornar a gravação dependente de uma nova consulta ao Bunny.
        if (
          url === reference &&
          typeof lesson.id === 'string' &&
          !lesson.id.startsWith('temp_') &&
          Number.isFinite(storedDurationSeconds) &&
          storedDurationSeconds > 0
        ) {
          lessons.push({
            ...lesson,
            contentUrl: reference,
            minimumWatchSeconds: storedDurationSeconds,
          });
          continue;
        }
        let video = metadata.get(reference);
        if (!video) {
          video = await this.bunny.metadata(reference);
          metadata.set(reference, video);
        }
        const durationSeconds =
          video.durationSeconds || Math.ceil(Number(lesson.duration) * 60);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          throw new BadRequestException(
            'O Bunny ainda está processando a duração. Aguarde e salve novamente.',
          );
        }
        const requestedMinimum = Number(lesson.minimumWatchSeconds);
        lessons.push({
          ...lesson,
          contentUrl: reference,
          duration: Math.ceil(durationSeconds / 60),
          minimumWatchSeconds:
            Number.isFinite(requestedMinimum) && requestedMinimum > 0
              ? Math.min(Math.round(requestedMinimum), durationSeconds)
              : durationSeconds,
        });
      }
      normalized.push({ ...mod, lessons });
    }
    return normalized;
  }

  private minimumWatchSecondsFor(lesson: {
    type?: LessonType | string;
    duration?: number | string;
    minimumWatchSeconds?: number | string;
    contentUrl?: string;
  }) {
    if (lesson.type !== LessonType.VIDEO && lesson.type !== 'VIDEO') return 0;
    if (
      !parseBunnyReference(lesson.contentUrl ?? '') &&
      !/\.(mp4|webm)(?:$|[?#])/i.test(lesson.contentUrl ?? '')
    )
      return 0;

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

    const gameConfig = courseModule.gameConfig as Record<string, unknown>;
    if (gameConfig.formatVersion === 2) {
      this.lessonQuizConfigFor(gameConfig as Prisma.JsonObject);
    }

    return {
      gameType: courseModule.gameType as ModuleGameTypeValue,
      gameConfig: courseModule.gameConfig as Prisma.InputJsonValue,
    };
  }

  private availableAtFor(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const availableAt = new Date(String(value));
    if (Number.isNaN(availableAt.getTime())) {
      throw new BadRequestException('Data de liberação do módulo inválida.');
    }
    return availableAt;
  }

  private unavailableUntil(...values: Array<Date | null | undefined>) {
    const now = Date.now();
    const futureDates = values.filter(
      (value): value is Date => Boolean(value && value.getTime() > now),
    );
    if (futureDates.length === 0) return null;
    return new Date(Math.max(...futureDates.map((value) => value.getTime())));
  }
}
