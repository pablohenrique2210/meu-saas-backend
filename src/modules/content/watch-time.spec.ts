import { LessonType } from '@prisma/client';
import { minimumRequiredWatchSeconds } from './watch-time';

describe('minimumRequiredWatchSeconds', () => {
  it('uses the configured minimum for a video lesson', () => {
    expect(
      minimumRequiredWatchSeconds({
        type: LessonType.VIDEO,
        duration: 20,
        minimumWatchSeconds: 300,
      }),
    ).toBe(300);
  });

  it('falls back to the complete video duration when an old lesson has zero minimum', () => {
    expect(
      minimumRequiredWatchSeconds({
        type: LessonType.VIDEO,
        duration: 12,
        minimumWatchSeconds: 0,
      }),
    ).toBe(720);
  });

  it('does not require watch time for non-video lessons', () => {
    expect(
      minimumRequiredWatchSeconds({
        type: LessonType.TEXT,
        duration: 12,
        minimumWatchSeconds: 300,
      }),
    ).toBe(0);
  });
});
