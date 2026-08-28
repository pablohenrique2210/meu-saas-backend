import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { UploadService } from './upload.service';

describe('UploadService', () => {
  const previousUploadsDir = process.env.UPLOADS_DIR;
  let uploadsDir: string;
  let service: UploadService;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(join(tmpdir(), 'course-upload-'));
    process.env.UPLOADS_DIR = uploadsDir;
    service = new UploadService();
  });

  afterEach(async () => {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    await rm(uploadsDir, { recursive: true, force: true });
  });

  it('remonta os blocos na ordem e devolve a URL final', async () => {
    const input = {
      uploadId: 'upload-12345678',
      totalChunks: 2,
      originalName: 'aula.mp4',
      mimeType: 'video/mp4',
    };

    const first = await service.storeChunk(
      { ...input, chunkIndex: 0 },
      { buffer: Buffer.from('primeiro-') } as Express.Multer.File,
    );
    expect(first.complete).toBe(false);

    const repeatedFirstChunk = await service.storeChunk(
      { ...input, chunkIndex: 0 },
      { buffer: Buffer.from('primeiro-') } as Express.Multer.File,
    );
    expect(repeatedFirstChunk.complete).toBe(false);

    const completed = await service.storeChunk(
      { ...input, chunkIndex: 1 },
      { buffer: Buffer.from('segundo') } as Express.Multer.File,
    );
    expect(completed.complete).toBe(true);
    expect(completed.url).toMatch(/\/uploads\/.+\.mp4$/);

    const filename = basename(new URL(completed.url).pathname);
    await expect(readFile(join(uploadsDir, filename), 'utf8')).resolves.toBe(
      'primeiro-segundo',
    );

    const repeatedFinalChunk = await service.storeChunk(
      { ...input, chunkIndex: 1 },
      { buffer: Buffer.from('segundo') } as Express.Multer.File,
    );
    expect(repeatedFinalChunk).toEqual(completed);
    await expect(readFile(join(uploadsDir, filename), 'utf8')).resolves.toBe(
      'primeiro-segundo',
    );
  });
});
