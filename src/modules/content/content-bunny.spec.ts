import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { ContentService } from './content.service';
import { BunnyStreamService } from './bunny-stream.service';
import { PrismaService } from '../../prisma/prisma.service';

const id = '9db38922-a762-42df-8e3e-a41390fd53fe';
const reference = `bunny://123/${id}`;
const user = { id: 'employee', role: Role.USER } as User;
describe('Course Bunny integration', () => {
  const prisma = {
    course: { create: jest.fn(), update: jest.fn() },
    lesson: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    lessonProgress: { findUnique: jest.fn() },
  };
  const bunny = { metadata: jest.fn(), playback: jest.fn() };
  let service: ContentService;
  beforeEach(() => {
    jest.resetAllMocks();
    service = new ContentService(
      prisma as unknown as PrismaService,
      undefined,
      bunny as unknown as BunnyStreamService,
    );
    bunny.metadata.mockResolvedValue({
      reference,
      durationSeconds: 601,
      ready: true,
    });
    bunny.playback.mockResolvedValue({
      provider: 'bunny',
      status: 'ready',
      url: 'https://iframe.mediadelivery.net/embed/signed',
    });
    prisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson',
      type: 'VIDEO',
      contentUrl: reference,
      module: {
        course: { modules: [{ id: 'module', lessons: [{ id: 'lesson' }] }] },
      },
    });
    prisma.lessonProgress.findUnique.mockResolvedValue({ lastTime: 42 });
    prisma.lesson.findUnique.mockResolvedValue({
      id: 'lesson',
      type: 'VIDEO',
    });
    prisma.lesson.update.mockResolvedValue({
      id: 'lesson',
      contentUrl: reference,
      duration: 11,
      minimumWatchSeconds: 601,
    });
  });
  it('persists canonical reference and authoritative duration, not an expiring URL', async () => {
    await service.createCourse({
      title: 'Course',
      category: 'LEADERSHIP',
      modules: [
        {
          title: 'Module',
          lessons: [
            {
              title: 'Lesson',
              type: 'VIDEO',
              contentUrl: `https://iframe.mediadelivery.net/embed/123/${id}?token=expired`,
              minimumWatchSeconds: 0,
            },
          ],
        },
      ],
    });
    expect(
      prisma.course.create.mock.calls[0][0].data.modules.create[0].lessons
        .create[0],
    ).toMatchObject({
      contentUrl: reference,
      duration: 11,
      minimumWatchSeconds: 601,
    });
  });
  it('validates replacement on update before changing the course', async () => {
    bunny.metadata.mockRejectedValue(new NotFoundException());
    await expect(
      service.updateCourse('course', {
        modules: [
          {
            id: 'module',
            lessons: [{ id: 'lesson', type: 'VIDEO', contentUrl: reference }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.course.update).not.toHaveBeenCalled();
  });
  it('preserves legacy video and attachments without contacting Bunny', async () => {
    const url = 'https://old.public.blob.vercel-storage.com/video.mp4';
    await service.createCourse({
      title: 'Course',
      category: 'LEADERSHIP',
      modules: [
        {
          lessons: [
            {
              type: 'VIDEO',
              contentUrl: url,
              duration: 5,
              attachments: [
                {
                  title: 'PDF',
                  type: 'PDF',
                  url: 'https://materials.example/a.pdf',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(bunny.metadata).not.toHaveBeenCalled();
    expect(
      prisma.course.create.mock.calls[0][0].data.modules.create[0].lessons
        .create[0],
    ).toMatchObject({
      contentUrl: url,
      duration: 5,
      minimumWatchSeconds: 300,
      attachments: {
        create: [
          { title: 'PDF', type: 'PDF', url: 'https://materials.example/a.pdf' },
        ],
      },
    });
  });
  it('checks enrollment before signing', async () => {
    prisma.lesson.findFirst.mockResolvedValue(null);
    await expect(
      service.getLessonPlayback(user, 'lesson'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bunny.playback).not.toHaveBeenCalled();
    expect(prisma.lesson.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          module: {
            course: { userAccesses: { some: { userId: 'employee' } } },
          },
        }),
      }),
    );
  });
  it('rejects a locked next lesson before contacting Bunny', async () => {
    prisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson',
      type: 'VIDEO',
      contentUrl: reference,
      module: {
        course: {
          modules: [
            { id: 'module', lessons: [{ id: 'previous' }, { id: 'lesson' }] },
          ],
        },
      },
    });
    prisma.lessonProgress.findUnique.mockResolvedValue(null);
    await expect(
      service.getLessonPlayback(user, 'lesson'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bunny.playback).not.toHaveBeenCalled();
  });
  it('returns resume position for an accessible lesson', async () => {
    expect(await service.getLessonPlayback(user, 'lesson')).toMatchObject({
      provider: 'bunny',
      lastTime: 42,
    });
    expect(bunny.playback).toHaveBeenCalledWith(reference);
  });
  it('links a completed Bunny upload to the lesson immediately', async () => {
    await expect(
      service.linkLessonVideo('lesson', reference, 590, 120),
    ).resolves.toMatchObject({ contentUrl: reference });
    expect(bunny.metadata).toHaveBeenCalledWith(reference);
    expect(prisma.lesson.update).toHaveBeenCalledWith({
      where: { id: 'lesson' },
      data: {
        contentUrl: reference,
        duration: 11,
        minimumWatchSeconds: 120,
      },
      select: {
        id: true,
        contentUrl: true,
        duration: true,
        minimumWatchSeconds: true,
      },
    });
  });
  it('keeps the Bunny reference when encoding has not exposed duration yet', async () => {
    bunny.metadata.mockResolvedValue({
      reference,
      durationSeconds: 0,
      ready: false,
    });
    await service.linkLessonVideo('lesson', reference, 590);
    expect(prisma.lesson.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          contentUrl: reference,
          duration: 10,
          minimumWatchSeconds: 590,
        },
      }),
    );
  });
});
