import { LessonType } from '@prisma/client';

type WatchableLesson = {
  type: LessonType;
  duration?: number | null;
  minimumWatchSeconds?: number | null;
};

export function minimumRequiredWatchSeconds(lesson: WatchableLesson) {
  if (lesson.type !== LessonType.VIDEO) return 0;

  const configured = Math.max(
    0,
    Math.round(Number(lesson.minimumWatchSeconds) || 0),
  );
  if (configured > 0) return configured;

  // Vídeos antigos podem ter sido salvos com o mínimo zerado. Nesses casos,
  // usamos a duração cadastrada para que abrir a aula nunca seja suficiente
  // para concluí-la ou liberar a seguinte.
  return Math.max(0, Math.round((Number(lesson.duration) || 0) * 60));
}
